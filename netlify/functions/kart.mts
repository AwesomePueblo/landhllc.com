// Kart Cup tournament storage for landhllc.com/kart.
//
// GET    /api/kart        list every saved tournament (public, read-only)
// GET    /api/kart/:id    one tournament (public, read-only)
// PUT    /api/kart/:id    create or replace a tournament (host only)
// DELETE /api/kart/:id    delete a tournament (host only)
// POST   /api/kart/host   claim, ping or release the host role
// GET    /api/kart/signup open sign-up session and who has joined (host only)
// POST   /api/kart/signup open, close or remove a name from sign-ups (host only)
// GET    /api/kart/join?c=CODE   who has joined (anyone with the code)
// POST   /api/kart/join   add yourself: { code, name } (anyone with the code)
//
// Only one device can host at a time. A device becomes host by sending the
// passcode (x-kart-key, must match the KART_ADMIN_KEY environment variable)
// to POST /api/kart/host, which returns a host token. Writes need both the
// passcode and the current host token (x-kart-host). Claiming while another
// device is active is refused unless the caller asks to take over, which
// makes the other device's token stop working.
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

const STORE = "kart-tournaments";
const PREFIX = "t/";
const LOCK_KEY = "host-lock";
const SIGNUP_KEY = "signup-session";
const SIGNUP_MAX = 128;
const ACTIVE_MS = 10 * 60 * 1000; // a host idle longer than this can be replaced without a takeover
const ID_RE = /^[a-z0-9-]{4,60}$/;
const MAX_BYTES = 1_000_000;

type Lock = { token: string; device: string; since: number; lastSeen: number };
type Session = { sid: string; code: string; open: boolean; openedAt: number };

const store = () => getStore({ name: STORE, consistency: "strong" });

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const sha = (v: string) => createHash("sha256").update(v).digest();

function keyStatus(req: Request): "unset" | "ok" | "bad" | "none" {
  const expected = Netlify.env.get("KART_ADMIN_KEY");
  if (!expected) return "unset";
  const given = req.headers.get("x-kart-key");
  if (!given) return "none";
  return timingSafeEqual(sha(given), sha(expected)) ? "ok" : "bad";
}

function holdsLock(lock: Lock | null, req: Request): boolean {
  const given = req.headers.get("x-kart-host");
  return !!(lock && given && timingSafeEqual(sha(given), sha(lock.token)));
}

const publicLock = (l: Lock) => ({ device: l.device, since: l.since, lastSeen: l.lastSeen });

function validate(doc: any, id: string): string | null {
  if (!doc || typeof doc !== "object") return "Body must be a tournament object.";
  if (doc.id !== id) return "Tournament id does not match the URL.";
  if (typeof doc.name !== "string" || !doc.name.trim() || doc.name.length > 120) return "Tournament name is required (120 characters max).";
  if (!Array.isArray(doc.players) || doc.players.length > 256) return "Players must be a list (256 max).";
  if (!doc.players.every((p: any) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.length <= 80)) return "Each player needs an id and a name (80 characters max).";
  if (!Array.isArray(doc.rounds) || doc.rounds.length > 40) return "Rounds must be a list.";
  if (doc.lb !== undefined && (!Array.isArray(doc.lb) || doc.lb.length > 40)) return "Losers bracket rounds must be a list.";
  if (!doc.cfg || typeof doc.cfg !== "object") return "Settings are missing.";
  return null;
}

// Sign-ups. Each name is its own blob (keyed by the lowercased name) so many
// people joining at the same moment never overwrite each other.
const cleanName = (v: unknown) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
const slug = (name: string) => encodeURIComponent(name.toLowerCase());
const entryPrefix = (sid: string) => `s/${sid}/`;

async function listEntries(s: ReturnType<typeof store>, sid: string) {
  const { blobs } = await s.list({ prefix: entryPrefix(sid) });
  const rows = await Promise.all(blobs.map(async (b) => {
    const v = (await s.get(b.key, { type: "json" })) as { name: string; at: number } | null;
    return v ? { id: b.key.slice(entryPrefix(sid).length), name: v.name, at: v.at } : null;
  }));
  return rows.filter((r): r is { id: string; name: string; at: number } => r !== null).sort((a, b) => a.at - b.at);
}

