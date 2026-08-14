// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

import {PostRegistry} from "../src/PostRegistry.sol";
import {
    MockFdcVerification,
    MockFlareContractRegistry,
    FLARE_CONTRACT_REGISTRY_ADDRESS,
    FDC_VERIFICATION_NAME_HASH
} from "./mocks/FlareMocks.sol";

/// @notice Behavioural tests for the evidence layer.
/// @dev The property under test throughout is that the record cannot be bent: a post
///      cannot be entered without a valid proof, cannot be dated forward, and cannot be
///      quietly rewritten after a call has been scored against it.
contract PostRegistryTest is Test {
    PostRegistry registry;
    MockFdcVerification fdc;

    uint64 constant NOW_TS = 1_755_100_000;

    event ContentDiverged(uint256 indexed postId, bytes32 storedContentHash, bytes32 newContentHash);

    function setUp() public {
        vm.warp(NOW_TS);

        fdc = new MockFdcVerification();
        MockFlareContractRegistry impl = new MockFlareContractRegistry();
        vm.etch(FLARE_CONTRACT_REGISTRY_ADDRESS, address(impl).code);
        MockFlareContractRegistry(FLARE_CONTRACT_REGISTRY_ADDRESS).setAddress(
            FDC_VERIFICATION_NAME_HASH, address(fdc)
        );

        registry = new PostRegistry();
    }

    function _proof(string memory _postId, string memory _author, string memory _text, uint256 _createdAt)
        internal
        pure
        returns (IWeb2Json.Proof memory proof)
    {
        proof.data.votingRound = 987_654;
        proof.data.responseBody.abiEncodedData = abi.encode(
            PostRegistry.AttestedPost({postId: _postId, author: _author, text: _text, createdAt: _createdAt})
        );
    }

    // ---- the proof is the authority ---------------------------------------------

    function test_RecordPost_StoresDigests() public {
        uint256 id = registry.recordPost(_proof("1750000000000000001", "SomeCaller", "longing XRP here", NOW_TS - 60));

        PostRegistry.Post memory p = registry.getPost(id);
        assertEq(p.postIdHash, keccak256(bytes("1750000000000000001")));
        assertEq(p.contentHash, keccak256(bytes("longing XRP here")));
        assertEq(p.createdAt, NOW_TS - 60);
        assertEq(p.attestedAt, NOW_TS);
        assertEq(p.votingRound, 987_654);
        assertEq(registry.totalPosts(), 1);
    }

    /// @dev The single check the whole product rests on. Without it anyone could write
    ///      invented history into the tape.
    function test_RecordPost_RevertsWhenProofDoesNotVerify() public {
        fdc.setShouldVerify(false);
        vm.expectRevert(PostRegistry.InvalidProof.selector);
        registry.recordPost(_proof("1750000000000000001", "SomeCaller", "longing XRP here", NOW_TS - 60));
    }

    function test_RecordPost_RevertsOnEmptyPostId() public {
        vm.expectRevert(PostRegistry.EmptyPostId.selector);
        registry.recordPost(_proof("", "SomeCaller", "longing XRP here", NOW_TS - 60));
    }

    // ---- time cannot be gamed ---------------------------------------------------

    /// @dev A future-dated post would let someone pre-position a call and choose its
    ///      entry mark after the fact.
    function test_RecordPost_RevertsOnFutureCreatedAt() public {
        uint256 future = NOW_TS + registry.CREATED_AT_SKEW_TOLERANCE() + 1;
        vm.expectRevert(abi.encodeWithSelector(PostRegistry.CreatedAtInFuture.selector, future, NOW_TS));
        registry.recordPost(_proof("1750000000000000001", "SomeCaller", "longing XRP here", future));
    }

    /// @dev Boundary: exactly at the tolerance is still accepted. Ordinary clock skew
    ///      between the platform and Flare must not reject honest posts.
    function test_RecordPost_AcceptsCreatedAtExactlyAtSkewLimit() public {
        uint64 edge = NOW_TS + registry.CREATED_AT_SKEW_TOLERANCE();
        uint256 id = registry.recordPost(_proof("1750000000000000001", "SomeCaller", "longing XRP here", edge));
        assertEq(registry.getPost(id).createdAt, edge);
    }

    // ---- history is append-only -------------------------------------------------

    /// @dev Re-attesting the same post must not create a second record, or a caller
    ///      could stack duplicates and keep only the flattering one.
    function test_RecordPost_IsIdempotentForSamePost() public {
        IWeb2Json.Proof memory p = _proof("1750000000000000001", "SomeCaller", "longing XRP here", NOW_TS - 60);
        uint256 first = registry.recordPost(p);
        uint256 second = registry.recordPost(p);

        assertEq(first, second);
        assertEq(registry.totalPosts(), 1);
    }

    /// @dev An edit is real information about the caller. The original text stays
    ///      authoritative — it is what any existing call was scored against — and the
    ///      divergence is emitted rather than swallowed.
    function test_RecordPost_EmitsContentDivergedAndKeepsOriginal() public {
        uint256 id = registry.recordPost(_proof("1750000000000000001", "SomeCaller", "longing XRP here", NOW_TS - 60));
        bytes32 original = keccak256(bytes("longing XRP here"));
        bytes32 edited = keccak256(bytes("actually shorting XRP"));

        vm.expectEmit(true, false, false, true);
        emit ContentDiverged(id, original, edited);
        registry.recordPost(_proof("1750000000000000001", "SomeCaller", "actually shorting XRP", NOW_TS - 60));

        assertEq(registry.getPost(id).contentHash, original, "original text must remain authoritative");
        assertEq(registry.totalPosts(), 1);
    }

    // ---- lookups ----------------------------------------------------------------

    function test_FindPost_And_IsRecorded() public {
        (bool foundBefore,) = registry.findPost("1750000000000000001");
        assertFalse(foundBefore);
        assertFalse(registry.isRecorded(keccak256(bytes("1750000000000000001"))));

        uint256 id = registry.recordPost(_proof("1750000000000000001", "SomeCaller", "longing XRP here", NOW_TS - 60));

        (bool found, uint256 postId) = registry.findPost("1750000000000000001");
        assertTrue(found);
        assertEq(postId, id);
        assertTrue(registry.isRecorded(keccak256(bytes("1750000000000000001"))));
    }

    function test_GetPost_RevertsForUnknownIndex() public {
        vm.expectRevert(PostRegistry.UnknownPost.selector);
        registry.getPost(0);
    }

    /// @dev Handles are case-insensitive on the source platform, so two spellings of the
    ///      same account must not split into two identities on the leaderboard.
    function test_AuthorHashIsCaseInsensitive() public {
        uint256 a = registry.recordPost(_proof("post-a", "SomeCaller", "longing XRP", NOW_TS - 60));
        uint256 b = registry.recordPost(_proof("post-b", "somecaller", "longing FLR", NOW_TS - 60));

        assertEq(registry.getPost(a).authorHash, registry.getPost(b).authorHash);
        assertEq(registry.getPost(a).authorHash, keccak256(bytes("somecaller")));
    }

    // ---- fuzz -------------------------------------------------------------------

    /// @dev Any two distinct post ids must get their own slots; neither may collide into
    ///      the other's record.
    function testFuzz_DistinctPostIdsGetDistinctRecords(string calldata _idA, string calldata _idB) public {
        vm.assume(bytes(_idA).length > 0 && bytes(_idB).length > 0);
        vm.assume(keccak256(bytes(_idA)) != keccak256(bytes(_idB)));

        uint256 a = registry.recordPost(_proof(_idA, "SomeCaller", "longing XRP", NOW_TS - 60));
        uint256 b = registry.recordPost(_proof(_idB, "SomeCaller", "longing XRP", NOW_TS - 60));

        assertTrue(a != b);
        assertEq(registry.totalPosts(), 2);
    }
}
