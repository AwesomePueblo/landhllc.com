# Drink Runner

Guests order a drink from their phone and share their GPS location. The
bartender works a live queue, and a runner sees distance, direction and a
Maps link to each guest.

Runs as its own Netlify site (bar.landhllc.com) from this repo.

## Netlify setup

1. Netlify: Add new site > Import an existing project > this GitHub repo.
2. Base directory: `drink-runner`. Leave build command empty. Publish
   directory and functions are read from `drink-runner/netlify.toml`.
3. Domain management > Add a domain > `bar.landhllc.com`.
   If landhllc.com uses Netlify DNS this is automatic. Otherwise add a
   CNAME record `bar` pointing to the new site's `*.netlify.app` name.

## Storage

Bars and orders are stored in Netlify Blobs (store `bar`), which comes
with every Netlify site. No database account or keys needed.

- `events/<eventId>`: bar name, menu, open/paused, hash of the staff key
- `orders/<eventId>/<orderId>`: one record per drink, including the
  guest's name, description and last GPS fix

## Pages

- `/` with no `?e=`: start a new bar
- `/?e=<eventId>`: guest ordering (share via QR code)
- `/staff.html#e=<eventId>&k=<staffKey>`: bartender and runner queue
