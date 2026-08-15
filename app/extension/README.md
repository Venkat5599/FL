# TAPE — browser extension

A Manifest V3 Chrome extension that surfaces a crypto influencer's
TAPE accountability stats directly on their X (Twitter) profile.

On any profile page (e.g. `https://x.com/CryptoTony__`) it injects:

1. A small **"◇ TAPE"** pill button next to the profile's
   Follow / Message / More actions.
2. A compact analytics card below that action row, fetched live from the
   TAPE API — headline P&L %, signal/scored-call counts,
   contradiction rate, TEE-verified count, and the latest call snippet.
3. Clicking the button (or the "open dossier ↗" link in the card) opens
   the full dossier for that handle in a new tab:
   `${BASE}/k/<handle>`.

No build step — plain vanilla JS/CSS, loaded directly as a content
script.

## Load it (unpacked, Chrome/Brave/Edge)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select this `extension/` folder.
5. Visit any X profile, e.g. `https://x.com/CryptoTony__` — the button
   and card should appear near the Follow button within a second or two.

Reload the extension (the circular arrow icon on its card in
`chrome://extensions`) after editing any file.

## Pointing it at a different API

The API base URL is one constant at the top of `content.js`:

```js
// Live demo runs on localhost with a live indexer. Swap to the deployed
// instance below if you're not running the app locally:
//   const BASE = "https://app-opal-omega-44.vercel.app";
const BASE = "http://localhost:3000";
```

By default it targets `http://localhost:3000` (the local dev server for
the TAPE app, which runs a live indexer). To use the hosted demo
instead, edit that line to:

```js
const BASE = "https://app-opal-omega-44.vercel.app";
```

Both origins are already declared in `manifest.json`'s
`host_permissions`, so no other changes are needed either way.

## How it works

- **Handle extraction**: the first path segment of the current URL is
  treated as the profile handle, unless it's one of X's reserved
  non-profile routes (`home`, `explore`, `notifications`, `messages`,
  `i`, `settings`, `search`, `compose`, `hashtag`, `bookmarks`, `lists`,
  `tos`, `privacy`, `about`, `login`, `signup`,
  `verified_followers`) or doesn't look like a handle. This means
  `/CryptoTony__`, `/CryptoTony__/with_replies`, `/CryptoTony__/media`,
  etc. all resolve to the same handle.
- **SPA navigation**: X never does a full page reload between profiles,
  so the script patches `history.pushState` / `history.replaceState`,
  listens for `popstate`, watches `<title>` mutations, and runs a 1s
  fallback poll — all funnel into the same recheck function, which
  diffs the extracted handle against the last-injected one and
  re-injects (or tears down) as needed.
- **Injection anchor**: it locates the profile's follow/unfollow/edit
  button (`[data-testid$="-follow"]`, `[data-testid$="-unfollow"]`, or
  `[data-testid="editProfileButton"]`) and appends the button into that
  row's parent, then inserts the card as a new block right after it. If
  the header hasn't rendered yet it retries every 500ms for ~10s, then
  gives up quietly (logs a warning, no user-facing error).
- **Duplicate guard**: the card element carries a stable id
  (`kol-root-<handle>`); before injecting, the script checks for an
  existing one and skips if present.
- All injected elements are `.kol-` prefixed and CSS-isolated with
  `all: initial` + explicit resets so they don't inherit X's ambient
  styles.

## Files

- `manifest.json` — MV3 manifest.
- `content.js` — injection, handle parsing, SPA watching, fetch, render.
- `content.css` — scoped styles for the button and card.
- `icons/` — placeholder app icons (16/48/128px), generated locally.

## Not manually verified

This was built without a real browser to test in. Before relying on it,
manually check:

- The button/card actually land next to the Follow button on a live X
  profile (X's DOM structure changes periodically; the selectors above
  are best-effort).
- Behavior when clicking between profiles via in-app links (not just
  address-bar navigation) — the SPA watcher should catch it, but this
  wasn't exercised against real X markup.
- CORS/fetch actually succeeds against a running `localhost:3000`
  instance of the app.
- Visual fit/contrast against X's own light and dark themes.
