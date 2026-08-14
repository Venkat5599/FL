import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

import { FLARE_NETWORKS, toViemChain } from "./flare";

// Wallet connection for TAPE, on Flare.
//
// Chain definitions are derived from lib/flare.ts rather than imported from
// wagmi/chains, for two reasons: Coston2 is not in wagmi's bundled chain list, and
// keeping one definition means the RPC and explorer a wallet is asked to add cannot
// drift from the ones the rest of the app reads.
export const coston2 = toViemChain(FLARE_NETWORKS.coston2);
export const songbird = toViemChain(FLARE_NETWORKS.songbird);
export const flare = toViemChain(FLARE_NETWORKS.flare);

/// Coston2 first: it is the default everywhere else in the app, and defaulting a wallet
/// to a live network would put an accidental mainnet transaction one misclick away.
export const wagmiConfig = createConfig({
  chains: [coston2, flare, songbird],
  connectors: [injected()],
  transports: {
    [coston2.id]: http(FLARE_NETWORKS.coston2.rpcUrl),
    [flare.id]: http(FLARE_NETWORKS.flare.rpcUrl),
    [songbird.id]: http(FLARE_NETWORKS.songbird.rpcUrl),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
