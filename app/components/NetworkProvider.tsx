"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type Network, isNetwork } from "@/lib/networks";

interface NetworkState {
  network: Network;
  setNetwork: (n: Network) => void;
  ready: boolean; // false until the persisted choice is read, avoids SSR flash
}

const Ctx = createContext<NetworkState>({ network: "testnet", setNetwork: () => {}, ready: false });
const KEY = "kollateral.network";

// App-wide active-network store. Trades, balances, and the vault display all
// read this. Defaults to testnet (no real funds) until the user opts into
// mainnet via the header toggle; the choice persists across reloads.
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<Network>("testnet");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (isNetwork(saved)) setNetworkState(saved);
    } catch {
      /* localStorage unavailable */
    }
    setReady(true);
  }, []);

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
