// Sign-In With Ethereum (EIP-4361) message construction and parsing.
//
// Shared by the browser (which builds the message and asks the wallet to sign it) and
// the server (which rebuilds it from the request and checks the signature). One module
// on purpose: if the two sides formatted the message even slightly differently — a
// trailing newline, a reordered field — every signature would verify against a string
// the user never saw, and the failure would look like "wallet is broken" rather than
// "our formatter disagrees with itself".
//
// The format is fixed by EIP-4361. Field order and the exact literal prefixes are part
// of the spec, not a style choice, so they are written out verbatim below.

export interface SiweFields {
  domain: string;
  address: `0x${string}`;
  statement: string;
  uri: string;
  version: "1";
  chainId: number;
  nonce: string;
  issuedAt: string;
}

/// What the user is agreeing to, shown in the wallet prompt. Deliberately plain: a
/// signature request full of jargon trains people to sign without reading, which is the
/// habit every wallet-drainer relies on.
export const SIWE_STATEMENT = "Sign in to TAPE. This proves you control this wallet. It authorises no transaction and moves no funds.";

/**
 * Build the exact EIP-4361 string that gets signed.
 *
 * Every line here is spec-mandated. `\n` joins rather than a template literal with
 * embedded newlines, so an editor reformatting this file cannot silently change what
 * users sign.
 */
export function buildSiweMessage(f: SiweFields): string {
  return [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    f.address,
    "",
    f.statement,
    "",
    `URI: ${f.uri}`,
    `Version: ${f.version}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  ].join("\n");
}

/**
 * Pull the fields back out of a signed message.
 *
 * The server does NOT trust these values — it re-derives the message from them and the
 * nonce it issued, then checks the signature against that. Parsing exists so the server
 * can read the claimed address and nonce, not so it can believe them.
 *
 * Returns null on anything malformed rather than throwing: a bad message is an
 * unauthenticated request, not a server error.
 */
export function parseSiweMessage(message: string): SiweFields | null {
  const lines = message.split("\n");
  if (lines.length < 10) return null;

  const domainMatch = lines[0].match(/^(.+) wants you to sign in with your Ethereum account:$/);
  const address = lines[1];
  if (!domainMatch || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;

  const field = (prefix: string): string | null => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length) : null;
  };

  const uri = field("URI: ");
  const version = field("Version: ");
  const chainId = field("Chain ID: ");
  const nonce = field("Nonce: ");
  const issuedAt = field("Issued At: ");

  if (!uri || version !== "1" || !chainId || !nonce || !issuedAt) return null;

  const parsedChainId = Number(chainId);
  if (!Number.isInteger(parsedChainId)) return null;

  return {
    domain: domainMatch[1],
    address: address as `0x${string}`,
    statement: lines[3] ?? "",
    uri,
    version: "1",
    chainId: parsedChainId,
    nonce,
    issuedAt,
  };
}
