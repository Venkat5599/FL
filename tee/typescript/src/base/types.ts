/** Infrastructure types for the TEE extension framework. */

/** Nested 'data' field inside an Action. */
export interface ActionData {
  id: string;
  type: string;
  submissionTag: string;
  message: string; // JSON-encoded DataFixed
}

/** Top-level request received on POST /action. */
export interface Action {
  data: ActionData;
  additionalVariableMessages?: string[];
  timestamps?: number[];
  additionalActionData?: string;
  signatures?: string[];
}

/** Decoded content of ActionData.message. */
export interface DataFixed {
  instructionId: string;
  teeId?: string;
  timestamp?: number;
  rewardEpochId?: number;
  opType: string;
  opCommand: string;
  cosigners?: string[];
  cosignersThreshold?: number;
  originalMessage?: string;
  additionalFixedMessage?: string;
}

/** Response returned from POST /action. */
export interface ActionResult {
  id: string;
  submissionTag: string;
  status: number;
  log?: string;
  opType: string;
  opCommand: string;
  additionalResultStatus?: string;
  version: string;
  data?: string;
}

/** Response from GET /state. */
export interface StateResponse {
  stateVersion: string;
  state: unknown;
}

/**
 * Handler function signature.
 * Returns [data, status, error].
 */
export type HandlerFunc = (
  msg: string
) => Promise<[string | null, number, string | null]>;

/** Report state function signature. */
export type ReportStateFunc = () => unknown;

/** Register function signature. */
export type RegisterFunc = (framework: Framework) => void;

/** Encode a UTF-8 string to a 0x-prefixed 32-byte zero-right-padded hex string. */
export function stringToBytes32Hex(s: string): string {
  const buf = Buffer.alloc(32);
  buf.write(s, "utf-8");
  return "0x" + buf.toString("hex");
}

/** Convert a 32-byte hex string back to a trimmed UTF-8 string. */
export function bytes32HexToString(h: string): string {
  h = h.startsWith("0x") ? h.slice(2) : h;
  const buf = Buffer.from(h, "hex");
  // Trim trailing zero bytes.
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end--;
  return buf.subarray(0, end).toString("utf-8");
}

/** Convert a version string to bytes32 hex. */
export function versionToHex(version: string): string {
  return stringToBytes32Hex(version);
}

interface HandlerEntry {
  opType: string;
  opCommand: string;
  handler: HandlerFunc;
}

/** Provides handler registration to app code. */
export class Framework {
  private handlers: HandlerEntry[] = [];

  /**
   * Register a handler for an OPType/OPCommand pair.
   * Pass "" for opCommand to match any command.
   */
  handle(opType: string, opCommand: string, handler: HandlerFunc): void {
    this.handlers.push({
      opType: stringToBytes32Hex(opType),
      opCommand: stringToBytes32Hex(opCommand),
      handler,
    });
  }

  /** Find a handler matching the given opType and opCommand. */
  lookup(opType: string, opCommand: string): HandlerFunc | null {
    const emptyCmd = stringToBytes32Hex("");
    for (const entry of this.handlers) {
      if (entry.opType !== opType) continue;
      if (entry.opCommand === emptyCmd || entry.opCommand === opCommand) {
        return entry.handler;
      }
    }
    return null;
  }
}
