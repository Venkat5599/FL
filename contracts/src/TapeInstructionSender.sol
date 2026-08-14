// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {ITeeExtensionRegistry} from "./interfaces/ITeeExtensionRegistry.sol";
import {ITeeMachineRegistry} from "./interfaces/ITeeMachineRegistry.sol";
import {PostRegistry} from "./PostRegistry.sol";
import {CallTape} from "./CallTape.sol";

/// @title TapeInstructionSender
/// @notice The on-chain entry point to TAPE's Flare Confidential Compute extension: the
///         only way to ask the enclave to classify a post or rank a caller.
///
/// @dev Why any of this runs in a TEE. Classification and ranking are judgement, and
///      judgement that is published can be farmed. If the scoring weights were in a
///      smart contract, every caller could read them and shape their posts to score
///      well — Goodhart's law, and the leaderboard becomes noise within a week. So the
///      weights live inside the enclave and are never published. What IS published is
///      everything needed to hold the system to account: the input (an FDC-attested
///      post), the output (a signed verdict written back on-chain), and the identity of
///      the machine that produced it (registered in the TEE machine registry). Secret
///      function, public inputs, public outputs.
///
///      The integrity gap this contract closes. The enclave needs the post *text* to
///      classify it, but the chain only stores a digest. That leaves an obvious hole:
///      a relayer could hand the TEE different text from what was attested, and get a
///      verdict about a post nobody ever made. So `requestClassify` re-hashes the
///      supplied text and requires it to equal the `contentHash` FDC proved. The text
///      travels with the instruction, but it can only ever be the attested text.
contract TapeInstructionSender is Ownable2Step {
    /// @dev Must match the extension's own constants byte-for-byte — the enclave
    ///      compares hashed string constants, so a mismatch surfaces as "unsupported op
    ///      type/command" rather than as anything more diagnostic. The `F_` prefix is
    ///      reserved for Flare system operations and is deliberately avoided here.
    ///      The `bytes32("...")` form is mandated by the protocol (it is what the
    ///      registry and the enclave both expect), and every literal here is 8 ASCII
    ///      bytes or fewer, so the cast cannot truncate. The lint is suppressed per-line
    ///      rather than globally, so a genuinely lossy cast elsewhere still gets caught.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_SCORE = bytes32("SCORE");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_CLASSIFY = bytes32("CLASSIFY");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_RANK = bytes32("RANK");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_WEIGHTS = bytes32("WEIGHTS");

    /// @dev Public extension ids start here; `setExtensionId` scans upward from this
    ///      floor to find the id whose registered sender is this contract.
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000;

    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;
    PostRegistry public immutable POST_REGISTRY;
    CallTape public immutable CALL_TAPE;

    uint256 private _extensionId;

    event ExtensionIdSet(uint256 extensionId);
    event ClassifyRequested(bytes32 indexed instructionId, uint256 indexed postId, address indexed requester);
    event RankRequested(bytes32 indexed instructionId, bytes32 indexed authorHash, address indexed requester);
    event WeightsUpdateRequested(bytes32 indexed instructionId);

    error ZeroAddress();
    error ExtensionIdAlreadySet();
    error ExtensionIdNotFound();
    error ExtensionIdNotSet();
    error TextDoesNotMatchAttestation(bytes32 expected, bytes32 actual);
    error NoTeeMachinesAvailable();
    error NoSettledCalls(bytes32 authorHash);

    constructor(
        ITeeExtensionRegistry _teeExtensionRegistry,
        ITeeMachineRegistry _teeMachineRegistry,
        PostRegistry _postRegistry,
        CallTape _callTape,
        address _initialOwner
    ) Ownable(_initialOwner) {
        if (
            address(_teeExtensionRegistry) == address(0) || address(_teeMachineRegistry) == address(0)
                || address(_postRegistry) == address(0) || address(_callTape) == address(0)
        ) {
            revert ZeroAddress();
        }
        TEE_EXTENSION_REGISTRY = _teeExtensionRegistry;
        TEE_MACHINE_REGISTRY = _teeMachineRegistry;
        POST_REGISTRY = _postRegistry;
        CALL_TAPE = _callTape;
    }

    /// @notice Discover and pin this contract's extension id.
    /// @dev Registration happens off-chain during deployment (`pre-build.sh`), so the id
    ///      is not known at construction time and has to be found afterwards by scanning
    ///      the registry for the extension whose sender is this address. Permissionless
    ///      and one-shot: the answer is a fact about the registry rather than a policy
    ///      choice, so there is nothing to gate — but it must never be reassigned, or
    ///      instructions would silently start routing to a different extension.
    function setExtensionId() external returns (uint256) {
        if (_extensionId != 0) revert ExtensionIdAlreadySet();

        uint256 next = TEE_EXTENSION_REGISTRY.nextPublicExtensionId();
        for (uint256 i = FIRST_PUBLIC_EXTENSION_ID; i < next; ++i) {
            if (TEE_EXTENSION_REGISTRY.getTeeExtensionInstructionsSender(i) == address(this)) {
                _extensionId = i;
                emit ExtensionIdSet(i);
                return i;
            }
        }
        revert ExtensionIdNotFound();
    }

    function extensionId() external view returns (uint256) {
        return _getExtensionId();
    }

    /// @notice Ask the enclave to classify an attested post into a trade signal.
    /// @dev Permissionless: anyone may pay to have a post scored, including the caller
    ///      themselves. That is safe precisely because the requester controls nothing
    ///      about the outcome — not the text (pinned to the attestation below), not the
    ///      machine (chosen at random), and not the weights (sealed in the enclave).
    /// @param _postId Index of an already-attested post in PostRegistry.
    /// @param _text The post text, which must hash to the attested `contentHash`.
    function requestClassify(uint256 _postId, string calldata _text)
        external
        payable
        returns (bytes32 instructionId)
    {
        // Reverts UnknownPost for an unattested id, so the enclave is never asked to
        // reason about a post that FDC never proved.
        PostRegistry.Post memory post = POST_REGISTRY.getPost(_postId);

        bytes32 actual = keccak256(bytes(_text));
        if (actual != post.contentHash) {
            revert TextDoesNotMatchAttestation(post.contentHash, actual);
        }

        instructionId = _send(OP_COMMAND_CLASSIFY, abi.encode(_postId, _text));
        emit ClassifyRequested(instructionId, _postId, msg.sender);
    }

    /// @notice Ask the enclave to re-rank a caller under the sealed scoring weights.
    /// @dev The caller's record is READ FROM CHAIN here, never accepted as an argument.
    ///      That distinction is the whole security of this path: the requester chooses
    ///      *who* gets ranked, but has no say in *what* is counted. If the settled calls
    ///      arrived as calldata, anyone could hand the enclave a flattering subset of
    ///      their own history and receive a genuine, TEE-signed score over a forgery.
    /// @param _authorHash keccak256 of the lowercased handle, as stored by PostRegistry.
    /// @param _offset Index into the author's call list to rank from.
    /// @param _limit Maximum settled calls to include; paginated because a prolific
    ///        caller's record would otherwise exceed what fits in one instruction.
    function requestRank(bytes32 _authorHash, uint256 _offset, uint256 _limit)
        external
        payable
        returns (bytes32 instructionId)
    {
        (CallTape.SettledCall[] memory settled,) = CALL_TAPE.settledCallsOfAuthor(_authorHash, _offset, _limit);
        if (settled.length == 0) revert NoSettledCalls(_authorHash);

        instructionId = _send(OP_COMMAND_RANK, abi.encode(_authorHash, settled));
        emit RankRequested(instructionId, _authorHash, msg.sender);
    }

    /// @notice Deliver ranking weights to the enclave.
    /// @dev The payload is ciphertext, encrypted to the TEE's public key off-chain; this
    ///      contract never sees the plaintext and neither does the chain. Weights are not
    ///      compiled into the extension because the image is open source and reproducibly
    ///      built, so anything inside it is public by construction — provisioning them at
    ///      runtime is the only way "secret weights" is a true statement rather than a
    ///      marketing one.
    ///
    ///      Owner-only: weights define the leaderboard, so the right to set them is the
    ///      right to decide who ranks well.
    function updateWeights(bytes calldata _encryptedWeights) external payable onlyOwner returns (bytes32) {
        bytes32 instructionId = _send(OP_COMMAND_WEIGHTS, _encryptedWeights);
        emit WeightsUpdateRequested(instructionId);
        return instructionId;
    }

    // ---- internals --------------------------------------------------------------

    function _send(bytes32 _opCommand, bytes memory _message) internal returns (bytes32) {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        if (teeIds.length == 0) revert NoTeeMachinesAvailable();

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_SCORE,
            opCommand: _opCommand,
            message: _message,
            // No cosigners: a classification is a single-machine judgement, and a
            // threshold scheme would add coordination cost without changing who can
            // read the weights. Revisit if verdicts ever move real custody.
            cosigners: new address[](0),
            cosignersThreshold: 0,
            // Unused instruction fees return to whoever paid them, not to this contract.
            claimBackAddress: msg.sender
        });

        return TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }

    function _getExtensionId() internal view returns (uint256) {
        uint256 id = _extensionId;
        if (id == 0) revert ExtensionIdNotSet();
        return id;
    }
}
