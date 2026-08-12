import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

// Independent, cost-free cryptographic verification of a 0G inference response.
// It reads the serving provider's on-chain-attested TEE signer address, fetches
// the provider-signed response, and checks the EIP-191 signature recovers to
// that signer — proving the response genuinely came from the attested TEE, not
// a tampered/spoofed node. Uses a throwaway UNFUNDED wallet (verification is
// read-only: an on-chain read + one HTTPS GET; no gas, no ledger, no deposit).
//
// Works on TeeML providers (0G mainnet models like DeepSeek-V3.1). TeeTLS
// providers (the free testnet `qwen2.5-omni`) expose no per-response signature,
// so this returns status "unavailable" — it never fabricates a green check.

// 0G chain RPC for the verification read. Derives testnet vs mainnet from the
// configured router unless ZG_RPC is set explicitly.
function rpcUrl(): string {
  if (process.env.ZG_RPC) return process.env.ZG_RPC;
  return (process.env.ZG_BASE_URL || "").includes("testnet")
    ? "https://evmrpc-testnet.0g.ai"
    : "https://evmrpc.0g.ai";
}

export type VerifyStatus = "verified" | "unavailable" | "failed";
export type VerifyResult = {
  verified: boolean;
  status: VerifyStatus;
  signer: string | null;
  detail: string;
};

export async function verifyInference(provider: string, chatID: string): Promise<VerifyResult> {
  try {
    const rpc = new ethers.JsonRpcProvider(rpcUrl());
    // Unfunded throwaway wallet — verification is a read-only chain call + HTTPS GET.
    const wallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, rpc);
    const broker = await createZGComputeNetworkBroker(wallet);
    // processResponse: reads the provider's on-chain Service record (verifiability,
    // teeSignerAddress), fetches the signed response, verifies the EIP-191 sig.
    const valid = await broker.inference.processResponse(provider, chatID);
    if (valid === true) {
      return {
        verified: true,
        status: "verified",
        signer: provider,
        detail: "TEE signature valid (EIP-191) against the provider's on-chain signer",
      };
    }
    if (valid === null) {
      return { verified: false, status: "unavailable", signer: null, detail: NO_SIGNATURE_REASON };
    }
    return { verified: false, status: "failed", signer: null, detail: "The TEE signature did not recover to the provider's on-chain signer." };
  } catch (e) {
    // The provider exposes no per-response signature endpoint for this chatID
    // (TeeTLS / router-served responses). Explain the reason rather than
    // leaking the raw SDK error.
    const msg = (e as Error).message ?? "";
    const noSignature = /signature|not found|no .*proof|attest/i.test(msg);
    return {
      verified: false,
      status: "unavailable",
      signer: null,
      detail: noSignature ? NO_SIGNATURE_REASON : `Verification could not run: ${msg.slice(0, 140) || "unknown error"}.`,
    };
  }
}

// Human-readable reason shown when there is nothing to cryptographically verify.
// Network-agnostic: the point is the provider/route did not return a
// per-response TEE signature, not which chain it ran on.
const NO_SIGNATURE_REASON =
  "This response was served with transport-layer (TeeTLS) attestation and did not return a per-response TEE signature to recover, so there is nothing to cryptographically verify here. Per-response verification needs a TeeML provider that signs each response, reached through the 0G Compute broker (the OpenAI-compatible router does not expose the signature).";

// Pure EIP-191 (`personal_sign`) signer recovery — the cryptographic core of the
// verification above, isolated so it can be unit-tested with no network. Returns
// the address that produced `signature` over `message`.
export function recoverEip191Signer(message: string, signature: string): string {
  return ethers.verifyMessage(message, signature);
}
