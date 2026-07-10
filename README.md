# landhllc.com

## AI Blob Simulation (`simulation.html`)

A 2D life simulation: colored blobs wander the canvas, and when two get close
they have a real, AI-generated conversation (via Claude) driven by each
color's editable personality / role / faith / purpose. Click a blob to see
its conversation and edit its species' prompts live. Add or remove species
from the sidebar.

### Deploying (Netlify)

This needs a serverless function to keep the Anthropic API key off the
client, so it runs on Netlify rather than plain GitHub Pages:

1. In Netlify: **Add new site > Import an existing project**, pick this repo.
2. Build settings are already defined in `netlify.toml` (publish `.`,
   functions in `netlify/functions`) — no build command needed.
3. Site settings > Environment variables: add `ANTHROPIC_API_KEY` with your
   Anthropic API key. Optionally set `SIM_MODEL` to override the default
   model (`claude-haiku-4-5-20251001`).
4. Domain settings: point `landhllc.com` (the domain in `CNAME`) at this
   Netlify site instead of GitHub Pages, then the GitHub Pages deployment
   for this repo can be turned off.

### Cost/abuse guardrails already in place

- Each browser session is capped at 60 AI conversation calls (`simulation.js`,
  `SESSION_REQUEST_CAP`), with a visible counter in the UI.
- At most 2 AI requests are in flight at once.
- Blobs that just finished a conversation wait 15s before starting another.
- The AI toggle in the header lets you pause all outbound calls entirely.

There's no per-visitor rate limiting on the function itself, so heavy traffic
to the page will drive real API usage/cost on your Anthropic account — the
session cap bounds a single visitor, not total site traffic.
