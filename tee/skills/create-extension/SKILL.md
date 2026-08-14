---
name: create-extension
description: Build a Flare TEE extension -- covers architecture, protocol spec, handler contract, InstructionSender contract, and implementation steps. Language-independent.
---

## Overview

A TEE (Trusted Execution Environment) is a pairing of a **TEE node** app and a **TEE extension** app, both running inside the same Docker container. They communicate over localhost. The extension also needs an **InstructionSender** Solidity contract.

The developer implements 5 concerns:

| # | Concern | What you do |
|---|---------|-------------|
| 1 | **Configuration** | Define OPType string constants and a version string |
| 2 | **Types** | Define request, response, and state report types |
| 3 | **Handlers** | Define mutable state, write handler functions, register them |
| 4 | **Contract** | Add matching `bytes32` constants and send functions to the InstructionSender Solidity contract |
| 5 | **Tests** | Write test payloads and response assertions |

Everything else is infrastructure (HTTP server, routing, DataFixed parsing, state locking, ActionResult assembly). Infrastructure and custom logic must be clearly separated -- e.g. in separate directories or modules -- so the developer only touches their own code.

## Architecture

```
+---------------------------------------------------------+
|  CUSTOM CODE (developer-editable)                       |
|  Configuration       OPType constants, version          |
|  Types               request/response, state report     |
|  Handlers            mutable state, handler funcs       |
|  Contract            InstructionSender.sol              |
|  Tests               payloads and assertions            |
+---------------------------------------------------------+
+---------------------------------------------------------+
|  INFRASTRUCTURE (do not modify)                         |
|  HTTP server         POST /action, GET /state           |
|  Routing             OPType/OPCommand dispatch          |
|  DataFixed parsing   hex-decode + JSON-decode envelope  |
|  State locking       serialize handler calls            |
|  ActionResult        assemble response                  |
|  Shared utilities    hex encoding, keccak256            |
+---------------------------------------------------------+
```

Organize these into separate directories or modules following the conventions of your programming language. For example, the Go scaffold uses `internal/app/` for developer code and `internal/base/` for infrastructure.

See [references/base-spec.md](references/base-spec.md) for the full specification of what the infrastructure layer must implement.

### Shared utilities in `base/`

The infrastructure layer provides these utility functions that handlers can import:

| Function | Description |
|----------|-------------|
| `HexToBytes(hex)` / `hexToBytes(hex)` / `hex_to_bytes(hex)` | Decode a hex string (optional 0x prefix) to bytes |
| `BytesToHex(bytes)` / `bytesToHex(bytes)` / `bytes_to_hex(bytes)` | Encode bytes to a 0x-prefixed hex string |
| `Keccak256(data)` / `keccak256(data)` | Compute the Keccak-256 hash of data |

For ABI encoding/decoding, use a language-specific library directly in your handler code (e.g. `eth_abi` for Python, `viem` for TypeScript, `go-ethereum/accounts/abi` for Go).

## Instruction lifecycle

```
1. User calls your Solidity contract (on-chain)
2. Contract emits TeeInstructionsSent via TeeExtensionRegistry
3. TEE proxy picks up the instruction from the chain
4. TEE node fetches the instruction from the proxy
5. TEE node forwards it as POST /action to your extension
6. Your extension processes the action and returns a result
7. TEE node sends the result back to the proxy
8. Caller polls the proxy for the result
```

Your extension controls step 1 (the contract) and step 6 (the handler).

## Terminology

**TEE's public/private key** means the TEE node's key.

**Signing / Encryption**: Default to ECDSA (secp256k1) for signing and ECIES for encryption. Use the TEE node's sign server by default (see [references/openapi.yaml](references/openapi.yaml)).

**Message / Action message / Instruction message** usually means `DataFixed.originalMessage` -- guaranteed to match the `message` field of the instruction event emitted by InstructionSender.

