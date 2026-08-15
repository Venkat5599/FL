"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { NetworkProvider } from "@/components/NetworkProvider";

/**
 * One provider stack, one connector, one identity.
 *
 * This previously mounted a hosted auth service alongside wagmi, which meant two systems
 * could each believe they owned the session and the app had to reconcile them on every
 * page. The wallet is now the only identity: it connects through wagmi and proves itself
 * to the server by signing a nonce (see lib/useAuth.ts).
 *
 * That is also the honest arrangement for this product. TAPE's whole argument is that no
 * link in the record depends on trusting an intermediary; routing users' keys through a
 * third party to log them in would have undercut the claim on the login screen.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>{children}</NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
