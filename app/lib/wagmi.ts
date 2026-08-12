import { createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// FADE/FOLLOW execution chains: Base Sepolia ("testnet") and Base mainnet
// ("mainnet"). The header toggle picks the active one; balances and the manual
// swap ticket read the selected chain. Testnet is the default (no real funds).
export const wagmiConfig = createConfig({
  chains: [baseSepolia, base],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: http(),
    [base.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