**Decoding and Encoding**:
- The `action.data.message` field is a **hex-encoded string** containing the JSON bytes of a `DataFixed` object. The framework must hex-decode the string to obtain raw bytes, then JSON-parse those bytes into `DataFixed`.
- JSON for communication between TEE node and TEE extension (the HTTP wire format).
- Binary fields in JSON are hex strings (0x prefix optional), EXCEPT for `/decrypt` request/response where `encryptedMessage` and `decryptedMessage` are **base64-encoded byte arrays**.
- Encoding strings as 32-byte hex fields (OPType, OPCommand, version, stateVersion all use this): UTF-8 encode the string, right-pad with zero bytes to 32 bytes, then hex-encode. This matches Solidity's `bytes32("FOO")` casting behaviour. Strings must be <= 32 bytes; longer strings are silently truncated to 32 bytes.
  - Example: `"SAY_HELLO"` -> `0x5341595f48454c4c4f0000000000000000000000000000000000000000000000`
  - Solidity: `bytes32("SAY_HELLO")`

**Returning values** means putting them in `ActionResult.Data`.

Each JSON type satisfies its schema in [references/json-schemas/](references/json-schemas/).

## TEE extension app

The extension is an HTTP server that:
1. Receives **Actions** from the TEE node at `POST /action`
2. Routes them based on `(OPType, OPCommand)`
3. Returns **ActionResults** (synchronously or asynchronously)
4. Exposes state at `GET /state`

**Rules**:
- Treat messages as potentially malicious.
- Serve at `localhost:$EXTENSION_PORT`.
- The TEE extension SemVer version is hardcoded; increment it when behavior or contract changes.
- The framework serializes handler calls -- handlers can safely read and write shared state.
- Action handling is idempotent where possible; otherwise implement replay protection.
- Do not use the filesystem.

### POST /action -- processing flow

1. Receive encoded `Action` (see [references/json-schemas/action.json](references/json-schemas/action.json)).
2. Hex-decode `Action.data.message` to obtain JSON bytes, then JSON-parse into `DataFixed` (see [references/json-schemas/datafixed.json](references/json-schemas/datafixed.json)).
3. Route based on `(DataFixed.opType, DataFixed.opCommand)` -- matched against registered handlers.
4. Call matched handler with `(state, dataFixed.originalMessage)`.
5. Assemble `ActionResult` from handler's return values (see [references/json-schemas/actionresult.json](references/json-schemas/actionresult.json)).

```
action = jsonDecode(request.body)
messageBytes = hexDecode(action.data.message)
dataFixed = jsonDecode(messageBytes)
handler = lookupHandler(dataFixed.opType, dataFixed.opCommand)
data, status, err = handler(state, dataFixed.originalMessage)
return buildActionResult(action, dataFixed, data, status, err)
```

### Handlers

Every handler has the same signature:

```
handler(state, msg) -> (data, status, err)
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `state` | mutable state object | Pointer/reference to your State. The framework serializes all handler calls (e.g. via mutex), so handlers can read and write state without additional synchronization. |
| `msg` | string (hex) | `DataFixed.OriginalMessage` -- the raw `_message` bytes from the Solidity contract, delivered as a 0x-prefixed hex string. Hex-decode to get the original bytes. |

**Return values:**

| Name | Type | Description |
|------|------|-------------|
| `data` | string (hex) or null | Hex-encoded bytes placed into `ActionResult.Data`. Encoding is the handler's business. |
| `status` | uint8 | `0` = error, `1` = success, `>=2` = pending |
| `err` | error/string | When status is `0`, the error message goes into `ActionResult.Log` |

### ActionResult status codes

If `DataFixed` decoded successfully, always return an `ActionResult`:
- **0** -- error (embed error message in `ActionResult.Log`)
- **1** -- success
- **>=2** -- pending (lower value = closer to completion)

### Asynchronous processing

If processing will take significant time:
1. Immediately respond with `status >= 2` (pending).
2. Continue processing in background.
3. When done, POST the final `ActionResult` to `http://localhost:{SIGN_PORT}/result`.
4. Only send intermediate updates with a strictly lower status; don't update too often.

See [references/openapi.yaml](references/openapi.yaml) for the `/result` endpoint spec.

### GET /state

Responds with a JSON object containing `stateVersion` (bytes32 hex of the extension version) and `state` (your state report -- any JSON-serializable value). See [references/json-schemas/stateversion.json](references/json-schemas/stateversion.json).

