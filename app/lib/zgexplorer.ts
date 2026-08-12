// 0G Chain explorer links.
//
// A 0G Compute provider (and its on-chain-attested TEE signer) is a real account
// in the 0G Serving contract on 0G Chain, so an address link lets anyone confirm
// the serving node exists and is registered. Individual inference requests are
// NOT standalone on-chain transactions (payments settle in batches via the
// ledger contract), so we only link addresses, not chat/request ids.
//
// The base is overridable with NEXT_PUBLIC_ZG_EXPLORER. Default targets the
// testnet (Galileo) explorer, since the demo inference runs on the free testnet
// model; point it at the mainnet explorer when using mainnet TeeML providers.
const DEFAULT_EXPLORER = "https://chainscan-galileo.0g.ai";

function base(): string {
  const b = process.env.NEXT_PUBLIC_ZG_EXPLORER || DEFAULT_EXPLORER;
  return b.replace(/\/+$/, "");
}

export function zgAddressUrl(addr: string): string {
  return `${base()}/address/${addr}`;
}

export function zgTxUrl(tx: string): string {
  return `${base()}/tx/${tx}`;
}
