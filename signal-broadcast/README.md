# Signal Broadcast

A password-protected web page at **signalbroadcast.landhllc.com** that
lets you pick several Signal groups on your phone and send the same message
to all of them at once.

- Search your groups, check the ones you want, write the message, hit Send.
- Save selections as named lists (e.g. "All tenants", "Board") and reload
  them later. Lists are saved in the browser you made them in.
- Shows a check or an error for every group, with a "Retry failed" button.
- Asks for confirmation (listing every group) before anything is sent.
- Groups where only admins can post are tagged "admins only". Sending to
  one of those fails unless you're an admin of it.

## How it works

Signal has no official API for this, so the app uses
[signal-cli](https://github.com/AsamK/signal-cli), a widely used open
source command-line Signal client. signal-cli is linked to your Signal
account as a **linked device**, the same way Signal Desktop is. Messages
go out from your own number and show up in your phone's chats like
anything else you send.

signal-cli has to keep running and keep its link to your account on
disk, which a static website host (like GitHub Pages, which serves
landhllc.com) can't do. So this runs on a small always-on
cloud server:

```
phone browser ──HTTPS──> signalbroadcast.landhllc.com (your server)
                           ├─ Caddy: HTTPS certificate, forwards requests
                           └─ app.py: password check, runs signal-cli ──> Signal
```

The main landhllc.com site is not involved.

## One-time setup

These steps are for a cloud server. To run it on a home computer instead,
see [HOME-SETUP.md](HOME-SETUP.md), written so Claude Code on that
computer can follow it.


### 1. Get a server

Any cloud provider works. You need:

- Ubuntu (22.04 or newer)
- An **x86 / Intel / AMD** machine, not ARM. The signal-cli build used
  here is for x86.
- 1 GB of memory is enough.
- A public IP address, with ports 22, 80 and 443 open.

### 2. Point the subdomain at it

Wherever landhllc.com's DNS is managed (usually the company you bought
the domain from), add a record:

| Type | Name | Value |
| --- | --- | --- |
| A | `signalbroadcast` | your server's IP address |

### 3. Install Docker and get the code onto the server

SSH into the server, then:

```bash
curl -fsSL https://get.docker.com | sudo sh
git clone https://github.com/AwesomePueblo/landhllc.com.git
cd landhllc.com/signal-broadcast
cp .env.example .env
nano .env
```

In `.env`, set your Signal number and a long password (at least 12
characters). Leave `DOMAIN` as `signalbroadcast.landhllc.com`.

If the repo is private, `git clone` will ask you to sign in to GitHub.
Copying just the `signal-broadcast` folder to the server works too.

### 4. Link it to your Signal account

```bash
sudo docker compose build
sudo docker compose run --rm app signal-cli link -n "Signal Broadcast"
```

This shows a QR code in the terminal. On your phone open Signal, go to
**Settings > Linked devices > Link new device**, and scan it.

If the QR code doesn't display properly, copy the `sgnl://linkdevice?...`
text it prints and run:

```bash
sudo docker compose run --rm app qrencode -t ansiutf8 'sgnl://linkdevice?...'
```

Then pull in your groups (use your own number):

```bash
sudo docker compose run --rm app signal-cli -a +15551234567 receive
```

### 5. Start it

```bash
sudo docker compose up -d
```

Open https://signalbroadcast.landhllc.com on your phone. The first load
can take a minute while Caddy gets the HTTPS certificate. Tip: use your
browser's "Add to Home Screen" so it opens like an app.

## Day to day

- **Groups not showing up?** Tap **Refresh groups**. The server also syncs
  with Signal on its own every 6 hours.
- **Speed.** signal-cli runs once per group, so expect a second or more
  per group. The page shows progress as it goes.
- **Logging in** keeps you signed in on that browser for 30 days. Changing
  the password in `.env` (then `sudo docker compose up -d`) signs out
  every browser.
- After 5 wrong passwords, logins are locked for 15 minutes.

## Maintenance

**Update signal-cli.** Signal changes things on their side from time to
time, and old signal-cli versions stop working. If sends start failing,
check https://github.com/AsamK/signal-cli/releases, put the new version
number in `SIGNAL_CLI_VERSION` in the `Dockerfile`, then:

```bash
sudo docker compose build && sudo docker compose up -d
```

**Update the app** after pulling new code: same command.

**Logs:** `sudo docker compose logs -f app`

**If Signal unlinks it** (for example after removing it under Linked
devices on your phone), repeat step 4.

## Security notes

- Anyone with the password can post to your groups as you. Use a long
  password you don't use elsewhere.
- The server holds your linked Signal account's keys (in the
  `signal-data` Docker volume). Treat the server like a device logged
  into your Signal. To cut it off at any time, remove "Signal Broadcast"
  under **Settings > Linked devices** on your phone.
- Like any linked device, it receives new messages in your chats while
  it's linked, so they pass through this server.
- signal-cli is not made by Signal. It is well established, but it's an
  unofficial client.
- Signal rate-limits accounts that send a lot of messages quickly. A
  handful or a few dozen groups is normal; very large blasts may get
  throttled.

## Running it locally (for testing)

Without Docker, with signal-cli installed and linked on your own computer:

```bash
BROADCAST_PASSWORD=some-long-password python3 app.py --account +15551234567
```

Then open http://127.0.0.1:8765.
