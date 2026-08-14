/**
 * TAPE confidential scoring extension — configuration constants.
 *
 * These strings MUST match the bytes32 constants in TapeInstructionSender.sol exactly.
 * The registry compares hashed string constants, so a mismatch does not produce a
 * helpful error: the enclave simply reports "unsupported op type/command" and the
 * instruction dies with no indication of which side is wrong. They are therefore kept
 * short, ASCII, and duplicated in exactly two places (here and the contract) with a
 * test on the contract side pinning the pair.
 *
 * The `F_` prefix is reserved for Flare system operations and is deliberately avoided.
 */

export const VERSION = "0.1.0";

/** Single op type for everything this extension does. */
export const OP_TYPE_SCORE = "SCORE";

/**
 * Deliver the sealed ranking weights.
 *
 * This is the command that makes the whole confidential-compute claim honest. The
 * extension image is open source and reproducibly built — its code hash is attested and
 * registered on-chain — which means anything baked into the image is public by
 * construction. Weights compiled into open source are not secret.
 *
 * So the weights are never in the image. They arrive here encrypted to the TEE's public
 * key, are decrypted inside the enclave via the node's /decrypt endpoint, and live only
 * in enclave memory. Anyone can verify the code that consumes them; nobody outside can
 * read them. That is the same pattern the official fce-sign example uses for its private
 * key, for the same reason.
 */
export const OP_COMMAND_WEIGHTS = "WEIGHTS";

/**
 * Classify an attested post into a structured trade signal.
 *
 * Deliberately NOT secret. Classification is parsing, not judgement — there is nothing
 * to game by knowing how a ticker is extracted, and an open rule set is easier to trust
 * and to audit. It runs inside the enclave for integrity (the verdict is signed and the
 * machine identity is registered on-chain), not for confidentiality.
 */
export const OP_COMMAND_CLASSIFY = "CLASSIFY";

/**
 * Rank a caller from their settled calls, under the sealed weights.
 *
 * This is the part worth protecting. A published ranking function gets optimised against
 * — callers would shape posts to score well rather than to be right, and the leaderboard
 * would stop measuring anything within weeks. Inputs are public and attested, the output
 * is public and signed, the function is secret.
 */
export const OP_COMMAND_RANK = "RANK";

/**
 * Status codes returned in ActionResult.
 * 0 = error (message goes in `log`), 1 = success, >=2 = pending async work.
 */
export const STATUS_ERROR = 0;
export const STATUS_OK = 1;
