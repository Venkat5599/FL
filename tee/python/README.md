# TEE Extension Example - Private Key Manager (Python)

An example TEE extension that stores a private key and signs messages with it.

## For Hackathon Participants

This is a **working example** to use as a starting point. You should modify the
files in `app/` and `contract/InstructionSender.sol` to build your own
extension. The files in `base/` are framework infrastructure -- you
should not need to modify them.

### What to change

| File | Purpose |
|------|---------|
| `app/handlers.py` | Your business logic -- register handlers, process messages |
| `app/config.py` | Version constant |
| `app/abi.py` | ABI encoding for your specific data types (uses `eth_abi`) |
| `app/crypto.py` | Cryptographic operations (only if your extension needs them) |
| `contract/InstructionSender.sol` | On-chain contract that sends instructions to your extension |

### What's provided by `base/`

| Module | Functions |
|--------|-----------|
| `base.encoding` | `hex_to_bytes(hex)`, `bytes_to_hex(bytes)` |
| `base.crypto` | `keccak256(data)` |
| `base.types` | `Framework` (handler registration), protocol types |
| `base.server` | HTTP server (you never call this directly) |

### Handler signature

```python
def my_handler(msg: str) -> tuple[str | None, int, str | None]:
    # msg is the hex-encoded originalMessage from the on-chain instruction
    # Return: (data, status, error)
    #   status: 0 = error, 1 = success, >=2 = pending
    return data_hex, 1, None
```

## Testing

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

## Deployment & Registration Tools

All deployment, registration, and testing tools are in `go/tools/` and work
for all extension languages. Set `LANGUAGE=python` in `.env` and follow the
instructions in the [root README](../README.md) and
[`go/README.md`](../go/README.md#tools-gotools).
