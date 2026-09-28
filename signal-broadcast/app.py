#!/usr/bin/env python3
"""Signal Broadcast: send one message to many Signal groups at once.

A tiny local web app that wraps signal-cli. It only listens on 127.0.0.1,
so nothing is reachable from other machines. Uses the Python standard
library only; no pip install needed.

    python3 app.py --account +15551234567

Then open http://127.0.0.1:8765 in your browser.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDEX_HTML = HERE / "index.html"

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
            })
        result.sort(key=lambda g: g["name"].lower())
        return result

    def send_to_group(self, group_id, message):
        # Message goes over stdin so text starting with "-" or containing
        # quotes is never mistaken for a command-line option.
        self._run(["send", "--message-from-stdin", "-g", group_id], stdin=message)


class Handler(BaseHTTPRequestHandler):
    signal: SignalCli = None

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def _same_origin(self):
        # Blocks other websites open in your browser from telling this
        # app to send messages on your behalf.
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        return origin is None or origin == f"http://{host}"

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = INDEX_HTML.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/groups":
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
            self._json(400, {"error": "invalid JSON"})
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
            if not group_id or not message.strip():
                self._json(400, {"error": "groupId and message are required"})
                return
            try:
                self.signal.send_to_group(group_id, message)
                self._json(200, {"ok": True})
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
        else:
            self._json(404, {"error": "not found"})


def main():
    p = argparse.ArgumentParser(description="Send one message to many Signal groups.")
    p.add_argument("--account", "-a", default=os.environ.get("SIGNAL_ACCOUNT"),
                   help="Your Signal phone number with country code, e.g. +15551234567 "
                        "(or set SIGNAL_ACCOUNT)")
    p.add_argument("--signal-cli", default=os.environ.get("SIGNAL_CLI", "signal-cli"),
                   help="Path to the signal-cli executable (default: signal-cli on PATH)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-browser", action="store_true", help="Don't open a browser tab")
    args = p.parse_args()

    if not args.account:
        p.error("--account is required, e.g. --account +15551234567")

    binary = shutil.which(args.signal_cli) or args.signal_cli
    if not Path(binary).exists():
        sys.exit(f"Could not find signal-cli ('{args.signal_cli}'). See README.md for install steps.")

    Handler.signal = SignalCli(binary, args.account)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Signal Broadcast running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
