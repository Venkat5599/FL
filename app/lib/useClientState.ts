"use client";

/**
 * Hooks for reading browser-only state without a setState-in-effect.
 *
 * The pattern these replace was everywhere in this app:
 *
 *   const [mounted, setMounted] = useState(false);
 *   useEffect(() => setMounted(true), []);
 *
 * It works, but it is a render-then-immediately-render-again, and the React
 * Compiler flags it (react-hooks/set-state-in-effect) because a synchronous
 * setState inside an effect schedules a second pass before the browser paints.
 *
 * `useSyncExternalStore` is the built-in answer. It takes a server snapshot and
 * a client snapshot, so React resolves the difference during hydration itself
 * rather than through an extra state round trip. Fewer renders, no effect, and
 * it is the API React added for exactly this problem.
 */
import { useCallback, useSyncExternalStore } from "react";

/** No external source to subscribe to — these values never change after mount. */
const noopSubscribe = () => () => {};

/**
 * True once the component has hydrated on the client, false during SSR and the
 * first client render.
 *
 * Use it to gate anything that would otherwise render differently on server and
 * client (wallet state, auth state, locale-formatted times) and produce a
 * hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true, // client
    () => false, // server
  );
}

/**
 * Read a localStorage key reactively.
 *
 * Returns `null` on the server and until hydration, which matches what the old
 * effect-based version rendered on its first pass — so this is a drop-in swap,
 * not a behaviour change.
 *
 * It also subscribes to the `storage` event, which the effect version did not:
 * changing the network or pinning a token in one tab now updates the others.
 * That is a genuine improvement that falls out of using the right primitive.
 */
export function useLocalStorageValue(key: string): string | null {
  const subscribe = useCallback((onChange: () => void) => {
    // `storage` fires in OTHER tabs, so same-tab writes still need whatever
    // local state the caller keeps. Callers here write through their own
    // setState, so both paths stay in sync.
    const handler = (e: StorageEvent) => {
      if (e.key === key || e.key === null) onChange();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [key]);

  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      // Private mode, disabled storage, or a sandboxed iframe. Treat as unset
      // rather than throwing through a render.
      return null;
    }
  }, [key]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/**
 * The current unix time in seconds, as a reactive value.
 *
 * `Date.now()` called straight from a render body is an impure read
 * (react-hooks/purity flags it), and it is also subtly wrong for this app: a
 * countdown like "12d left" computed during render freezes until something
 * else happens to re-render the component.
 *
 * The clock is an external mutable source, which is exactly what
 * useSyncExternalStore is for. Ticking every 30s is plenty for day- and
 * hour-scale resolution counters and avoids a per-second re-render of the feed.
 *
 * The server snapshot is 0, so the first client render matches the server; the
 * real time arrives on hydration. Callers already guard against a zero clock by
 * rendering relative labels only once mounted.
 */
export function useNowSeconds(): number {
  return useSyncExternalStore(subscribeToClock, getClockSnapshot, () => 0);
}

// getSnapshot must return a value that does not change between calls within one
// render, or React re-renders in a loop trying to converge. Reading Date.now()
// directly would eventually straddle a second boundary mid-render and trip
// exactly that. So the value is cached in module scope and only advanced when
// the interval fires.
let clockSnapshot = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function getClockSnapshot(): number {
  if (clockSnapshot === 0) clockSnapshot = Math.floor(Date.now() / 1000);
  return clockSnapshot;
}

function subscribeToClock(onChange: () => void): () => void {
  clockListeners.add(onChange);
  // One shared timer for every consumer, started with the first subscriber and
  // stopped with the last — a feed of 100 cards should not hold 100 intervals.
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      clockSnapshot = Math.floor(Date.now() / 1000);
      for (const listener of clockListeners) listener();
    }, 30_000);
  }
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