async function signupRoute(req: Request, s: ReturnType<typeof store>) {
  const auth = keyStatus(req);
  if (auth === "unset") return json({ error: "Saving is turned off: KART_ADMIN_KEY is not set on the site." }, 503);
  if (auth !== "ok") return json({ error: "Wrong or missing host passcode." }, 401);
  const lock = (await s.get(LOCK_KEY, { type: "json" })) as Lock | null;
  if (!holdsLock(lock, req)) return json({ error: "Another device is hosting. This device is view only." }, 409);
  let session = (await s.get(SIGNUP_KEY, { type: "json" })) as Session | null;

  if (req.method === "GET") {
    return json({ session, entries: session ? await listEntries(s, session.sid) : [] });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }

  if (body.action === "open") {
    if (session) {
      const { blobs } = await s.list({ prefix: entryPrefix(session.sid) });
      await Promise.all(blobs.map((b) => s.delete(b.key)));
    }
    session = { sid: randomUUID().slice(0, 8), code: String(randomInt(1000, 10000)), open: true, openedAt: Date.now() };
    await s.setJSON(SIGNUP_KEY, session);
    return json({ session, entries: [] });
  }
  if (!session) return json({ error: "Sign-ups have not been opened." }, 409);
  if (body.action === "close" || body.action === "reopen") {
    session = { ...session, open: body.action === "reopen" };
    await s.setJSON(SIGNUP_KEY, session);
    return json({ session });
  }
  if (body.action === "remove") {
    await s.delete(entryPrefix(session.sid) + String(body.id || ""));
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}

async function joinRoute(req: Request, s: ReturnType<typeof store>) {
  const session = (await s.get(SIGNUP_KEY, { type: "json" })) as Session | null;
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* empty body */ } }
  const code = String(req.method === "POST" ? body.code ?? "" : url.searchParams.get("c") ?? "").trim();
  if (!session || code !== session.code) return json({ error: "That code does not match. Check the code on the host's screen." }, 400);

  if (req.method === "GET") {
    const entries = await listEntries(s, session.sid);
    return json({ open: session.open, count: entries.length, names: entries.map((e) => e.name) });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!session.open) return json({ error: "Sign-ups are closed. Ask the host to add you." }, 409);
  const name = cleanName(body.name);
  if (!name) return json({ error: "Enter your name." }, 400);
  const { blobs } = await s.list({ prefix: entryPrefix(session.sid) });
  const key = entryPrefix(session.sid) + slug(name);
  if (blobs.length >= SIGNUP_MAX && !blobs.some((b) => b.key === key)) return json({ error: "Sign-ups are full." }, 409);
  const { modified } = await s.setJSON(key, { name, at: Date.now() }, { onlyIfNew: true });
  return json({ ok: true, name, already: !modified, count: blobs.length + (modified ? 1 : 0) });
}

async function hostRoute(req: Request, s: ReturnType<typeof store>) {
  const auth = keyStatus(req);
  if (auth === "unset") return json({ error: "Saving is turned off: KART_ADMIN_KEY is not set on the site." }, 503);
  if (auth !== "ok") return json({ error: "Wrong or missing host passcode." }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const lock = (await s.get(LOCK_KEY, { type: "json" })) as Lock | null;
  const now = Date.now();

  if (body.action === "claim") {
    const mine = holdsLock(lock, req);
    const active = lock && now - lock.lastSeen < ACTIVE_MS;
    if (active && !mine && !body.force) {
      return json({ error: "Another device is hosting.", holder: publicLock(lock!) }, 409);
    }
    const device = String(body.device || "Host device").slice(0, 60);
    const next: Lock = { token: randomUUID(), device, since: now, lastSeen: now };
    await s.setJSON(LOCK_KEY, next);
    return json({ token: next.token });
  }
  if (body.action === "ping") {
    if (!holdsLock(lock, req)) return json({ error: "This device is no longer the host." }, 409);
    await s.setJSON(LOCK_KEY, { ...lock!, lastSeen: now });
    return json({ ok: true });
  }
  if (body.action === "release") {
    if (holdsLock(lock, req)) await s.delete(LOCK_KEY);
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}

export default async (req: Request, context: Context) => {
  const id = context.params.id as string | undefined;
  const s = store();

  if (id === "host") {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    return hostRoute(req, s);
  }
  if (id === "signup") return signupRoute(req, s);
  if (id === "join") return joinRoute(req, s);

  if (req.method === "GET") {
    const auth = keyStatus(req);
    const lock = auth === "ok" ? ((await s.get(LOCK_KEY, { type: "json" })) as Lock | null) : null;
    const meta = { canWrite: auth === "ok" && holdsLock(lock, req), keyConfigured: auth !== "unset" };
    if (id) {
      // 410 rather than 404: a 404 from a function can fall through to static files.
      if (!ID_RE.test(id)) return json({ error: "Not found" }, 410);
      const doc = await s.get(PREFIX + id, { type: "json" });
      if (doc === null) return json({ error: "Not found" }, 410);
      return json({ ...meta, tournament: doc });
    }
    const { blobs } = await s.list({ prefix: PREFIX });
    const docs = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
    const tournaments = docs
      .filter((d): d is any => d !== null)
      .sort((a, b) => String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt)));
    return json({ ...meta, tournaments });
  }

  if (req.method === "PUT" || req.method === "DELETE") {
    const auth = keyStatus(req);
    if (auth === "unset") return json({ error: "Saving is turned off: KART_ADMIN_KEY is not set on the site." }, 503);
    if (auth !== "ok") return json({ error: "Wrong or missing host passcode." }, 401);
    const lock = (await s.get(LOCK_KEY, { type: "json" })) as Lock | null;
    if (!holdsLock(lock, req)) return json({ error: "Another device is hosting. This device is view only." }, 409);
    if (!id || !ID_RE.test(id)) return json({ error: "Invalid tournament id." }, 400);

    if (req.method === "DELETE") {
      await s.delete(PREFIX + id);
      return json({ ok: true });
    }

    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: "Tournament is too large to save." }, 413);
    let doc: any;
    try { doc = JSON.parse(text); } catch { return json({ error: "Body is not valid JSON." }, 400); }
    const problem = validate(doc, id);
    if (problem) return json({ error: problem }, 400);
    doc.updatedAt = new Date().toISOString();
    await s.setJSON(PREFIX + id, doc);
    return json({ ok: true, updatedAt: doc.updatedAt });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config: Config = {
  path: ["/api/kart", "/api/kart/:id"],
  method: ["GET", "PUT", "DELETE", "POST"],
};
