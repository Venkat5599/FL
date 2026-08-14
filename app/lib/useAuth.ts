"use client";

import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";

/**
 * One answer to "is this user signed in", regardless of which mechanism is available.
 *
 * The bug this exists to kill: `usePrivy()` returns `ready: false` forever when no
 * PrivyProvider is mounted, which is the normal state whenever NEXT_PUBLIC_PRIVY_APP_ID
 * is unset. Pages gating on `!ready` therefore sat on "loading auth…" permanently — not
 * failing, just never resolving, which is the most confusing way for something to break.
 *
 * The resolution order reflects which mechanism actually owns the session:
 *
 *   1. Privy, when it is configured AND reports ready. It manages an embedded wallet and
 *      a server-verifiable token, so where it is in play it is authoritative.
 *   2. Otherwise the connected wallet, via wagmi. This path always exists.
 *
 * `ready` is true in the second case immediately, because there is nothing to wait for:
 * a wallet is either connected or it is not.
 */
export interface AuthState {
  /** Auth state has resolved. Never stays false waiting on an unmounted provider. */
  ready: boolean;
  /** Signed in by either mechanism. */
  authenticated: boolean;
  /** The user's address, when one is known. */
  address: `0x${string}` | undefined;
  /** Which mechanism answered, for UI that needs to differ. */
  via: "privy" | "wallet" | null;
}

export function useAuth(): AuthState {
  // Reading both unconditionally keeps hook order stable across renders, which is
  // required — a conditional hook call here would break React's rules the moment Privy's
  // configured state changed.
  const { ready: privyReady, authenticated: privyAuthed, user } = usePrivy();
  const { address, isConnected } = useAccount();

  const privyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  if (privyConfigured && privyReady) {
    const privyAddress = user?.wallet?.address as `0x${string}` | undefined;
    return {
      ready: true,
      authenticated: privyAuthed,
      address: privyAddress ?? address,
      via: privyAuthed ? "privy" : null,
    };
  }

  // Privy absent (or still initialising while unconfigured, which is forever): the
  // wallet is the session.
  return {
    ready: true,
    authenticated: isConnected,
    address,
    via: isConnected ? "wallet" : null,
  };
}