Implement a state reporting function that converts your mutable state into a JSON-serializable snapshot. Do not include sensitive data.

### Configuration

- `EXTENSION_PORT` -- port the extension listens on
- `SIGN_PORT` -- port where the TEE node exposes sign, decrypt, and result endpoints

## TEE node sign server

The TEE node exposes signing, encryption, and decryption to your extension at `localhost:$SIGN_PORT`. See [references/openapi.yaml](references/openapi.yaml) for all endpoints. Key endpoints:

- `POST /sign` -- sign with the TEE node's private key (request/response use **base64** byte encoding, not hex)
- `POST /sign/{walletID}/{keyID}` -- sign with a specific wallet key (request/response use **base64** byte encoding, not hex)
- `POST /decrypt` -- decrypt with the TEE node's private key (request/response use **base64** byte encoding, not hex)
- `GET /key-info/{walletID}/{keyID}` -- check key existence
- `POST /result` -- post async ActionResult back to the node

## Dockerfile

The Dockerfile must run both TEE node and TEE extension as separate binaries in the same container. The TEE node is built from source: `https://github.com/flare-foundation/tee-node.git`.

Required env vars:
- `CONFIG_PORT` -- TEE node config port
- `SIGN_PORT` -- TEE node sign/result port
- `EXTENSION_PORT` -- extension server port
- `MODE=1` -- test mode (fake attestation, required for Coston2)

The container CMD should run both binaries:

```dockerfile
CMD ["sh", "-c", "./server & gosu extension ./<your-extension-binary>"]
```

See the Go, Python, or TypeScript Dockerfiles for complete examples.

## InstructionSender contract

The InstructionSender is the **only on-chain address allowed to submit instructions** to your extension's TEE machines. Users call functions on it; it calls `sendInstructions` on `TeeExtensionRegistry`.

See [references/ITeeExtensionRegistry.sol](references/ITeeExtensionRegistry.sol) and [references/ITeeMachineRegistry.sol](references/ITeeMachineRegistry.sol) for the interfaces.

### Choosing TEE machines

The `_teeIds` parameter of `sendInstructions` is a list of TEE machine addresses. All must belong to the same extension.

**Default -- random selection:** Call `teeMachineRegistry.getRandomTeeIds(extensionId, count)` to get `count` random active machines. This requires the contract to know its `extensionId`. The scaffold provides a `setExtensionId()` function for this -- it scans the registry to find the extension ID associated with this contract's address. It is idempotent and must be called once after the extension is registered.

**Alternative -- manual selection:** Call `teeMachineRegistry.getActiveTeeMachines(extensionId)` to get all active machines and select from them.

### Fee

The registry charges a minimum fee of 1000 wei per instruction. Send functions must be `payable` and forward `msg.value` to `sendInstructions`.

### TeeInstructionParams

`sendInstructions` takes a `TeeInstructionParams` struct. Only `opType`, `opCommand`, and `message` are required; other fields default to zero values:

```solidity
ITeeExtensionRegistry.TeeInstructionParams memory params;
params.opType = OP_TYPE;
params.opCommand = OP_COMMAND;
params.message = _message;
```

### Message encoding

Pass `_message` bytes **directly** to `params.message`. Do NOT wrap with `abi.encode()` unless your handler specifically expects ABI-encoded data. Double-wrapping is a common mistake.

### Example

Define `bytes32` constants and a send function per operation:

```solidity
bytes32 constant OP_TYPE = bytes32("MY_OPERATION");
bytes32 constant OP_COMMAND = bytes32("PLACEHOLDER");

function send(bytes calldata _message) external payable {
    address[] memory teeIds = teeMachineRegistry.getRandomTeeIds(_getExtensionId(), 1);
    ITeeExtensionRegistry.TeeInstructionParams memory params;
    params.opType = OP_TYPE;
    params.opCommand = OP_COMMAND;
    params.message = _message;
    teeExtensionRegistry.sendInstructions{value: msg.value}(teeIds, params);
}
```

# Implementing new extension functionality

