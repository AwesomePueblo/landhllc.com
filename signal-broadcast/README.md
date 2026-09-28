# Signal Broadcast

A small app that runs on your laptop and lets you tick off several Signal
groups and send the same message to all of them at once.

- Search your groups, check the ones you want, write the message, hit Send.
- Save selections as named lists (e.g. "All tenants", "Board") and reload
  them later.
- Shows a check or an error for every group, with a "Retry failed" button.
- Asks for confirmation (listing every group) before anything is sent.
- Runs only on your machine (`127.0.0.1`). Nothing is hosted anywhere.

## How it works

Signal has no official API for this, so the app uses
[signal-cli](https://github.com/AsamK/signal-cli), a widely used open
source command-line Signal client. You link signal-cli to your existing
Signal account as a **linked device**, the same way Signal Desktop is
linked. Messages go out from your own number, and they show up in your
phone's chats like anything else you send.

The app itself is one Python file (`app.py`) plus a web page
(`index.html`). It uses only the Python standard library.

## One-time setup

### 1. Install signal-cli

**Mac (Homebrew):**

```bash
brew install signal-cli
```

**Windows / Linux:** download the latest release from
https://github.com/AsamK/signal-cli/releases and follow its install
notes. signal-cli needs a recent Java runtime; check the signal-cli README
for the exact version the release you download requires.

Check it works:

```bash
signal-cli --version
```

### 2. Link it to your Signal account

```bash
signal-cli link -n "Broadcast laptop"
```

This prints a `sgnl://linkdevice?...` link (and a QR code if your
terminal supports it). On your phone open Signal, go to
**Settings > Linked devices > Link new device**, and scan it.

If you only see the text link and no QR code, turn it into a QR code, for
example with `qrencode -t ansi "sgnl://linkdevice?..."` (install
`qrencode` with Homebrew), then scan that.

### 3. Pull in your groups

```bash
signal-cli -a +15551234567 receive
```

Use your own number with country code. This syncs your groups onto the
laptop. You can also do this later from the app with **Refresh groups**.

### 4. Python

The app needs Python 3.8 or newer. Macs usually have `python3` already;
check with `python3 --version`.

## Running it

```bash
cd signal-broadcast
python3 app.py --account +15551234567
```

Your browser opens to http://127.0.0.1:8765. Press `Ctrl+C` in the
terminal to stop it.

Options:

| Option | What it does |
| --- | --- |
| `--account` / `-a` | Your Signal number, e.g. `+15551234567`. You can set `SIGNAL_ACCOUNT` instead. |
| `--signal-cli` | Path to signal-cli if it's not on your PATH. You can set `SIGNAL_CLI` instead. |
| `--port` | Port to run on (default 8765). |
| `--no-browser` | Don't open a browser tab automatically. |

## Good to know

- **Speed.** signal-cli starts up fresh for each group, so expect a few
  seconds per group. The page shows progress as it goes.
- **Groups not showing up?** Click **Refresh groups**. It asks Signal's
  servers for updates (new groups, renames). Groups you've left or blocked
  are hidden.
- **Keep it synced.** A linked device that never checks in can fall out
  of sync. Opening the app and clicking **Refresh groups** now and then
  keeps it current. If Signal ever unlinks it, run step 2 again.
- **Unofficial client.** signal-cli is not made by Signal. It is well
  established, but Signal can change things on their side that break it
  until signal-cli releases an update. If sends start failing, update
  signal-cli (`brew upgrade signal-cli`).
- **Don't spam.** Signal rate-limits accounts that send a lot of messages
  quickly. Sending to a handful or a few dozen groups is normal use;
  very large blasts may get throttled.
- **Saved lists** are stored in your browser on this laptop only.
