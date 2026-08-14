// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/// @title PostRegistry
/// @notice The evidence layer of TAPE: an append-only record of social posts whose
///         existence and contents were proven by the Flare Data Connector, not asserted
///         by us.
///
/// @dev Why this exists at all. The whole premise of a caller track record is that the
///      record survives the caller deleting the post. In the pre-Flare version of this
///      product that guarantee rested on our own scraper and our own database, which is
///      exactly the thing a skeptical user should not accept. Here the claim "this
///      account published this exact text at this exact time" is carried by an FDC
///      Web2Json attestation: a Merkle proof against a voting round that Flare's data
///      providers signed. We verify it on-chain and store the digest. After that the
///      post can be deleted from the platform and the record still stands, and anyone
///      can recheck it without trusting this contract's operator.
///
///      Note what is deliberately NOT stored here: no interpretation. This contract
///      records only what the platform's API literally returned. Turning a post into a
///      trade signal is a judgement call, and judgement happens in the TEE
///      (see CallTape + TapeInstructionSender), never here.
contract PostRegistry {
    /// @notice A post whose existence and contents were proven via FDC.
    /// @dev `contentHash` is the digest of the post text as attested. It is what makes
    ///      an edit detectable: re-attesting an edited post yields a different hash
    ///      against the same postId, which surfaces as a divergence rather than
    ///      silently overwriting history.
    struct Post {
        bytes32 postIdHash; // keccak256 of the platform's post id string
        bytes32 authorHash; // keccak256 of the lowercased author handle
        bytes32 contentHash; // keccak256 of the post text
        uint64 createdAt; // author-declared publish time, from the platform API
        uint64 attestedAt; // when this contract accepted the proof
        uint64 votingRound; // FDC voting round that carried the attestation
    }

    /// @notice The shape the Web2Json `postProcessJq` filter must produce.
    /// @dev This is the ABI struct that `abiSignature` in the attestation request
    ///      describes, and that `responseBody.abiEncodedData` decodes into. Field order
    ///      here is load-bearing: it must match the jq object key order exactly or the
    ///      decode silently yields garbage rather than reverting.
    struct AttestedPost {
        string postId;
        string author;
        string text;
        uint256 createdAt;
    }

    /// @dev postIdHash => storage index + 1 (0 means "never recorded", so that the
    ///      zero value of the mapping is unambiguous and we never need a parallel
    ///      `exists` flag that could drift out of sync with the array).
    mapping(bytes32 => uint256) private _indexOfPostPlusOne;

    Post[] private _posts;

    event PostRecorded(
        uint256 indexed postId,
        bytes32 indexed postIdHash,
        bytes32 indexed authorHash,
        bytes32 contentHash,
        uint64 createdAt,
        uint64 votingRound
    );

    /// @notice Raised when the same post is re-attested with different text.
    /// @dev Not a revert: an edit is real information about the caller, so we keep the
    ///      original record authoritative and emit the divergence for indexers to show.
    event ContentDiverged(uint256 indexed postId, bytes32 storedContentHash, bytes32 newContentHash);

    error InvalidProof();
    error EmptyPostId();
    error CreatedAtInFuture(uint256 createdAt, uint256 nowTs);
    error UnknownPost();

    /// @dev A post cannot claim to have been published in the future. Small tolerance
    ///      absorbs ordinary clock skew between the platform's clock and Flare's without
    ///      opening a window wide enough to backdate anything meaningfully.
    uint64 public constant CREATED_AT_SKEW_TOLERANCE = 10 minutes;

    /// @notice Verify an FDC Web2Json proof and record the post it carries.
    /// @dev Permissionless by design. The proof is the authority, so gating who may
    ///      submit it would add a trusted party without adding a guarantee — anyone
    ///      willing to pay the gas can enter valid evidence into the record, including
    ///      a caller who wants their own good calls on the tape.
    /// @param _proof The Merkle proof plus attested response returned by the FDC DA layer.
    /// @return postId The index of the stored post.
    function recordPost(IWeb2Json.Proof calldata _proof) external returns (uint256 postId) {
        // CHECK: the proof must verify against the FDC relay for its voting round.
        // Everything downstream treats the decoded payload as fact, so this is the only
        // thing standing between the tape and arbitrary invented history.
        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(_proof)) {
            revert InvalidProof();
        }

        AttestedPost memory post = abi.decode(_proof.data.responseBody.abiEncodedData, (AttestedPost));

        bytes memory postIdBytes = bytes(post.postId);
        if (postIdBytes.length == 0) revert EmptyPostId();

        // A post dated in the future would let someone pre-position a "call" and pick
        // its entry mark afterwards. Reject rather than clamp, so the failure is loud.
        if (post.createdAt > block.timestamp + CREATED_AT_SKEW_TOLERANCE) {
            revert CreatedAtInFuture(post.createdAt, block.timestamp);
        }

        bytes32 postIdHash = keccak256(postIdBytes);
        bytes32 contentHash = keccak256(bytes(post.text));

        uint256 existingPlusOne = _indexOfPostPlusOne[postIdHash];
        if (existingPlusOne != 0) {
            // Already on the tape. The first attestation wins: re-recording would let
            // an edited post quietly replace the text a call was scored against. Report
            // the divergence and return the original id.
            postId = existingPlusOne - 1;
            bytes32 stored = _posts[postId].contentHash;
            if (stored != contentHash) {
                emit ContentDiverged(postId, stored, contentHash);
            }
            return postId;
        }

        postId = _posts.length;
        _posts.push(
            Post({
                postIdHash: postIdHash,
                authorHash: keccak256(bytes(_toLower(post.author))),
                contentHash: contentHash,
                createdAt: uint64(post.createdAt),
                attestedAt: uint64(block.timestamp),
                votingRound: _proof.data.votingRound
            })
        );
        _indexOfPostPlusOne[postIdHash] = postId + 1;

        emit PostRecorded(
            postId, postIdHash, _posts[postId].authorHash, contentHash, uint64(post.createdAt), _proof.data.votingRound
        );
    }

    /// @notice Read a recorded post by index.
    function getPost(uint256 _postId) external view returns (Post memory) {
        if (_postId >= _posts.length) revert UnknownPost();
        return _posts[_postId];
    }

    /// @notice Look up a post by the platform's post id string.
    /// @return found Whether the post has been attested.
    /// @return postId Its index when found.
    function findPost(string calldata _platformPostId) external view returns (bool found, uint256 postId) {
        uint256 plusOne = _indexOfPostPlusOne[keccak256(bytes(_platformPostId))];
        if (plusOne == 0) return (false, 0);
        return (true, plusOne - 1);
    }

    /// @notice Whether a post id has already been entered into the record.
    function isRecorded(bytes32 _postIdHash) external view returns (bool) {
        return _indexOfPostPlusOne[_postIdHash] != 0;
    }

    function totalPosts() external view returns (uint256) {
        return _posts.length;
    }

    /// @dev Handles are case-insensitive on every platform we index, so they are
    ///      normalised before hashing. ASCII-only on purpose: handles are constrained
    ///      to ASCII, and a full Unicode fold on-chain would cost far more than it buys.
    function _toLower(string memory _s) internal pure returns (string memory) {
        bytes memory b = bytes(_s);
        for (uint256 i = 0; i < b.length; ++i) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) {
                b[i] = bytes1(uint8(b[i]) + 32);
            }
        }
        return string(b);
    }
}
