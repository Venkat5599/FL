import { PrivyClient } from "@privy-io/server-auth";
import { getDb } from "./db";

// Server-side Privy client (self-custody embedded wallets + delegated signing).
let client: PrivyClient | null = null;
export function privyClient(): PrivyClient {
  if (!client) {
    // The authorization private key lets our backend sign for delegated user
    // wallets. Prefer the Privy-dashboard-generated key (native `wallet-auth:`
    // format, used as-is); fall back to a self-generated PEM if that's how it
    // was provisioned.
    const authKey =
      process.env.PRIVY_AUTH_KEY_2 ||
      (process.env.PRIVY_AUTH_KEY || "").replace(/\\n/g, "\n") ||
      undefined;
    client = new PrivyClient(process.env.PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!, {
      walletApi: authKey ? { authorizationPrivateKey: authKey } : undefined,
    });
  }
  return client;
}

export interface AppUser {
  userId: number; // our DB id
  privyId: string;
  walletAddress: string | null;
}

export interface EmbeddedWallet {
  walletId: string | null; // Privy wallet id, needed by walletApi to sign
  address: string | null;
  delegated: boolean; // true when our session signer is delegated to this wallet
}

// Resolve the user's Privy embedded wallet: its id (for server-side signing),
// address, and whether our backend signer is delegated to it. Best-effort.
export async function resolveEmbeddedWallet(privyId: string): Promise<EmbeddedWallet> {
  try {
    const u = await privyClient().getUser(privyId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Privy account shape varies by SDK version
    const linked = ((u as any).linkedAccounts ?? []) as any[];
    const w = linked.find((a) => a.type === "wallet" && a.walletClientType === "privy");
    return {
      walletId: w?.id ?? w?.walletId ?? null,
      address: w?.address ?? null,
      delegated: w?.delegated === true,
    };
  } catch {
    return { walletId: null, address: null, delegated: false };
  }
}

// Verify the Privy access token from an Authorization: Bearer header, upsert the
// user, and return them. Returns null when unauthenticated. Every allocation /
// portfolio / execution route gates on this.
export async function verifyUser(req: Request): Promise<AppUser | null> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  let privyId: string;
  try {
    const claims = await privyClient().verifyAuthToken(token);
    privyId = claims.userId;
  } catch {
    return null;
  }

  // Resolve the user's embedded wallet address (best-effort).
  let wallet: string | null = null;
  try {
    const u = await privyClient().getUser(privyId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Privy user shape varies by SDK version
    const linked = (u as any).linkedAccounts ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose account shape
    const embedded = linked.find((a: any) => a.type === "wallet" && a.walletClientType === "privy");
    wallet = embedded?.address ?? (u as { wallet?: { address?: string } }).wallet?.address ?? null;
  } catch {
    /* wallet resolution is best-effort */
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    "INSERT OR IGNORE INTO users (privy_user_id, wallet_address, created_at) VALUES (?,?,?)"
  ).run(privyId, wallet, now);
  if (wallet) {
    db.prepare("UPDATE users SET wallet_address=? WHERE privy_user_id=?").run(wallet, privyId);
  }
  const row = db
    .prepare("SELECT id, wallet_address FROM users WHERE privy_user_id=?")
    .get(privyId) as { id: number; wallet_address: string | null };
  return { userId: row.id, privyId, walletAddress: row.wallet_address };
}
