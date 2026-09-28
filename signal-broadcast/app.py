#!/usr/bin/env python3
"""Signal Broadcast: send one message to many Signal groups at once.

A small web app that wraps signal-cli. Uses the Python standard library
only; no pip install needed.

On a server (see README.md and docker-compose.yml) it sits behind Caddy,
which provides HTTPS for signalbroadcast.landhllc.com, and every request
needs the password in BROADCAST_PASSWORD.

It can also run locally for testing:

    BROADCAST_PASSWORD=test python3 app.py --account +15551234567
"""

import argparse
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDEX_HTML = HERE / "index.html"

SESSION_COOKIE = "sb_session"
SESSION_DAYS = 30
SYNC_EVERY_SECONDS = 6 * 60 * 60

# Login throttling: after this many wrong passwords, lock logins for a while.
MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 15 * 60

# signal-cli keeps a lock on its data directory, so calls must not overlap.
_signal_lock = threading.Lock()


class SignalCli:
    def __init__(self, binary, account):
        self.binary = binary
        self.account = account

    def _run(self, args, stdin=None, timeout=120):
        cmd = [self.binary, "-a", self.account, "-o", "json", *args]
        with _signal_lock:
            proc = subprocess.run(
                cmd,
                input=stdin,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            raise RuntimeError(err or f"signal-cli exited with code {proc.returncode}")
        return proc.stdout

    def receive(self):
        # Pulls pending updates from Signal's servers so newly joined or
        # renamed groups show up. Messages are still delivered to your phone.
        self._run(["receive", "--timeout", "5", "--ignore-attachments",
                   "--ignore-stories", "--ignore-avatars"], timeout=180)

    def list_groups(self):
        out = self._run(["listGroups"]).strip()
        groups = json.loads(out) if out else []
        result = []
        for g in groups:
            if not g.get("isMember", True) or g.get("isBlocked", False):
                continue
            if g.get("isTerminated", False):
                continue
            result.append({
                "id": g["id"],
                "name": g.get("name") or "(unnamed group)",
                "memberCount": len(g.get("members") or []),
                "adminsOnly": g.get("permissionSendMessage") == "ONLY_ADMINS",
            })
        result.sort(key=lambda g: g["name"].lower())
        return result

    def send_to_group(self, group_id, message):
        # Message goes over stdin so text starting with "-" or containing
        # quotes is never mistaken for a command-line option.
        self._run(["send", "--message-from-stdin", "-g", group_id], stdin=message)


class Auth:
    """Password login with signed, expiring session cookies.

    The signing key is derived from the password, so changing
    BROADCAST_PASSWORD logs out every existing session.
    """

    def __init__(self, password):
        self.password = password
        self.key = hashlib.sha256(b"signal-broadcast-session:" + password.encode()).digest()
        self._lock = threading.Lock()
        self._failures = []
        self._locked_until = 0.0

    def _sign(self, expires):
        return hmac.new(self.key, str(expires).encode(), hashlib.sha256).hexdigest()

    def new_session(self):
        expires = int(time.time()) + SESSION_DAYS * 86400
        return f"{expires}.{self._sign(expires)}"

    def valid_session(self, token):
        try:
            expires_s, sig = token.split(".", 1)
            expires = int(expires_s)
        except (AttributeError, ValueError):
            return False
        return expires > time.time() and hmac.compare_digest(sig, self._sign(expires))

    def check_password(self, attempt):
        """Returns (ok, error_message)."""
        with self._lock:
            now = time.time()
            if now < self._locked_until:
                mins = int((self._locked_until - now) // 60) + 1
                return False, f"Too many wrong passwords. Try again in {mins} min."
            if hmac.compare_digest(attempt.encode(), self.password.encode()):
                self._failures.clear()
                return True, None
            self._failures = [t for t in self._failures if now - t < LOCKOUT_SECONDS]
            self._failures.append(now)
            if len(self._failures) >= MAX_FAILED_LOGINS:
                self._locked_until = now + LOCKOUT_SECONDS
                self._failures.clear()
        time.sleep(1)  # slow down guessing
        return False, "Wrong password."


class Handler(BaseHTTPRequestHandler):
    signal: SignalCli = None
    auth: Auth = None
    secure_cookies = False

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _json(self, status, payload, cookie=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _cookie(self, value, max_age):
        parts = [f"{SESSION_COOKIE}={value}", "Path=/", "HttpOnly",
                 "SameSite=Strict", f"Max-Age={max_age}"]
        if self.secure_cookies:
            parts.append("Secure")
        return "; ".join(parts)

    def _logged_in(self):
        jar = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = jar.get(SESSION_COOKIE)
        return morsel is not None and self.auth.valid_session(morsel.value)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 100_000:
            raise ValueError("too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def _same_origin(self):
        # Blocks other websites open in your browser from telling this
        # app to send messages on your behalf.
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        return origin is None or origin in (f"https://{host}", f"http://{host}")

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = INDEX_HTML.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/groups":
            if not self._logged_in():
                self._json(401, {"error": "login required"})
                return
            try:
                self._json(200, {"account": self.signal.account,
                                 "groups": self.signal.list_groups()})
            except Exception as e:
                self._json(500, {"error": str(e)})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._same_origin() or self.headers.get("Content-Type") != "application/json":
            self._json(403, {"error": "forbidden"})
            return
        try:
            data = self._read_json()
        except ValueError:
            self._json(400, {"error": "invalid request"})
            return

        if self.path == "/api/login":
            ok, err = self.auth.check_password(str(data.get("password", "")))
            if ok:
                self._json(200, {"ok": True},
                           cookie=self._cookie(self.auth.new_session(), SESSION_DAYS * 86400))
            else:
                self._json(401, {"error": err})
            return
        if self.path == "/api/logout":
            self._json(200, {"ok": True}, cookie=self._cookie("", 0))
            return

        if not self._logged_in():
            self._json(401, {"error": "login required"})
            return

        if self.path == "/api/refresh":
            try:
                self.signal.receive()
                self._json(200, {"account": self.signal.account,
                                 "groups": self.signal.list_groups()})
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif self.path == "/api/send":
            group_id = data.get("groupId")
            message = data.get("message", "")
            if not group_id or not isinstance(message, str) or not message.strip():
                self._json(400, {"error": "groupId and message are required"})
                return
            try:
                self.signal.send_to_group(group_id, message)
                self._json(200, {"ok": True})
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
        else:
            self._json(404, {"error": "not found"})


def background_sync(signal):
    # A linked device that never checks in can fall out of sync, so pull
    # updates from Signal every few hours even if nobody opens the page.
    while True:
        time.sleep(SYNC_EVERY_SECONDS)
        try:
            signal.receive()
        except Exception as e:
            sys.stderr.write(f"  background sync failed: {e}\n")


def main():
    p = argparse.ArgumentParser(description="Send one message to many Signal groups.")
    p.add_argument("--account", "-a", default=os.environ.get("SIGNAL_ACCOUNT"),
                   help="Your Signal phone number with country code, e.g. +15551234567 "
                        "(or set SIGNAL_ACCOUNT)")
    p.add_argument("--signal-cli", default=os.environ.get("SIGNAL_CLI", "signal-cli"),
                   help="Path to the signal-cli executable (default: signal-cli on PATH)")
    p.add_argument("--host", default=os.environ.get("BROADCAST_HOST", "127.0.0.1"),
                   help="Address to listen on (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=int(os.environ.get("BROADCAST_PORT", "8765")))
    p.add_argument("--secure-cookies", action="store_true",
                   default=os.environ.get("BROADCAST_SECURE_COOKIES") == "1",
                   help="Mark the login cookie HTTPS-only (use when behind HTTPS)")
    args = p.parse_args()

    if not args.account:
        p.error("--account is required, e.g. --account +15551234567")

    password = os.environ.get("BROADCAST_PASSWORD", "")
    if len(password) < 12:
        sys.exit("Set BROADCAST_PASSWORD to a password of at least 12 characters.")

    binary = shutil.which(args.signal_cli) or args.signal_cli
    if not Path(binary).exists():
        sys.exit(f"Could not find signal-cli ('{args.signal_cli}'). See README.md for install steps.")

    Handler.signal = SignalCli(binary, args.account)
    Handler.auth = Auth(password)
    Handler.secure_cookies = args.secure_cookies

    threading.Thread(target=background_sync, args=(Handler.signal,), daemon=True).start()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Signal Broadcast listening on http://{args.host}:{args.port}  (Ctrl+C to stop)",
          flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
