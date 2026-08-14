// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {CallTape} from "../src/CallTape.sol";
import {PostRegistry} from "../src/PostRegistry.sol";
import {
    MockFtsoV2,
    MockFdcVerification,
    MockFlareContractRegistry,
    FLARE_CONTRACT_REGISTRY_ADDRESS,
    FTSO_V2_NAME_HASH,
    FDC_VERIFICATION_NAME_HASH
} from "./mocks/FlareMocks.sol";

/// @notice Behavioural tests for CallTape.
/// @dev Weighted deliberately toward the failure modes rather than the happy path. The
///      happy path is one test; the rest are the cases that decide whether a track
///      record can be forged, withheld, or priced against a dead oracle — which is the
///      only thing this contract is actually for.
contract CallTapeTest is Test {
    // XRP/USD, from the FTSOv2 feed table.
    bytes21 constant XRP_USD = bytes21(0x015852502f55534400000000000000000000000000);

    PostRegistry registry;
    CallTape tape;
    MockFtsoV2 ftso;
    MockFdcVerification fdc;

    address owner = makeAddr("owner");
    address writer = makeAddr("verdictWriter");
    address stranger = makeAddr("stranger");
    address settler = makeAddr("settler");

    uint64 constant POST_CREATED_AT = 1_755_100_000;
    uint32 constant HORIZON = 7 days;

    function setUp() public {
        // Chain time must sit at or after the post's publish time, since PostRegistry
        // rejects future-dated posts.
        vm.warp(POST_CREATED_AT + 1 minutes);

        ftso = new MockFtsoV2();
        fdc = new MockFdcVerification();

        // The ContractRegistry library resolves through a hardcoded singleton address,
        // so the mock has to live at exactly that address. Etch the code there, then
        // configure it — storage writes land on the etched account.
        MockFlareContractRegistry impl = new MockFlareContractRegistry();
        vm.etch(FLARE_CONTRACT_REGISTRY_ADDRESS, address(impl).code);
        MockFlareContractRegistry reg = MockFlareContractRegistry(FLARE_CONTRACT_REGISTRY_ADDRESS);
        reg.setAddress(FTSO_V2_NAME_HASH, address(ftso));
        reg.setAddress(FDC_VERIFICATION_NAME_HASH, address(fdc));

        registry = new PostRegistry();
        tape = new CallTape(registry, owner);

        vm.prank(owner);
        tape.setVerdictWriter(writer);

        ftso.setFeed(XRP_USD, 2.41e18, uint64(block.timestamp));
    }

    // ---- helpers ----------------------------------------------------------------

    function _recordPost(string memory _postId, uint64 _createdAt) internal returns (uint256) {
        IWeb2Json.Proof memory proof;
        proof.data.votingRound = 987_654;
        proof.data.responseBody.abiEncodedData = abi.encode(
            PostRegistry.AttestedPost({
                postId: _postId,
                author: "SomeCaller",
                text: "longing XRP here, target 3.20",
                createdAt: _createdAt
            })
        );
        return registry.recordPost(proof);
    }

    function _defaultPost() internal returns (uint256) {
        return _recordPost("1750000000000000001", POST_CREATED_AT);
    }

    function _open(uint256 _postId) internal returns (uint256) {
        vm.prank(writer);
        return tape.openCall(_postId, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);
    }

    // ---- happy path -------------------------------------------------------------

    function test_OpenCall_RecordsEntryMarkAndLag() public {
        uint256 postId = _defaultPost();
        uint256 callId = _open(postId);

        CallTape.Call memory c = tape.getCall(callId);
        assertEq(c.postId, postId);
        assertEq(uint8(c.status), uint8(CallTape.Status.Open));
        assertEq(c.entryPriceWad, 2.41e18);
        assertEq(c.expiresAt, POST_CREATED_AT + HORIZON);
        // The whole point of storing the lag: the mark is 60s later than the post, and
        // the contract says so rather than implying they were simultaneous.
        assertEq(c.entryLagSecs, 60);
    }

    // ---- access control ---------------------------------------------------------

    function test_OpenCall_RevertsForNonVerdictWriter() public {
        uint256 postId = _defaultPost();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CallTape.NotVerdictWriter.selector, stranger));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);
    }

    /// @dev The owner is powerful but is deliberately NOT the verdict writer. If owning
    ///      the contract were enough to mint a track record, the TEE would be decorative.
    function test_OpenCall_RevertsForOwner() public {
        uint256 postId = _defaultPost();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(CallTape.NotVerdictWriter.selector, owner));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);
    }

    function test_VoidCall_OnlyOwner() public {
        uint256 callId = _open(_defaultPost());
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        tape.voidCall(callId, "feed retired");

        vm.prank(owner);
        tape.voidCall(callId, "feed retired");
        assertEq(uint8(tape.getCall(callId).status), uint8(CallTape.Status.Voided));
    }

    // ---- input validation -------------------------------------------------------

    function test_OpenCall_RevertsOnDirectionNone() public {
        uint256 postId = _defaultPost();
        vm.prank(writer);
        vm.expectRevert(CallTape.BadDirection.selector);
        tape.openCall(postId, XRP_USD, CallTape.Direction.None, 9000, HORIZON);
    }

    function test_OpenCall_RevertsOnConfidenceAboveMax() public {
        uint256 postId = _defaultPost();
        vm.prank(writer);
        vm.expectRevert(abi.encodeWithSelector(CallTape.BadConfidence.selector, uint16(10_001)));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Long, 10_001, HORIZON);
    }

    function test_OpenCall_RevertsOnHorizonOutOfRange() public {
        uint256 postId = _defaultPost();
        vm.startPrank(writer);
        vm.expectRevert(abi.encodeWithSelector(CallTape.HorizonOutOfRange.selector, uint32(1 minutes)));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Long, 9000, 1 minutes);

        vm.expectRevert(abi.encodeWithSelector(CallTape.HorizonOutOfRange.selector, uint32(400 days)));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Long, 9000, 400 days);
        vm.stopPrank();
    }

    /// @dev Cherry-picking guard: reopening the same post would let a caller keep only
    ///      the flattering instances.
    function test_OpenCall_RevertsOnDuplicatePost() public {
        uint256 postId = _defaultPost();
        uint256 callId = _open(postId);

        vm.prank(writer);
        vm.expectRevert(abi.encodeWithSelector(CallTape.PostAlreadyCalled.selector, postId, callId));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Short, 5000, HORIZON);
    }

    function test_OpenCall_RevertsForUnknownPost() public {
        vm.prank(writer);
        vm.expectRevert(PostRegistry.UnknownPost.selector);
        tape.openCall(42, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);
    }

    // ---- oracle safety ----------------------------------------------------------

    /// @dev The headline oracle check. A halted feed keeps returning its last value
    ///      forever; without this, calls would open and settle against a frozen price.
    function test_OpenCall_RevertsOnStaleFeed() public {
        uint256 postId = _defaultPost();
        uint64 staleTs = uint64(block.timestamp) - (tape.maxFeedAge() + 1);
        ftso.setFeed(XRP_USD, 2.41e18, staleTs);

        vm.prank(writer);
        vm.expectRevert(abi.encodeWithSelector(CallTape.StaleFeed.selector, XRP_USD, staleTs, uint64(block.timestamp)));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);
    }

    /// @dev Boundary: a mark exactly `maxFeedAge` old is still acceptable. One second
    ///      older is not (covered above). Freshness comparisons are a classic
    ///      off-by-one, so both sides of the edge are pinned.
    function test_OpenCall_AcceptsFeedExactlyAtMaxAge() public {
        uint256 postId = _defaultPost();
        ftso.setFeed(XRP_USD, 2.41e18, uint64(block.timestamp) - tape.maxFeedAge());
        uint256 callId = _open(postId);
        assertEq(tape.getCall(callId).entryPriceWad, 2.41e18);
    }

    function test_OpenCall_RevertsOnZeroPrice() public {
        uint256 postId = _defaultPost();
        ftso.setFeed(XRP_USD, 0, uint64(block.timestamp));
        vm.prank(writer);
        vm.expectRevert(abi.encodeWithSelector(CallTape.PriceOutOfRange.selector, XRP_USD, uint256(0)));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);
    }

    function test_OpenCall_RevertsOnAbsurdPrice() public {
        uint256 postId = _defaultPost();
        uint256 absurd = tape.MAX_PRICE_WAD() + 1;
        ftso.setFeed(XRP_USD, absurd, uint64(block.timestamp));
        vm.prank(writer);
        vm.expectRevert(abi.encodeWithSelector(CallTape.PriceOutOfRange.selector, XRP_USD, absurd));
        tape.openCall(postId, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);
    }

    // ---- fees -------------------------------------------------------------------

    function test_OpenCall_RevertsOnInsufficientFee() public {
        uint256 postId = _defaultPost();
        ftso.setFee(1 ether);
        vm.deal(writer, 10 ether);

        vm.prank(writer);
        vm.expectRevert(abi.encodeWithSelector(CallTape.InsufficientFeeValue.selector, 1 ether, 0.5 ether));
        tape.openCall{value: 0.5 ether}(postId, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);
    }

    /// @dev Callers are expected to be bots that pad msg.value against fee drift.
    ///      Keeping the remainder would quietly tax them on every call.
    function test_OpenCall_RefundsExcessValue() public {
        uint256 postId = _defaultPost();
        ftso.setFee(1 ether);
        vm.deal(writer, 10 ether);

        vm.prank(writer);
        tape.openCall{value: 3 ether}(postId, XRP_USD, CallTape.Direction.Long, 9000, HORIZON);

        // 10 - 1 (fee actually consumed) = 9; the other 2 came back.
        assertEq(writer.balance, 9 ether);
        assertEq(address(tape).balance, 0, "contract should never retain a balance");
    }

    // ---- settlement -------------------------------------------------------------

    function test_Settle_RevertsBeforeExpiry() public {
        uint256 callId = _open(_defaultPost());
        vm.warp(POST_CREATED_AT + HORIZON - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CallTape.NotYetExpired.selector, callId, POST_CREATED_AT + HORIZON, uint64(block.timestamp)
            )
        );
        tape.settle(callId);
    }

    /// @dev Boundary: settlement is permitted the instant block.timestamp == expiresAt.
    ///      A `>` here instead of `>=` would strand every call that a scheduler tries to
    ///      close exactly on time.
    function test_Settle_SucceedsExactlyAtExpiry() public {
        uint256 callId = _open(_defaultPost());
        vm.warp(POST_CREATED_AT + HORIZON);
        ftso.setFeed(XRP_USD, 2.41e18, uint64(block.timestamp));
        tape.settle(callId);
        assertEq(uint8(tape.getCall(callId).status), uint8(CallTape.Status.Settled));
    }

    /// @dev Permissionless settlement is a design guarantee, not an oversight: if only a
    ///      privileged party could close a call, losers would simply be left open.
    function test_Settle_IsPermissionless() public {
        uint256 callId = _open(_defaultPost());
        vm.warp(POST_CREATED_AT + HORIZON);
        ftso.setFeed(XRP_USD, 2.00e18, uint64(block.timestamp));

        vm.prank(settler);
        int256 pnl = tape.settle(callId);
        assertLt(pnl, 0, "a stranger must be able to book a loss");
    }

    function test_Settle_LongProfit() public {
        uint256 callId = _open(_defaultPost());
        vm.warp(POST_CREATED_AT + HORIZON);
        // 2.41 -> 2.651 is +10%.
        ftso.setFeed(XRP_USD, 2.651e18, uint64(block.timestamp));
        int256 pnl = tape.settle(callId);
        assertEq(pnl, 1000, "+10% == 1000 bps");
        assertEq(tape.realisedPnlBps(callId), 1000);
    }

    function test_Settle_ShortInvertsSign() public {
        uint256 postId = _recordPost("1750000000000000002", POST_CREATED_AT);
        vm.prank(writer);
        uint256 callId = tape.openCall(postId, XRP_USD, CallTape.Direction.Short, 8000, HORIZON);

        vm.warp(POST_CREATED_AT + HORIZON);
        ftso.setFeed(XRP_USD, 2.169e18, uint64(block.timestamp)); // -10% spot
        int256 pnl = tape.settle(callId);
        assertEq(pnl, 1000, "a short profits when price falls");
    }

    function test_Settle_RevertsIfAlreadySettled() public {
        uint256 callId = _open(_defaultPost());
        vm.warp(POST_CREATED_AT + HORIZON);
        ftso.setFeed(XRP_USD, 2.41e18, uint64(block.timestamp));
        tape.settle(callId);

        vm.expectRevert(abi.encodeWithSelector(CallTape.NotOpen.selector, callId, CallTape.Status.Settled));
        tape.settle(callId);
    }

    function test_Settle_RevertsOnVoidedCall() public {
        uint256 callId = _open(_defaultPost());
        vm.prank(owner);
        tape.voidCall(callId, "feed retired");

        vm.warp(POST_CREATED_AT + HORIZON);
        vm.expectRevert(abi.encodeWithSelector(CallTape.NotOpen.selector, callId, CallTape.Status.Voided));
        tape.settle(callId);
    }

    // ---- admin bounds -----------------------------------------------------------

    /// @dev The bounds exist so a compromised owner cannot accept arbitrarily stale
    ///      prices (age = infinity) or brick settlement (age = 0).
    function test_SetMaxFeedAge_EnforcesBounds() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(CallTape.FeedAgeOutOfRange.selector, uint64(1 seconds)));
        tape.setMaxFeedAge(1 seconds);

        vm.expectRevert(abi.encodeWithSelector(CallTape.FeedAgeOutOfRange.selector, uint64(2 hours)));
        tape.setMaxFeedAge(2 hours);

        tape.setMaxFeedAge(10 minutes);
        assertEq(tape.maxFeedAge(), 10 minutes);
        vm.stopPrank();
    }

    function test_SetVerdictWriter_RejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(CallTape.ZeroAddress.selector);
        tape.setVerdictWriter(address(0));
    }

    // ---- fuzz -------------------------------------------------------------------

    /// @dev P&L must be sign-correct for any entry/settle pair in a sane price range,
    ///      and long/short must be exact mirrors of each other.
    function testFuzz_PnlSignIsCorrect(uint256 _entry, uint256 _settle) public {
        _entry = bound(_entry, 1e12, 1e30);
        _settle = bound(_settle, 1e12, 1e30);

        uint256 longPost = _recordPost("fuzz-long", POST_CREATED_AT);
        uint256 shortPost = _recordPost("fuzz-short", POST_CREATED_AT);

        ftso.setFeed(XRP_USD, _entry, uint64(block.timestamp));
        vm.startPrank(writer);
        uint256 longId = tape.openCall(longPost, XRP_USD, CallTape.Direction.Long, 5000, HORIZON);
        uint256 shortId = tape.openCall(shortPost, XRP_USD, CallTape.Direction.Short, 5000, HORIZON);
        vm.stopPrank();

        vm.warp(POST_CREATED_AT + HORIZON);
        ftso.setFeed(XRP_USD, _settle, uint64(block.timestamp));

        int256 longPnl = tape.settle(longId);
        int256 shortPnl = tape.settle(shortId);

        if (_settle > _entry) {
            assertGe(longPnl, 0, "long must not lose when price rises");
            assertLe(shortPnl, 0, "short must not gain when price rises");
        } else if (_settle < _entry) {
            assertLe(longPnl, 0, "long must not gain when price falls");
            assertGe(shortPnl, 0, "short must not lose when price falls");
        } else {
            assertEq(longPnl, 0);
            assertEq(shortPnl, 0);
        }
    }
}
