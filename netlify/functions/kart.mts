// Kart Cup tournament storage for landhllc.com/kart.
//
// GET    /api/kart        list every saved tournament (public, read-only)
// GET    /api/kart/:id    one tournament (public, read-only)
// PUT    /api/kart/:id    create or replace a tournament (host passcode required)
// DELETE /api/kart/:id    delete a tournament (host passcode required)
//
// Writes need the x-kart-key header to match the KART_ADMIN_KEY environment
// variable (set in Netlify: Site configuration > Environment variables, with
// the Functions scope). If the variable is not set, all writes are refused.
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";

const STORE = "kart-tournaments";
const PREFIX = "t/";
const ID_RE = /^[a-z0-9-]{4,60}$/;
const MAX_BYTES = 1_000_000;

const store = () => getStore({ name: STORE, consistency: "strong" });

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function keyStatus(req: Request): "unset" | "ok" | "bad" | "none" {
  const expected = Netlify.env.get("KART_ADMIN_KEY");
  if (!expected) return "unset";
  const given = req.headers.get("x-kart-key");
  if (!given) return "none";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) ? "ok" : "bad";
}

function validate(doc: any, id: string): string | null {
  if (!doc || typeof doc !== "object") return "Body must be a tournament object.";
  if (doc.id !== id) return "Tournament id does not match the URL.";
  if (typeof doc.name !== "string" || !doc.name.trim() || doc.name.length > 120) return "Tournament name is required (120 characters max).";
  if (!Array.isArray(doc.players) || doc.players.length > 256) return "Players must be a list (256 max).";
  if (!doc.players.every((p: any) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.length <= 80)) return "Each player needs an id and a name (80 characters max).";
  if (!Array.isArray(doc.rounds) || doc.rounds.length > 40) return "Rounds must be a list.";
  if (!doc.cfg || typeof doc.cfg !== "object") return "Settings are missing.";
  return null;
}

export default async (req: Request, context: Context) => {
  const id = context.params.id as string | undefined;
  const s = store();

  if (req.method === "GET") {
    const auth = keyStatus(req);
    const meta = { canWrite: auth === "ok", keyConfigured: auth !== "unset" };
    if (id) {
      if (!ID_RE.test(id)) return json({ error: "Not found" }, 404);
      const doc = await s.get(PREFIX + id, { type: "json" });
      if (doc === null) return json({ error: "Not found" }, 404);
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
  method: ["GET", "PUT", "DELETE"],
};
