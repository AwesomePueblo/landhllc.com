# Home computer setup (for Claude Code)

Instructions for setting up Signal Broadcast on the owner's own always-on
home computer instead of a cloud server. Written for Claude Code running on
that computer. Work through the steps in order and confirm each works
before moving on.

## Goal

- `app.py` runs on this computer, listening on `127.0.0.1:8765` only.
- A Cloudflare Tunnel makes it reachable at
  `https://signalbroadcast.landhllc.com`, with HTTPS from Cloudflare.
  No router changes and no open ports.
- The app and the tunnel start automatically when the computer boots, and
  the computer doesn't sleep.

Docker, Caddy and `docker-compose.yml` are for the cloud-server setup in
README.md. They are **not** used here.

## Ground rules

- **Stop and ask the owner before anything that changes DNS or the main
  landhllc.com website** (step 5). landhllc.com is a live site on GitHub
  Pages; breaking its DNS takes the site down.
- The owner does these steps personally. Tell them clearly when it's their
  turn and wait:
  - scanning the Signal QR code (step 2)
  - picking the page password (step 3)
  - logging in to Cloudflare in the browser (step 5)
- Never print, log or commit the password or the Signal data directory.
- Don't commit anything to the repo during setup.

## 1. Check the computer and install signal-cli

Find out the OS and CPU (e.g. `uname -m` on Mac/Linux; on Windows check
system info).

- **macOS:** `brew install signal-cli` (install Homebrew first if missing,
  with the owner's OK).
- **Windows:** download the latest release from
  https://github.com/AsamK/signal-cli/releases (the JVM build,
  `signal-cli-<version>.tar.gz`) and install the Java runtime version its
  README requires (currently JRE 25 or newer).
- **Linux x86_64:** the `-Linux-native.tar.gz` release needs no Java.

Also make sure Python 3.8+ is available (`python3 --version`, or `python`
/ `py` on Windows).

Verify: `signal-cli --version`.

## 2. Link signal-cli to the owner's Signal account

```
signal-cli link -n "Signal Broadcast"
```

The owner scans the QR code with Signal on their phone:
**Settings > Linked devices > Link new device**. If the terminal can't
show a QR code, turn the printed `sgnl://linkdevice?...` URI into one
(e.g. `qrencode -t ansiutf8 '<uri>'`, or save it as a PNG and open it).
The link URI expires after a short time, so rerun if needed.

Then ask for their Signal number (with country code) and sync groups:

```
signal-cli -a +1XXXXXXXXXX receive
signal-cli -a +1XXXXXXXXXX -o json listGroups
```

Show the owner the group names so they can confirm it worked.

## 3. Configure and test the app locally

Ask the owner to choose a password (at least 12 characters). Store the
settings in a file **outside the repo**, readable only by this user, e.g.
`~/.signal-broadcast.env` (on Windows, somewhere in the user profile):

```
SIGNAL_ACCOUNT=+1XXXXXXXXXX
BROADCAST_PASSWORD=...
BROADCAST_PUBLIC_URL=https://signalbroadcast.landhllc.com
BROADCAST_SECURE_COOKIES=1
```

`app.py` reads these from the environment (no dotenv support built in),
so load them in whatever starts the app. `BROADCAST_SECURE_COOKIES=1`
means the login cookie only works over HTTPS, so for a quick local test at
`http://127.0.0.1:8765`, run once without it, then put it back.

Test: start `app.py`, open http://127.0.0.1:8765, log in, confirm groups
appear. Don't send anything unless the owner asks to.

## 4. Keep the computer awake

The app is only reachable while the computer is on and awake.

- **macOS:** System Settings > Energy (or Battery > Options on laptops):
  prevent automatic sleeping when the display is off; enable "Start up
  automatically after a power failure" if offered. A laptop must stay
  plugged in and should not be closed unless set up for clamshell use.
- **Windows:** Settings > System > Power: set sleep to Never when
  plugged in.

## 5. Cloudflare Tunnel (ask first)

A tunnel with a custom hostname needs landhllc.com's DNS to be managed by
Cloudflare. Before doing anything here:

1. Find out where landhllc.com's DNS is managed now (ask the owner; a
   `whois landhllc.com` / nameserver lookup helps). Currently the site
   resolves to GitHub Pages IPs (185.199.108.153 to .111.153).
2. Explain to the owner that using Cloudflare means changing the domain's
   nameservers to Cloudflare at their registrar, and that all existing DNS
   records (GitHub Pages A records, `www`, and any email records such as
   MX/TXT) must exist in Cloudflare first or the site/email will break.
3. Only continue with their explicit OK.

If they agree:

1. Owner creates a free Cloudflare account and adds landhllc.com. Check
   that Cloudflare's imported records match the current ones exactly
   (compare against a lookup of the current records). Keep the GitHub
   Pages records as "DNS only" (grey cloud) unless the owner wants
   otherwise, so GitHub Pages keeps issuing its certificate.
2. Owner changes the nameservers at their registrar to the two Cloudflare
   gives. Wait until Cloudflare shows the domain as active, and confirm
   https://landhllc.com still loads.
3. Install `cloudflared` (macOS: `brew install cloudflared`; Windows:
   `winget install --id Cloudflare.cloudflared`).
4. `cloudflared tunnel login` (owner approves in the browser).
5. `cloudflared tunnel create signal-broadcast`
6. `cloudflared tunnel route dns signal-broadcast signalbroadcast.landhllc.com`
7. Config file (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: signal-broadcast
   credentials-file: <path printed by "tunnel create">
   ingress:
     - hostname: signalbroadcast.landhllc.com
       service: http://127.0.0.1:8765
     - service: http_status:404
   ```
8. Test with `cloudflared tunnel run signal-broadcast` while the app is
   running, then have the owner open
   https://signalbroadcast.landhllc.com on their phone (cellular, not home
   Wi-Fi) and log in.

## 6. Start everything automatically

Make both the app (with the env file loaded) and the tunnel start at boot
and restart if they crash:

- **macOS:** a LaunchAgent plist in `~/Library/LaunchAgents/` for the app
  (`RunAtLoad` + `KeepAlive`, a small wrapper script that loads the env
  file and runs `python3 app.py`), and `sudo cloudflared service install`
  for the tunnel. Note a LaunchAgent only runs while the owner is logged
  in; enable automatic login if the computer should recover from a
  restart unattended (explain the tradeoff and let the owner decide).
- **Windows:** Task Scheduler task "At log on" (or "At startup") for the
  app via a small script that sets the env vars, and
  `cloudflared service install` for the tunnel.

Reboot (with the owner's OK) and confirm the page works from the phone
afterwards.

## 7. Wrap up

Tell the owner:
- the address and that they can "Add to Home Screen" on their phone
- how to stop it, and how to unlink it (Signal > Settings > Linked
  devices on the phone)
- that the app is unreachable whenever this computer is off, asleep or
  offline
- that if sends start failing, updating signal-cli usually fixes it
