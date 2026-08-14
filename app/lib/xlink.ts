// Resolve X (Twitter) links so they never 404.
//
// Documented/curated calls carry synthetic post URLs
// (…/status/lark_ILV_1683113400) that don't exist on X, whereas scraped calls
// carry real numeric tweet ids that do. Real tweets keep their link; documented
// calls fall back to the creator's live X profile (x.com/<handle>), which is
// valid for our creators.
//
// X_HANDLE only overrides the rare case where a display handle differs from the
// real X handle. It's empty for now (all current handles are their real X
// handle, including LarkDavis -> x.com/LarkDavis).
const X_HANDLE: Record<string, string> = {};

export function xHandle(handle: string): string {
  return X_HANDLE[handle.toLowerCase()] ?? handle;
}

export function xProfileUrl(handle: string): string {
  return `https://x.com/${xHandle(handle)}`;
}

// A real tweet URL ends in /status/<digits>.
export function isRealTweetUrl(url: string | null | undefined): boolean {
  return !!url && /\/status\/\d+(?:[/?#]|$)/.test(url);
}

// A link that always resolves.
export function resolveTweetUrl(url: string | null | undefined, handle: string): string {
  if (isRealTweetUrl(url)) {
    const real = xHandle(handle);
    if (url && real.toLowerCase() !== handle.toLowerCase()) {
      return url.replace(/x\.com\/[^/]+\/status/i, `x.com/${real}/status`);
    }
    return url as string;
  }
  return xProfileUrl(handle);
}
