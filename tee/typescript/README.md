# TEE Extension Example - Private Key Manager (TypeScript)

An example TEE extension that stores a private key and signs messages with it.

## For Hackathon Participants

This is a **working example** to use as a starting point. You should modify the
files in `src/app/` and `contract/InstructionSender.sol` to build your
own extension. The files in `src/base/` are framework infrastructure —
you should not need to modify them.

### What to change

| File | Purpose |
|------|---------|
| `src/app/handlers.ts` | Your business logic — register handlers, process messages |
| `src/app/config.ts` | Version constant |
| `src/app/abi.ts` | ABI encoding for your specific data types (uses `viem`) |
| `src/app/crypto.ts` | Cryptographic operations (only if your extension needs them) |
| `contract/InstructionSender.sol` | On-chain contract that sends instructions to your extension |

### What's provided by `base/`

| Module | Exports |
|--------|---------|
| `base/encoding` | `hexToBytes(hex)`, `bytesToHex(bytes)` |
| `base/crypto` | `keccak256(data)` |
| `base/types` | `Framework` (handler registration), protocol types |
| `base/server` | HTTP server (you never call this directly) |

### Handler signature

```typescript
async function myHandler(msg: string): Promise<[string | null, number, string | null]> {
  // msg is the hex-encoded originalMessage from the on-chain instruction
  // Return: [data, status, error]
  //   status: 0 = error, 1 = success, >=2 = pending
  return [dataHex, 1, null];
}
```

## Testing

```bash
npm ci
npm test
```

## Deployment & Registration Tools

All deployment, registration, and testing tools are in `go/tools/` and work
for all extension languages. Set `LANGUAGE=typescript` in `.env` and follow the
instructions in the [root README](../README.md) and
[`go/README.md`](../go/README.md#tools-gotools).
