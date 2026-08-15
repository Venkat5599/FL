// TAPE — background service worker.
//
// Why this file exists at all: the content script runs inside https://x.com, so every
// request it makes is judged against that page's origin. A request to
// http://localhost:3000 from there is mixed content, and Chrome blocks it before the
// extension's host permissions ever get a say. The card then renders "couldn't reach
// TAPE" on a machine where the API is plainly running, which is a miserable thing to
// debug.
//
// A service worker is not a page. Its fetches run on the extension's own origin, where
// host_permissions do apply and mixed-content rules do not. So all network access lives
// here, and the content script asks for data by message instead of fetching it. That is
// the intended MV3 shape, not a workaround.
"use strict";

// Ordered by preference: a local dev server if one is up, otherwise production. Probing
// in order means the same published build works while developing and after install.
const ENDPOINTS = ["http://localhost:3000", "https://tape-flare.vercel.app"];

// Which endpoint answered last. Cached because a service worker may be woken for every
// message and re-probing both origins each time would add a round trip to every profile
// visit. Cleared when a request against it fails, so a dev server that goes down does
// not pin the extension to a dead origin for the rest of the session.
let resolved = null;

async function probe(base) {
  try {
    const res = await fetch(`${base}/api/influencers`, {
      method: "HEAD",
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveBase() {
  if (resolved) return resolved;
  for (const candidate of ENDPOINTS) {
    if (await probe(candidate)) {
      resolved = candidate;
      console.log("[TAPE] using", resolved);
      return resolved;
    }
  }
  // Nothing answered. Return production without caching it, so the next attempt probes
  // again rather than being stuck with a guess.
  return ENDPOINTS[ENDPOINTS.length - 1];
}

async function fetchCreator(handle) {
  const base = await resolveBase();
  try {
    const res = await fetch(`${base}/api/creator/${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return { ok: true, base, data: await res.json() };
  } catch (e) {
    // Drop the cached endpoint: whatever answered the probe is not serving now.
    resolved = null;
    return { ok: false, base, error: String(e && e.message ? e.message : e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "TAPE_CREATOR") {
    fetchCreator(msg.handle).then(sendResponse);
    // Returning true keeps the message channel open for the async reply. Without it the
    // channel closes immediately and sendResponse silently does nothing.
    return true;
  }
  if (msg && msg.type === "TAPE_BASE") {
    resolveBase().then((base) => sendResponse({ base }));
    return true;
  }
  return false;
});
