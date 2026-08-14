# Base (Infrastructure) Specification

This document specifies what the base/infrastructure layer of a TEE extension must implement. App code (handlers, state, types) depends on this layer but never modifies it.

## Registration API

The base exposes three functions to app code at startup:

| Function | Description |
|----------|-------------|
| `setState(state)` | Stores the mutable state object. Handlers receive this object on every invocation. |
| `handle(opType, opCommand, handler)` | Registers a handler for an OPType/OPCommand pair. Pass empty string for `opCommand` to match any command. |
| `new(extPort, signPort, version, registerCallback, reportStateCallback)` | Creates and configures the extension server. Calls `registerCallback` (which should call `setState` and `handle`), stores `reportStateCallback` for GET /state. The caller is responsible for starting the server. |

## HTTP server

The base starts an HTTP server on `localhost:$EXTENSION_PORT` with two endpoints:

- `POST /action` — receives actions from the TEE node
- `GET /state` — returns the extension's current state

## POST /action — processing flow

1. JSON-decode the request body into an `Action` (see `json-schemas/action.json`).
2. Hex-decode `action.data.message` (a 0x-prefixed hex string) to obtain JSON bytes, then JSON-decode those bytes into `DataFixed` (see `json-schemas/datafixed.json`).
3. Match `(DataFixed.opType, DataFixed.opCommand)` against registered handlers:
   - Compare opType exactly.
   - If the handler registered with an empty opCommand, it matches any command. Otherwise compare opCommand exactly.
   - First match wins.
4. If no handler matches: return HTTP 501 with body `"unsupported op type"`.
5. If a handler matches: acquire exclusive lock, call handler, release lock, assemble ActionResult, return HTTP 200 with JSON body.

## Handler invocation

The base serializes all handler calls with an exclusive lock. This means:

- Only one handler runs at a time.
- Handlers can safely read and write the shared state without additional synchronization.
- The handler receives `(state, dataFixed.originalMessage)` and returns `(data, status, err)`.

## ActionResult assembly

After the handler returns, the base builds an `ActionResult` (see `json-schemas/actionresult.json`):

| Field | Source |
|-------|--------|
| `id` | Copied from `action.data.id` |
| `submissionTag` | Copied from `action.data.submissionTag` |
| `opType` | Copied from `dataFixed.opType` |
| `opCommand` | Copied from `dataFixed.opCommand` |
| `version` | The extension's version string |
| `data` | Handler's `data` return value |
| `status` | Handler's `status` return value |
| `log` | Derived from `status` (see below) |

**Log field logic:**

| Status | Log value |
|--------|-----------|
| `0` (error) | `"error: {err}"` where `{err}` is the handler's error |
| `1` (success) | `"ok"` |
| `>= 2` (pending) | `"pending"` |

## GET /state

1. Acquire read lock.
2. Call `reportStateCallback(state)` to get a JSON-serializable snapshot.
3. Release read lock.
4. Return JSON:

```json
{
  "stateVersion": "<bytes32 hex of the extension version string>",
  "state": <reportState result>
}
```

See `json-schemas/stateversion.json` for the schema.

## Shared utilities

The base provides utility functions that app code can import:

| Function | Description |
|----------|-------------|
| `HexToBytes(hex) -> bytes` | Decode a hex string (optional `0x` prefix) to raw bytes. Returns empty/nil for empty input. |
| `BytesToHex(bytes) -> string` | Encode raw bytes to a `0x`-prefixed lowercase hex string. |
| `Keccak256(data) -> bytes` | Compute the Keccak-256 hash (32 bytes). Used internally for bytes32 encoding of OPTypes. |

Naming conventions follow the target language (e.g. `hex_to_bytes` in Python, `hexToBytes` in TypeScript, `HexToBytes` in Go).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `EXTENSION_PORT` | `8080` | Port the extension server listens on |
| `SIGN_PORT` | `9090` | Port where the TEE node exposes sign, decrypt, and result endpoints |

Both are overridden by environment variables.

The base also defines a graceful shutdown timeout (default 5 seconds).
