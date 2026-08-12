"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { base, baseSepolia } from "viem/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { NetworkProvider } from "@/components/NetworkProvider";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  const wagmiTree = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>{children}</NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );

  // Privy handles email/social login + the embedded wallet (auth layer);
  // wagmi (with the injected connector) keeps driving FadeTicket's
  // connect/sign/send flow for external wallets. The two coexist rather
  // than being merged into one connector stack. If the app id isn't
  // configured, fall back to wagmi-only so the app still boots.
  if (!privyAppId) {
    return wagmiTree;
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        embeddedWallets: { ethereum: { createOnLogin: "all-users" } },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia, base],
      }}
    >
      {wagmiTree}
    </PrivyProvider>
  );
}
