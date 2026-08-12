import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { recoverEip191Signer } from "../lib/verify";

describe("recoverEip191Signer (TEE signature crypto core)", () => {
  it("recovers the exact signer address from an EIP-191 personal_sign signature", async () => {
    const wallet = ethers.Wallet.createRandom();
    const message = "0G TEE response text";
    const signature = await wallet.signMessage(message);
    const recovered = recoverEip191Signer(message, signature);
    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("recovers a DIFFERENT address when the message is tampered (detects tampering)", async () => {
    const wallet = ethers.Wallet.createRandom();
    const signature = await wallet.signMessage("original text");
    const recovered = recoverEip191Signer("tampered text", signature);
    expect(recovered.toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });
});
