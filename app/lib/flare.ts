// Flare chain configuration and system-contract resolution.
//
// Everything on-chain in TAPE goes through here, for one reason: Flare exposes its
// protocol contracts through a single registry rather than through a list of addresses
// you paste into a config file. Resolving names at runtime means the app keeps working
// when Flare upgrades a protocol contract, and means there are no hardcoded protocol
// addresses in this repo to go stale — the only address that ever appears is the
// registry itself, which is fixed by design.

import {
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  type Address,
  type PublicClient,
} from "viem";

/// The FlareContractRegistry. Identical across Flare, Songbird, Coston and Coston2 —
/// deliberately so, which is why this is the one address worth hardcoding.
export const FLARE_CONTRACT_REGISTRY: Address = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

export type FlareNetworkKey = "coston2" | "songbird" | "flare";

export interface FlareNetwork {
  key: FlareNetworkKey;
  label: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  nativeSymbol: string;
  /// Whether real value moves here. Drives the UI's testnet/live treatment, and is the
  /// flag any code that spends funds should be checking.
  live: boolean;
}

export const FLARE_NETWORKS: Record<FlareNetworkKey, FlareNetwork> = {
  coston2: {
    key: "coston2",
    label: "Coston2",
    chainId: 114,
    rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    explorer: "https://coston2-explorer.flare.network",
    nativeSymbol: "C2FLR",
    live: false,
  },
  songbird: {
    key: "songbird",
    label: "Songbird",
    chainId: 19,
    rpcUrl: "https://songbird-api.flare.network/ext/C/rpc",
    explorer: "https://songbird-explorer.flare.network",
    nativeSymbol: "SGB",
    live: true,
  },
  flare: {
    key: "flare",
    label: "Flare",
    chainId: 14,
    rpcUrl: "https://flare-api.flare.network/ext/C/rpc",
    explorer: "https://flare-explorer.flare.network",
    nativeSymbol: "FLR",
    live: true,
  },
};

export function isFlareNetworkKey(v: unknown): v is FlareNetworkKey {
  return v === "coston2" || v === "songbird" || v === "flare";
}

/// The network the app talks to. Coston2 by default: this is a hackathon deployment and
/// defaulting to a live network would make an accidental mainnet spend one env var away.
export function activeNetwork(): FlareNetwork {
  const key = process.env.NEXT_PUBLIC_FLARE_NETWORK;
  return isFlareNetworkKey(key) ? FLARE_NETWORKS[key] : FLARE_NETWORKS.coston2;
}

export function toViemChain(net: FlareNetwork) {
  return defineChain({
    id: net.chainId,
    name: net.label,
    nativeCurrency: { name: net.nativeSymbol, symbol: net.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
    blockExplorers: { default: { name: `${net.label} Explorer`, url: net.explorer } },
    testnet: !net.live,
  });
}

// Built lazily rather than at module load so that importing this file never opens a
// connection or depends on env — the same discipline the original codebase used for its
// data clients, and what keeps these modules importable inside tests.
let cachedClient: PublicClient | null = null;
let cachedClientKey: FlareNetworkKey | null = null;

export function publicClient(net: FlareNetwork = activeNetwork()): PublicClient {
  if (!cachedClient || cachedClientKey !== net.key) {
    cachedClient = createPublicClient({
      chain: toViemChain(net),
      transport: http(process.env.FLARE_RPC_URL || net.rpcUrl),
    }) as PublicClient;
    cachedClientKey = net.key;
  }
  return cachedClient;
}

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getContractAddressByHash",
    stateMutability: "view",
    inputs: [{ name: "_nameHash", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/// Hash a protocol contract name the way the registry expects.
///
/// It is `keccak256(abi.encode(name))` — ABI encoding of a string, NOT
/// `encodePacked`/`keccak256(utf8)`. Getting this wrong does not throw: the registry
/// simply returns the zero address, and every later call fails somewhere far away from
/// the actual mistake. Hence one helper, tested.
export function registryNameHash(name: string): `0x${string}` {
  return keccak256(encodeAbiParameters([{ type: "string" }], [name]));
}

export class UnknownFlareContractError extends Error {
  constructor(name: string, network: string) {
    super(`Flare contract "${name}" is not registered on ${network}`);
    this.name = "UnknownFlareContractError";
  }
}

const addressCache = new Map<string, Address>();

/// Resolve a Flare protocol contract by registry name (e.g. "FtsoV2", "FdcVerification",
/// "AssetManagerFXRP").
///
/// Cached per network+name because these change roughly never within a process lifetime,
/// and every price read would otherwise pay an extra round trip.
export async function flareContract(name: string, net: FlareNetwork = activeNetwork()): Promise<Address> {
  const cacheKey = `${net.key}:${name}`;
  const hit = addressCache.get(cacheKey);
  if (hit) return hit;

  const address = (await publicClient(net).readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByHash",
    args: [registryNameHash(name)],
  })) as Address;

  // The registry answers "not registered" with the zero address rather than reverting.
  // Surfacing that as an error here keeps the failure next to its cause.
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    throw new UnknownFlareContractError(name, net.label);
  }

  addressCache.set(cacheKey, address);
  return address;
}

/// Explorer URL helpers, so links are built in one place rather than concatenated at
/// each call site with a different chance of a missing slash.
export function txUrl(hash: string, net: FlareNetwork = activeNetwork()): string {
  return `${net.explorer}/tx/${hash}`;
}

export function addressUrl(address: string, net: FlareNetwork = activeNetwork()): string {
  return `${net.explorer}/address/${address}`;
}

/// Reset memoised state. Exists for tests, which switch networks between cases and would
/// otherwise inherit the previous case's client and resolved addresses.
export function __resetFlareCaches(): void {
  cachedClient = null;
  cachedClientKey = null;
  addressCache.clear();
}
