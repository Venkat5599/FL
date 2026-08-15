// TAPE — X/Twitter profile content script
//
// Injects a "◇ TAPE" button and a compact record card on profile pages, so the
// accountability data sits where the calls are actually made rather than behind a tab
// switch. Everything it shows is sourced from the TAPE API, which in turn reads the
// Flare chain: posts attested by FDC, marks taken from FTSOv2.
"use strict";

(() => {
  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  // All network access lives in the background service worker (background.js).
  //
  // A content script's fetches are judged against https://x.com, so a request to a local
  // http://localhost dev server is blocked as mixed content before host permissions are
  // consulted. The worker runs on the extension's own origin and has neither problem, so
  // this script asks it for data instead of fetching directly.
  function askWorker(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (reply) => {
          // An extension reload orphans this content script; the callback then fires
          // with lastError set and no reply. Swallow it rather than throwing into the
          // page, and let the card fall back to its error state.
          if (chrome.runtime.lastError || !reply) resolve(null);
          else resolve(reply);
        });
      } catch {
        resolve(null);
      }
    });
  }

  const LOG = (...args) => console.log("[TAPE]", ...args);
  const WARN = (...args) => console.warn("[TAPE]", ...args);

  // Route segments on x.com/twitter.com that are NOT profile handles.
  const RESERVED = new Set([
    "home", "explore", "notifications", "messages", "i", "settings", "search",
    "compose", "hashtag", "bookmarks", "lists", "tos", "privacy", "about",
    "login", "signup", "verified_followers",
  ]);

  const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

  const CACHE_TTL_MS = 60_000;
  const dataCache = new Map(); // handle(lowercase) -> { at, promise|data }

  // ---------------------------------------------------------------------
  // Handle extraction
  // ---------------------------------------------------------------------
  function extractHandle(pathname) {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const first = decodeURIComponent(segments[0]);
    if (RESERVED.has(first.toLowerCase())) return null;
    if (!HANDLE_RE.test(first)) return null;
    return first;
  }

  // ---------------------------------------------------------------------
  // SPA navigation watcher
  // ---------------------------------------------------------------------
  let currentHandle = null;
  let pollTimer = null;

  function scheduleCheck(delay = 0) {
    setTimeout(checkAndInject, delay);
  }

  function patchHistoryAPI() {
    const fire = () => window.dispatchEvent(new Event("kol:locationchange"));
    const wrap = (name) => {
      const orig = history[name];
      return function (...args) {
        const ret = orig.apply(this, args);
        fire();
        return ret;
      };
    };
    history.pushState = wrap("pushState");
    history.replaceState = wrap("replaceState");
    window.addEventListener("popstate", fire);
    window.addEventListener("kol:locationchange", () => scheduleCheck(150));
  }

  function startPolling() {
    // Cheap safety-net poll in case X navigates without pushState/replaceState
    // (or fires it before the DOM actually updates).
    if (pollTimer) return;
    pollTimer = setInterval(checkAndInject, 1000);
  }

  function checkAndInject() {
    let handle;
    try {
      handle = extractHandle(window.location.pathname);
    } catch (err) {
      WARN("failed to parse handle from URL", err);
      return;
    }

    if (handle !== currentHandle) {
      currentHandle = handle;
      cleanupWidget();
      if (handle) {
        LOG("profile detected:", handle);
        injectWithRetry(handle);
      }
      return;
    }

    // Same handle: make sure our widget is still present (X sometimes
    // re-renders the header and wipes injected nodes).
    if (handle && !document.getElementById(widgetRootId(handle))) {
      injectWithRetry(handle);
    }
  }

  // ---------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------
  function widgetRootId(handle) {
    return `kol-root-${handle.toLowerCase()}`;
  }

  function findActionsRow() {
    // Anchor on the follow/unfollow/edit-profile button, which is present
    // on every profile header regardless of relationship state.
    const anchor = document.querySelector(
      '[data-testid$="-follow"], [data-testid$="-unfollow"], [data-testid="editProfileButton"]'
    );
    if (!anchor) return null;
    // The button's grandparent is typically the flex row holding all of
    // the header's action buttons (follow, message, more-options, etc).
    const row = anchor.parentElement?.parentElement;
    return row || anchor.parentElement || anchor;
  }

  function cleanupWidget() {
    document.querySelectorAll("[data-kol-widget]").forEach((el) => el.remove());
  }

  let retryTimer = null;

  function injectWithRetry(handle) {
    if (retryTimer) clearInterval(retryTimer);
    let attempts = 0;
    const maxAttempts = 20; // ~10s at 500ms
    retryTimer = setInterval(() => {
      attempts += 1;
      if (currentHandle !== handle) {
        clearInterval(retryTimer);
        return;
      }
      if (document.getElementById(widgetRootId(handle))) {
        clearInterval(retryTimer);
        return;
      }
      const row = findActionsRow();
      if (row) {
        clearInterval(retryTimer);
        mountWidget(handle, row);
      } else if (attempts >= maxAttempts) {
        clearInterval(retryTimer);
        WARN("could not find profile header actions row for", handle, "— giving up");
      }
    }, 500);
  }

  // ---------------------------------------------------------------------
  // Widget construction
  // ---------------------------------------------------------------------
  function mountWidget(handle, actionsRow) {
    if (document.getElementById(widgetRootId(handle))) return; // dup guard
    applyTheme();

    // No injected pill: it landed on its own line and pushed X's own action
    // buttons down. The card mounts on its own below the action row, and it
    // carries the "open dossier" link, so a separate button is redundant.

    // Card, inserted as its own row right after the actions row. This
    // element's id is the dup-guard marker checked by checkAndInject().
    const card = document.createElement("div");
    card.id = widgetRootId(handle);
    card.className = "kol-card kol-card-loading";
    card.dataset.kolWidget = handle.toLowerCase();
    card.innerHTML = renderLoading();
    try {
      actionsRow.insertAdjacentElement("afterend", card);
    } catch (err) {
      WARN("failed to insert card after actions row — appending to body as fallback", err);
      document.body.appendChild(card);
    }

    LOG("injected widget for", handle);

    fetchCreator(handle)
      .then((data) => {
        if (currentHandle !== handle) return; // navigated away meanwhile
        card.className = "kol-card";
        card.innerHTML = data.found ? renderFound(data) : renderNotFound(data);
        wireCardInteractions(card, handle);
      })
      .catch((err) => {
        WARN("fetch failed for", handle, err);
        if (currentHandle !== handle) return;
        card.className = "kol-card kol-card-error";
        card.innerHTML = renderError();
        wireCardInteractions(card, handle);
      });
  }

  function wireCardInteractions(card, handle) {
    const dismiss = card.querySelector(".kol-dismiss");
    if (dismiss) {
      dismiss.addEventListener("click", () => {
        card.style.display = "none";
      });
    }
    const openLink = card.querySelector(".kol-open");
    if (openLink) {
      openLink.addEventListener("click", (e) => {
        e.preventDefault();
        askWorker({ type: "TAPE_BASE" }).then((r) => window.open(`${(r && r.base) || "https://tape-flare.vercel.app"}/k/${encodeURIComponent(handle)}`, "_blank", "noopener,noreferrer"));
      });
    }
    const retry = card.querySelector(".kol-retry");
    if (retry) {
      retry.addEventListener("click", () => {
        card.className = "kol-card kol-card-loading";
        card.innerHTML = renderLoading();
        dataCache.delete(handle.toLowerCase());
        fetchCreator(handle)
          .then((data) => {
            if (currentHandle !== handle) return;
            card.className = "kol-card";
            card.innerHTML = data.found ? renderFound(data) : renderNotFound(data);
            wireCardInteractions(card, handle);
          })
          .catch(() => {
            if (currentHandle !== handle) return;
            card.className = "kol-card kol-card-error";
            card.innerHTML = renderError();
            wireCardInteractions(card, handle);
          });
      });
    }
  }

  // ---------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------
  async function fetchCreator(handle) {
    const key = handle.toLowerCase();
    const cached = dataCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.promise;
    }
    const promise = (async () => {
      const reply = await askWorker({ type: "TAPE_CREATOR", handle });
      if (!reply) throw new Error("extension worker unavailable — reload the extension");
      if (!reply.ok) throw new Error(reply.error || "request failed");
      return reply.data;
    })();
    dataCache.set(key, { at: Date.now(), promise });
    try {
      return await promise;
    } catch (err) {
      dataCache.delete(key); // don't cache failures
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function esc(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
  }

  function fmtPct(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  }

  function pctClass(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "";
    return n > 0 ? "kol-pos" : n < 0 ? "kol-neg" : "";
  }

  // Match X's active theme (Default / Dim / Lights out) by reading the page
  // background luminance, so the card doesn't sit as a bright slab on dark X.
  function applyTheme() {
    let theme = "dark";
    try {
      const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
      if (m && m.length >= 3) {
        const lum = 0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2];
        theme = lum < 128 ? "dark" : "light";
      }
    } catch {
      /* default dark */
    }
    document.documentElement.setAttribute("data-kol-theme", theme);
  }

  function renderHeader() {
    return `
      <div class="kol-card-head">
        <span class="kol-mark">◇</span>
        <span class="kol-brand">TAPE</span>
        <button type="button" class="kol-dismiss" title="Hide" aria-label="Hide">×</button>
      </div>`;
  }

  function renderLoading() {
    return `
      ${renderHeader()}
      <div class="kol-body kol-loading-body">
        <div class="kol-skel kol-skel-lg"></div>
        <div class="kol-skel kol-skel-sm"></div>
        <div class="kol-skel kol-skel-sm"></div>
      </div>`;
  }

  function renderError() {
    return `
      ${renderHeader()}
      <div class="kol-body">
        <p class="kol-msg">Couldn't reach TAPE. Is the API running?</p>
        <div class="kol-actions">
          <button type="button" class="kol-retry kol-linkbtn">retry</button>
        </div>
      </div>`;
  }

  function renderNotFound(data) {
    return `
      ${renderHeader()}
      <div class="kol-body">
        <p class="kol-msg">@${esc(data.handle)} isn't on TAPE yet.</p>
        <div class="kol-actions">
          <a href="#" class="kol-open kol-linkbtn">open dossier ↗</a>
        </div>
      </div>`;
  }

  function renderFound(data) {
    const headline = fmtPct(data.headlinePct);
    const headlineClass = pctClass(data.headlinePct);
    // API already returns contradiction as a 0-100 percentage, do not scale again.
    const contradictionPct = Math.round(data.contradictionRate ?? 0);
    const contraClass = contradictionPct >= 40 ? "kol-neg" : contradictionPct >= 15 ? "kol-warn" : "";

    let latestHtml = "";
    if (data.latest) {
      const dir = data.latest.direction ? esc(String(data.latest.direction).toUpperCase()) : "";
      const asset = data.latest.asset ? esc(data.latest.asset) : "";
      const ret = data.latest.retPct !== null && data.latest.retPct !== undefined
        ? `<span class="${pctClass(data.latest.retPct)}">${fmtPct(data.latest.retPct)}</span>`
        : "";
      const snippet = esc(data.latest.content || "").slice(0, 120);
      latestHtml = `
        <div class="kol-latest">
          <div class="kol-latest-tag">${dir}${asset ? " " + asset : ""} ${ret}</div>
          <div class="kol-latest-snippet">"${snippet}${(data.latest.content || "").length > 120 ? "…" : ""}"</div>
        </div>`;
    }

    return `
      ${renderHeader()}
      <div class="kol-body">
        <div class="kol-headline">
          <span class="kol-headline-num ${headlineClass}">${headline}</span>
          <span class="kol-headline-label">$1k into every call, marked by FTSOv2</span>
        </div>
        <div class="kol-stats-row">
          <div class="kol-stat">
            <span class="kol-stat-num">${data.signalCount ?? 0}</span>
            <span class="kol-stat-label">signals</span>
          </div>
          <div class="kol-stat">
            <span class="kol-stat-num">${data.callCount ?? 0}</span>
            <span class="kol-stat-label">scored calls</span>
          </div>
          <div class="kol-stat">
            <span class="kol-stat-num ${contraClass}">${contradictionPct}%</span>
            <span class="kol-stat-label">contradiction</span>
          </div>
        </div>
        ${latestHtml}
        <div class="kol-footer">
          <span class="kol-verified">${
            (data.deleted ?? 0) > 0
              ? `◇ ${data.deleted} deleted, still on the record`
              : `◇ on ${esc(data.network?.name ?? "Flare")}`
          }</span>
          <a href="#" class="kol-open kol-linkbtn">open dossier ↗</a>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    patchHistoryAPI();
    startPolling();

    // X updates <title> on client-side profile navigations; cheap extra signal.
    const titleEl = document.querySelector("title");
    if (titleEl) {
      new MutationObserver(() => scheduleCheck(150)).observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    checkAndInject();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
