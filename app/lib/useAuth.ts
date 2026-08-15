"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSignMessage } from "wagmi";

import { SIWE_STATEMENT, buildSiweMessage } from "./siwe";

/**
 * One answer to "is this user signed in", and one way to become signed in.
 *
 * There are two distinct states here and conflating them is the bug this hook exists to
 * prevent:
 *
 *   CONNECTED  the wallet is available and we know an address. Enough to read public
 *              chain data and to build a transaction. Proves nothing about identity —
 *              a browser extension asserting an address is not a claim the server can
 *              act on.
 *   SIGNED IN  the address signed a nonce the server issued, and the server handed back
 *              a session cookie. This is what gates allocations, portfolio and trades.
 *
 * A user can be connected without being signed in (they connected but have not signed
 * yet) and — briefly, after a wallet switch — signed in as an address they are no longer
 * connected with. The second case is handled explicitly below rather than left to drift.
 */
export interface AuthState {
  /** Auth state has resolved — the session probe has come back. */
  ready: boolean;
  /** A wallet is connected. Not identity. */
  connected: boolean;
  /** The server has a verified session for `address`. */
  authenticated: boolean;
  /** The connected wallet's address. */
  address: `0x${string}` | undefined;
  /** True while a sign-in is in flight. */
  signingIn: boolean;
  /** Why the last sign-in attempt failed, if it did. */
  error: string | null;
  /** Connect a wallet (no signature). */
  connect: () => void;
  /** Run the full SIWE handshake. Connects first if needed. */
  signIn: () => Promise<void>;
  /** Drop the server session. Leaves the wallet connected. */
  signOut: () => Promise<void>;
  /** Drop the session and disconnect the wallet. */
  disconnect: () => Promise<void>;
}

export function useAuth(): AuthState {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ask the server who we are on mount. The session cookie is httpOnly, so this is the
  // only way to find out — and it means a returning user with a live session is signed
  // in without touching their wallet.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d: { address: string | null }) => {
        if (!cancelled) setSessionAddress(d.address);
      })
      .catch(() => {
        if (!cancelled) setSessionAddress(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A session for an address the user is no longer connected with is stale. Treating it
  // as valid would show account B's portfolio to whoever is now holding the browser,
  // which is exactly the confusion a wallet switch should not cause.
  const authenticated =
    sessionAddress !== null && isConnected && sessionAddress === address?.toLowerCase();

  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];

  const connect = useCallback(() => {
    if (injected) void connectAsync({ connector: injected }).catch(() => {});
  }, [connectAsync, injected]);

  const signIn = useCallback(async () => {
    setError(null);
    setSigningIn(true);
    try {
      // Connect first if needed, and use the address this call returns rather than the
      // one from the last render — `address` is still undefined on the render where the
      // connection completes, and signing with it would produce a message for nobody.
      let signer = address;
      if (!signer) {
        if (!injected) throw new Error("no browser wallet detected");
        const res = await connectAsync({ connector: injected });
        signer = res.accounts[0];
      }
      if (!signer) throw new Error("no account available");

      const { nonce } = await fetch("/api/auth/nonce").then((r) => r.json());

      const message = buildSiweMessage({
        domain: window.location.host,
        address: signer,
        statement: SIWE_STATEMENT,
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const signature = await signMessageAsync({ account: signer, message });

      const verify = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });

      if (!verify.ok) {
        const { error: reason } = await verify.json().catch(() => ({ error: "sign-in failed" }));
        throw new Error(reason ?? "sign-in failed");
      }

      const { address: verified } = await verify.json();
      setSessionAddress(verified);
    } catch (e) {
      // A user closing the wallet prompt is not an error worth shouting about; it is
      // the most common outcome of clicking sign-in and changing your mind.
      const msg = e instanceof Error ? e.message : "sign-in failed";
      setError(/rejected|denied|User rejected/i.test(msg) ? null : msg);
    } finally {
      setSigningIn(false);
    }
  }, [address, chainId, connectAsync, injected, signMessageAsync]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    setSessionAddress(null);
  }, []);

  const disconnect = useCallback(async () => {
    await signOut();
    await disconnectAsync().catch(() => {});
  }, [disconnectAsync, signOut]);

  return {
    ready,
    connected: isConnected,
    authenticated,
    address,
    signingIn,
    error,
    connect,
    signIn,
    signOut,
    disconnect,
  };
}
