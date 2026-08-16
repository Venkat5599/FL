"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { type Network, isNetwork } from "@/lib/networks";
import { useHydrated, useLocalStorageValue } from "@/lib/useClientState";

interface NetworkState {
  network: Network;
  setNetwork: (n: Network) => void;
  ready: boolean; // false until the persisted choice is read, avoids SSR flash
}

const Ctx = createContext<NetworkState>({ network: "testnet", setNetwork: () => {}, ready: false });
const KEY = "tape.network";

// App-wide active-network store. Trades, balances, and the vault display all
// read this. Defaults to testnet (no real funds) until the user opts into
// mainnet via the header toggle; the choice persists across reloads.
export function NetworkProvider({ children }: { children: ReactNode }) {
  // Read the persisted choice through useSyncExternalStore instead of a
  // setState-in-effect. `ready` now means "hydrated", which is what it always
  // actually meant — the old version set it in the same effect that read
  // storage, so it was a hydration flag wearing a different name.
  //
  // `override` carries a switch made in THIS tab. The storage event only fires
  // for other tabs, so without it the toggle would not update the tab you
  // clicked in.
  const stored = useLocalStorageValue(KEY);
  const ready = useHydrated();
  const [override, setOverride] = useState<Network | null>(null);
  const network: Network = override ?? (isNetwork(stored) ? stored : "testnet");
  const setNetworkState = setOverride;

  function setNetwork(n: Network) {
    setNetworkState(n);
    try {
      localStorage.setItem(KEY, n);
    } catch {
      /* ignore */
    }
  }

  return <Ctx.Provider value={{ network, setNetwork, ready }}>{children}</Ctx.Provider>;
}

export function useNetwork() {
  return useContext(Ctx);
}
