import { describe, expect, it } from "vitest";
import {
  activeNetwork,
  addressUrl,
  FLARE_CONTRACT_REGISTRY,
  FLARE_NETWORKS,
  isFlareNetworkKey,
  registryNameHash,
  toViemChain,
  txUrl,
} from "../lib/flare";

// Golden values produced independently with Foundry:
//   cast keccak $(cast abi-encode "f(string)" "FtsoV2")
// These are the exact hashes the on-chain ContractRegistry library computes with
// keccak256(abi.encode(name)). If the TS encoder disagrees, the registry returns the
// zero address rather than reverting, and the failure surfaces far from its cause —
// so the encoding is pinned here rather than trusted.
const CANONICAL_NAME_HASHES: Record<string, string> = {
  FtsoV2: "0x6f1a0739c49352e32f4abc7f41b653bc4ef24145c2df1f10402c69e7c09786e1",
  FdcVerification: "0xe79bd76c80aea3a2d7a282ff9101a01d1a9d89398ba8cda3a35d1145eeb5de81",
  AssetManagerFXRP: "0x4273d3ffb3b20b687b1e8127381f0f37a475f36df14af1c54ab0e5174f75122f",
};

describe("registryNameHash", () => {
  for (const [name, expected] of Object.entries(CANONICAL_NAME_HASHES)) {
    it(`matches the on-chain hash for ${name}`, () => {
      expect(registryNameHash(name)).toBe(expected);
    });
  }

  // The registry uses abi.encode, not encodePacked. Those differ for strings, and
  // confusing them is the single easiest way to break every protocol lookup at once.
  it("is not the packed/plain keccak of the name", () => {
    expect(registryNameHash("FtsoV2")).not.toBe(
      "0x" + Buffer.from("FtsoV2").toString("hex").padEnd(64, "0"),
    );
  });
});

describe("network config", () => {
  // Chain ids are consensus-critical: a wrong one means every signed transaction is
  // either rejected or, worse, valid on a chain the user did not intend.
  it("pins the documented chain ids", () => {
    expect(FLARE_NETWORKS.flare.chainId).toBe(14);
    expect(FLARE_NETWORKS.songbird.chainId).toBe(19);
    expect(FLARE_NETWORKS.coston2.chainId).toBe(114);
  });

  it("marks only Coston2 as non-live", () => {
    expect(FLARE_NETWORKS.coston2.live).toBe(false);
    expect(FLARE_NETWORKS.songbird.live).toBe(true);
    expect(FLARE_NETWORKS.flare.live).toBe(true);
  });

  // Defaulting to a live network would put an accidental mainnet spend one env var away.
  it("defaults to Coston2 when unset or invalid", () => {
    const previous = process.env.NEXT_PUBLIC_FLARE_NETWORK;
    try {
      delete process.env.NEXT_PUBLIC_FLARE_NETWORK;
      expect(activeNetwork().key).toBe("coston2");

      process.env.NEXT_PUBLIC_FLARE_NETWORK = "not-a-network";
      expect(activeNetwork().key).toBe("coston2");

      process.env.NEXT_PUBLIC_FLARE_NETWORK = "flare";
      expect(activeNetwork().key).toBe("flare");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_FLARE_NETWORK;
      else process.env.NEXT_PUBLIC_FLARE_NETWORK = previous;
    }
  });

  it("recognises exactly the three Flare networks", () => {
    expect(isFlareNetworkKey("coston2")).toBe(true);
    expect(isFlareNetworkKey("flare")).toBe(true);
    expect(isFlareNetworkKey("songbird")).toBe(true);
    expect(isFlareNetworkKey("coston")).toBe(false);
    expect(isFlareNetworkKey(undefined)).toBe(false);
  });

  it("uses one registry address across every network", () => {
    expect(FLARE_CONTRACT_REGISTRY).toBe("0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019");
  });

  it("builds a viem chain that marks testnets correctly", () => {
    expect(toViemChain(FLARE_NETWORKS.coston2).testnet).toBe(true);
    expect(toViemChain(FLARE_NETWORKS.flare).testnet).toBe(false);
    expect(toViemChain(FLARE_NETWORKS.coston2).id).toBe(114);
  });
});

describe("explorer links", () => {
  it("builds tx and address urls without doubled slashes", () => {
    const net = FLARE_NETWORKS.coston2;
    expect(txUrl("0xabc", net)).toBe("https://coston2-explorer.flare.network/tx/0xabc");
    expect(addressUrl("0xdef", net)).toBe("https://coston2-explorer.flare.network/address/0xdef");
    expect(txUrl("0xabc", net)).not.toContain("//tx");
  });
});