## Step 1: Define OPType constants and version

Define string constants for each operation type and command your extension supports, plus a SemVer version string:

```
VERSION = "0.1.0"

OP_TYPE_MY_OP       = "MY_OP"
OP_TYPE_MY_OTHER_OP = "MY_OTHER_OP"

OP_COMMAND_MY_COMMAND = "MY_COMMAND"
```

OPType identifies the operation. OPCommand is an optional sub-route within an OPType -- pass `""` when registering a handler to match any command.

Use UPPER_SNAKE_CASE. These strings must **exactly match** the `bytes32` constants in the Solidity contract.

## Step 2: Define types

Define your request, response, and state report types. These are the JSON shapes your handlers consume and produce.

- **Request type** -- the payload your handler receives in `msg` (after hex-decoding and any further decoding). Define one per operation.
- **Response type** -- what the handler encodes and returns as `data`. Define one per operation.
- **State report** -- a snapshot of observable state returned by GET /state. One shared type for the extension.

Define these as structs/classes/types in your language, with JSON serialization.

## Step 3: Define state, handlers, and registration

This is the core of your extension. There are four parts:

### 3a. Mutable state

Define a state object with whatever fields your handlers need to read and write across calls. The framework serializes all handler invocations, so no additional synchronization is needed.

```
State:
    // your fields here
```

### 3b. Registration

At startup, register your initial state and handler functions with the framework:

```
register(framework):
    framework.setState(State{})
    framework.handle("MY_OP", "", handleMyOp)
    framework.handle("MY_OTHER_OP", "MY_COMMAND", handleMyOtherOp)
```

Each `handle(opType, opCommand, handler)` call registers a handler for an OPType/OPCommand combination. Pass `""` (empty string) for opCommand to match any command.

### 3c. State reporting

Implement a function that converts your mutable state into a JSON-serializable snapshot for GET /state:

```
reportState(state) -> stateReport:
    return {
        // your state report fields here
    }
```

### 3d. Handler functions

Write one handler per OPType/OPCommand combination. Each handler follows this pattern:

```
handleMyOp(state, msg) -> (data, status, err):
    // 1. Hex-decode msg to get raw bytes
    rawBytes = hexDecode(msg)

    // 2. Decode payload (e.g. ABI-decode, JSON-decode, or use raw bytes)
    request = decode(rawBytes)

    // 3. Validate
    if not valid(request):
        return (null, 0, "validation error")

    // 4. Execute business logic
    result = doWork(state, request)

    // 5. Encode and return response
    return (hexEncode(result), 1, null)
```

**Return values:**
- `(null, 0, errorMessage)` -- error: message goes to `ActionResult.Log`
- `(data, 1, null)` -- success: data goes to `ActionResult.Data`
- `(data, N, null)` where N >= 2 -- pending (for async processing)

**State access:** The framework serializes handler calls, so you can safely read and write state fields without additional synchronization.

## Step 4: Update the InstructionSender Solidity contract

Add a `bytes32` constant and send function per operation:

```solidity
bytes32 constant OP_TYPE_MY_OP      = bytes32("MY_OP");
bytes32 constant OP_COMMAND_MY_CMD  = bytes32("MY_COMMAND");

function sendMyOp(bytes calldata _message) external payable {
    address[] memory teeIds = teeMachineRegistry.getRandomTeeIds(_getExtensionId(), 1);
    ITeeExtensionRegistry.TeeInstructionParams memory params;
    params.opType = OP_TYPE_MY_OP;
    params.opCommand = OP_COMMAND_MY_CMD;
    params.message = _message;
    teeExtensionRegistry.sendInstructions{value: msg.value}(teeIds, params);
}
```

## Verification

After all steps, build/compile your project to verify there are no errors. Report the result to the user.

## Important notes

- **Infrastructure and custom code must be clearly separated** -- use separate directories or modules following your language's conventions.
- **Do NOT modify infrastructure code** -- only edit your custom code and the Solidity contract.
- **Always read each file before editing.**
- **OPType strings must match exactly** across Solidity and your handler constants. Mismatches cause actions to fall through and return "unsupported op type".
