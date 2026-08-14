// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";

import {PostRegistry} from "./PostRegistry.sol";

/// @title CallTape
/// @notice The scoring layer of TAPE: turns an FDC-attested post into a marked, priced,
///         settleable trade call, using FTSOv2 for both the entry and the settle mark.
///
/// @dev The three-protocol split is the whole point of this contract, so it is worth
///      stating plainly:
///        - PostRegistry (FDC) says *what was published, and when*. Fact.
///        - The TEE (FCC) says *what that post means as a trade*. Judgement, made under
///          weights nobody outside the enclave can read, so callers cannot farm the
///          score. Only the registered instruction sender may deliver that judgement.
///        - FTSOv2 says *what the price was*. Neither we nor the caller touch it.
///      No single one of those parties can fake a track record alone, which is exactly
///      the property the product is selling.
///
///      On entry marks and honesty. FTSO is a spot oracle with no history, so this
///      contract cannot ask "what was XRP worth when he posted?". It can only mark the
///      price at the moment the call is opened. Rather than paper over that, every call
///      stores `entryLagSecs` — the gap between publication and the mark — so the UI can
///      show it and a reader can discount a call that was marked late. Pretending the
///      mark is contemporaneous would be the easy lie; this is the honest number.
contract CallTape is Ownable2Step, ReentrancyGuard {
    enum Direction {
        None,
        Long,
        Short
    }

    enum Status {
        None,
        Open,
        Settled,
        Voided
    }

    struct Call {
        uint256 postId; // index into PostRegistry
        bytes32 authorHash; // copied from the post, so a call knows whose record it joins
        bytes21 feedId; // FTSOv2 feed the call is priced against
        Direction direction;
        Status status;
        uint16 confidenceBps; // TEE's confidence in the classification, 0..10_000
        uint64 postedAt; // the post's publication time, copied from PostRegistry
        uint64 openedAt; // when the entry mark was taken
        uint64 expiresAt; // when settlement becomes permitted
        uint64 entryLagSecs; // openedAt - post.createdAt; see contract-level note
        uint256 entryPriceWad; // FTSO value, 1e18-scaled
        uint64 entryFeedTs; // FTSO's own timestamp for the entry mark
        uint256 settlePriceWad;
        uint64 settleFeedTs;
    }

    /// @notice Evidence layer. Immutable: repointing it would silently rebase every
    ///         existing call onto different evidence.
    PostRegistry public immutable POST_REGISTRY;

    /// @notice The only address permitted to open calls — the FCC instruction sender
    ///         that relays TEE verdicts. Mutable because the extension is redeployed
    ///         when its code version changes, which is a normal part of the FCC
    ///         lifecycle rather than an exceptional event.
    address public verdictWriter;

    /// @notice Reject any FTSO mark older than this. Guards against pricing a call — or
    ///         worse, settling one — against a feed that has stopped updating.
    /// @dev FTSOv2 block-latency feeds update roughly every 1.8s, so a tolerance in
    ///      minutes is already enormously slack; it exists to survive congestion, not to
    ///      accommodate a genuinely dead feed.
    uint64 public maxFeedAge = 5 minutes;

    /// @dev Bounds on `maxFeedAge` so that even a compromised owner cannot set it to
    ///      infinity (accept arbitrarily stale prices) or to zero (brick the contract).
    uint64 public constant MIN_FEED_AGE_BOUND = 30 seconds;
    uint64 public constant MAX_FEED_AGE_BOUND = 1 hours;

    /// @dev Horizon bounds. A sub-hour horizon would settle against essentially the same
    ///      tick as entry; a multi-year one would park capital forever.
    uint32 public constant MIN_HORIZON = 1 hours;
    uint32 public constant MAX_HORIZON = 365 days;

    /// @dev Upper sanity bound on a wad-scaled price (1e18 units), i.e. 1e18 whole units
    ///      of quote per unit of base. No real feed reaches this, so exceeding it means
    ///      the feed is malfunctioning rather than that an asset got expensive.
    ///
    ///      It also does load-bearing arithmetic work: because every stored price is
    ///      below 1e36, the `uint256 -> int256` casts in `_pnlBps` cannot truncate
    ///      (1e36 << 2^255) and `delta * 10_000` cannot overflow (1e36 * 1e4 = 1e40,
    ///      against an int256 ceiling near 5.7e76). That turns two casts that a linter
    ///      correctly flags as unchecked into casts that are checked at the source.
    uint256 public constant MAX_PRICE_WAD = 1e36;

    Call[] private _calls;

    /// @dev One call per post. Without this, the same attested post could be opened
    ///      repeatedly and only the flattering instances kept — reintroducing exactly
    ///      the cherry-picking the product exists to prevent.
    mapping(uint256 => uint256) private _callOfPostPlusOne;

    /// @dev authorHash => the call ids belonging to that caller.
    /// @notice Exists so a caller's record can be assembled FROM CHAIN STATE when the
    ///         TEE is asked to rank them. Without it, the ranking instruction would have
    ///         to carry the caller's own calls as an argument — and whoever pays for the
    ///         instruction could then hand the enclave a flattering subset. The enclave
    ///         would faithfully score the forgery and sign it. Sourcing the record here
    ///         removes that entire attack: the requester chooses *who* is ranked, never
    ///         *what* is counted.
    mapping(bytes32 => uint256[]) private _callsOfAuthor;

    event VerdictWriterUpdated(address indexed previous, address indexed current);
    event MaxFeedAgeUpdated(uint64 previous, uint64 current);
    event CallOpened(
        uint256 indexed callId,
        uint256 indexed postId,
        bytes21 indexed feedId,
        Direction direction,
        uint16 confidenceBps,
        uint256 entryPriceWad,
        uint64 entryFeedTs,
        uint64 expiresAt,
        uint64 entryLagSecs
    );
    event CallSettled(uint256 indexed callId, uint256 settlePriceWad, uint64 settleFeedTs, int256 pnlBps);
    event CallVoided(uint256 indexed callId, string reason);

    error NotVerdictWriter(address caller);
    error ZeroAddress();
    error PostAlreadyCalled(uint256 postId, uint256 existingCallId);
    error UnknownCall(uint256 callId);
    error BadDirection();
    error BadConfidence(uint16 confidenceBps);
    error HorizonOutOfRange(uint32 horizonSecs);
    error FeedAgeOutOfRange(uint64 requested);
    error StaleFeed(bytes21 feedId, uint64 feedTs, uint64 nowTs);
    error PriceOutOfRange(bytes21 feedId, uint256 priceWad);
    error InsufficientFeeValue(uint256 required, uint256 provided);
    error NotOpen(uint256 callId, Status status);
    error NotYetExpired(uint256 callId, uint64 expiresAt, uint64 nowTs);
    error RefundFailed();

    modifier onlyVerdictWriter() {
        // A `require`/`revert`, never an `if (...) { _; }` wrapper — a modifier whose
        // body only runs conditionally lets an unauthorised caller fall straight through
        // without reverting, which is a well-worn way to ship a silent access-control hole.
        if (msg.sender != verdictWriter) revert NotVerdictWriter(msg.sender);
        _;
    }

    constructor(PostRegistry _postRegistry, address _initialOwner) Ownable(_initialOwner) {
        if (address(_postRegistry) == address(0) || _initialOwner == address(0)) {
            revert ZeroAddress();
        }
        POST_REGISTRY = _postRegistry;
    }

    // ---- admin ------------------------------------------------------------------

    function setVerdictWriter(address _writer) external onlyOwner {
        if (_writer == address(0)) revert ZeroAddress();
        emit VerdictWriterUpdated(verdictWriter, _writer);
        verdictWriter = _writer;
    }

    function setMaxFeedAge(uint64 _age) external onlyOwner {
        if (_age < MIN_FEED_AGE_BOUND || _age > MAX_FEED_AGE_BOUND) {
            revert FeedAgeOutOfRange(_age);
        }
        emit MaxFeedAgeUpdated(maxFeedAge, _age);
        maxFeedAge = _age;
    }

    // ---- lifecycle --------------------------------------------------------------

    /// @notice Open a call against an attested post, taking its entry mark from FTSOv2.
    /// @dev Restricted to `verdictWriter` because `direction` and `confidenceBps` are the
    ///      TEE's output. Letting anyone supply them would make the tape self-reported,
    ///      which is the exact failure mode being designed out.
    /// @param _postId Index of the post in PostRegistry.
    /// @param _feedId FTSOv2 feed the call is priced against.
    /// @param _direction Long or Short. `None` is rejected — an unclassifiable post
    ///        should never have been opened as a call in the first place.
    /// @param _confidenceBps The TEE's confidence, 0..10_000.
    /// @param _horizonSecs Seconds after publication at which the call may settle.
    function openCall(
        uint256 _postId,
        bytes21 _feedId,
        Direction _direction,
        uint16 _confidenceBps,
        uint32 _horizonSecs
    ) external payable onlyVerdictWriter nonReentrant returns (uint256 callId) {
        if (_direction == Direction.None) revert BadDirection();
        if (_confidenceBps > 10_000) revert BadConfidence(_confidenceBps);
        if (_horizonSecs < MIN_HORIZON || _horizonSecs > MAX_HORIZON) {
            revert HorizonOutOfRange(_horizonSecs);
        }

        uint256 existingPlusOne = _callOfPostPlusOne[_postId];
        if (existingPlusOne != 0) revert PostAlreadyCalled(_postId, existingPlusOne - 1);

        // Reverts UnknownPost if the evidence layer has never seen this post, so a call
        // can never exist without an FDC proof behind it.
        PostRegistry.Post memory post = POST_REGISTRY.getPost(_postId);

        (uint256 priceWad, uint64 feedTs) = _mark(_feedId);

        callId = _calls.length;
        uint64 nowTs = uint64(block.timestamp);
        // `createdAt` is bounded to the near past by PostRegistry, so this cannot
        // underflow in practice; the guard covers the skew-tolerance edge where a post
        // is attested marginally ahead of chain time.
        uint64 lag = nowTs > post.createdAt ? nowTs - post.createdAt : 0;

        _calls.push(
            Call({
                postId: _postId,
                authorHash: post.authorHash,
                feedId: _feedId,
                direction: _direction,
                status: Status.Open,
                confidenceBps: _confidenceBps,
                postedAt: post.createdAt,
                openedAt: nowTs,
                expiresAt: post.createdAt + _horizonSecs,
                entryLagSecs: lag,
                entryPriceWad: priceWad,
                entryFeedTs: feedTs,
                settlePriceWad: 0,
                settleFeedTs: 0
            })
        );
        _callOfPostPlusOne[_postId] = callId + 1;
        _callsOfAuthor[post.authorHash].push(callId);

        emit CallOpened(
            callId, _postId, _feedId, _direction, _confidenceBps, priceWad, feedTs, _calls[callId].expiresAt, lag
        );

        _refundExcess();
    }

    /// @notice Settle an expired call against the current FTSOv2 mark.
    /// @dev Permissionless on purpose. If settlement were restricted, whoever held the
    ///      right could simply decline to settle losers, and the tape would fill with
    ///      calls left conveniently "open" forever. Anyone may close a matured call, so
    ///      a losing result cannot be withheld.
    function settle(uint256 _callId) external payable nonReentrant returns (int256 pnlBps) {
        if (_callId >= _calls.length) revert UnknownCall(_callId);
        Call storage c = _calls[_callId];
        if (c.status != Status.Open) revert NotOpen(_callId, c.status);

        // `<` here means settlement is allowed the instant `block.timestamp == expiresAt`
        // rather than one second later — the boundary case is the common one for a
        // scheduled settler, and off-by-one at an expiry boundary is a classic bug.
        if (block.timestamp < c.expiresAt) {
            revert NotYetExpired(_callId, c.expiresAt, uint64(block.timestamp));
        }

        (uint256 priceWad, uint64 feedTs) = _mark(c.feedId);

        // EFFECTS before the value-moving interaction in _refundExcess.
        c.settlePriceWad = priceWad;
        c.settleFeedTs = feedTs;
        c.status = Status.Settled;

        pnlBps = _pnlBps(c.direction, c.entryPriceWad, priceWad);
        emit CallSettled(_callId, priceWad, feedTs, pnlBps);

        _refundExcess();
    }

    /// @notice Void a call that can never be fairly settled.
    /// @dev Deliberately narrow. This is an owner power and therefore a trust hole if
    ///      abused — voiding a losing call would launder a bad record. It exists only
    ///      for calls whose feed has been retired or whose feed id changed under
    ///      FTSOv2's `FeedIdChanged`, and every use emits a reason and is rendered in the
    ///      UI as a void rather than silently vanishing from the caller's stats.
    function voidCall(uint256 _callId, string calldata _reason) external onlyOwner {
        if (_callId >= _calls.length) revert UnknownCall(_callId);
        Call storage c = _calls[_callId];
        if (c.status != Status.Open) revert NotOpen(_callId, c.status);
        c.status = Status.Voided;
        emit CallVoided(_callId, _reason);
    }

    // ---- views ------------------------------------------------------------------

    function getCall(uint256 _callId) external view returns (Call memory) {
        if (_callId >= _calls.length) revert UnknownCall(_callId);
        return _calls[_callId];
    }

    function totalCalls() external view returns (uint256) {
        return _calls.length;
    }

    function callOfPost(uint256 _postId) external view returns (bool found, uint256 callId) {
        uint256 plusOne = _callOfPostPlusOne[_postId];
        if (plusOne == 0) return (false, 0);
        return (true, plusOne - 1);
    }

    /// @notice Realised P&L of a settled call, in basis points.
    function realisedPnlBps(uint256 _callId) external view returns (int256) {
        if (_callId >= _calls.length) revert UnknownCall(_callId);
        Call memory c = _calls[_callId];
        if (c.status != Status.Settled) revert NotOpen(_callId, c.status);
        return _pnlBps(c.direction, c.entryPriceWad, c.settlePriceWad);
    }

    /// @notice Fee FTSOv2 charges to read this feed, for callers sizing `msg.value`.
    function markFee(bytes21 _feedId) external view returns (uint256) {
        return ContractRegistry.getFtsoV2().calculateFeeById(_feedId);
    }

    /// @notice Every call id belonging to a caller, settled or not.
    function callIdsOfAuthor(bytes32 _authorHash) external view returns (uint256[] memory) {
        return _callsOfAuthor[_authorHash];
    }

    function authorCallCount(bytes32 _authorHash) external view returns (uint256) {
        return _callsOfAuthor[_authorHash].length;
    }

    /// @notice One settled call, flattened to exactly what the ranking needs.
    struct SettledCall {
        int256 pnlBps;
        uint64 postedAt;
        uint64 settledAt;
        uint16 confidenceBps;
    }

    /// @notice A caller's settled record, assembled from chain state.
    /// @dev This is the input the TEE ranks. It is a view rather than an argument on
    ///      purpose: whoever pays for a ranking instruction picks the author, but cannot
    ///      pick which of that author's calls are counted. Open and voided calls are
    ///      excluded — an open call has no realised result to score, and a voided one was
    ///      explicitly ruled unscoreable.
    /// @param _offset Index into the author's call list to start from.
    /// @param _limit Maximum number of settled calls to return. Paginated because a
    ///        prolific caller's record would otherwise grow past what fits in one call.
    function settledCallsOfAuthor(bytes32 _authorHash, uint256 _offset, uint256 _limit)
        external
        view
        returns (SettledCall[] memory settled, uint256 nextOffset)
    {
        uint256[] storage ids = _callsOfAuthor[_authorHash];
        uint256 total = ids.length;
        if (_offset >= total || _limit == 0) return (new SettledCall[](0), total);

        uint256 end = _offset + _limit;
        if (end > total) end = total;

        // Two passes: count matches first so the returned array is exactly sized. A
        // trailing run of empty structs would be indistinguishable from real calls with
        // zero P&L once ABI-decoded off-chain.
        uint256 matches = 0;
        for (uint256 i = _offset; i < end; ++i) {
            if (_calls[ids[i]].status == Status.Settled) matches++;
        }

        settled = new SettledCall[](matches);
        uint256 w = 0;
        for (uint256 i = _offset; i < end; ++i) {
            Call storage c = _calls[ids[i]];
            if (c.status != Status.Settled) continue;
            settled[w++] = SettledCall({
                pnlBps: _pnlBps(c.direction, c.entryPriceWad, c.settlePriceWad),
                postedAt: c.postedAt,
                settledAt: c.settleFeedTs,
                confidenceBps: c.confidenceBps
            });
        }
        nextOffset = end;
    }

    // ---- internals --------------------------------------------------------------

    /// @dev Read a feed and enforce that the answer is both fresh and sane.
    ///      `getFeedByIdInWei` is used rather than `getFeedById` because it returns the
    ///      value already scaled to 1e18. Entry and settle marks are taken at different
    ///      times, and a feed's `decimals` can change between them; comparing two raw
    ///      values under different exponents is a silent-corruption bug waiting to
    ///      happen, and asking FTSO for a common scale removes the possibility entirely.
    function _mark(bytes21 _feedId) internal returns (uint256 priceWad, uint64 feedTs) {
        FtsoV2Interface ftso = ContractRegistry.getFtsoV2();

        uint256 fee = ftso.calculateFeeById(_feedId);
        if (msg.value < fee) revert InsufficientFeeValue(fee, msg.value);

        (priceWad, feedTs) = ftso.getFeedByIdInWei{value: fee}(_feedId);

        // A zero price is never a real quote; treating it as one would mark an entry at
        // zero and make every subsequent P&L division meaningless. The upper bound is
        // the same check from the other side, and it is what keeps `_pnlBps` arithmetic
        // provably in range (see MAX_PRICE_WAD).
        if (priceWad == 0 || priceWad > MAX_PRICE_WAD) revert PriceOutOfRange(_feedId, priceWad);

        // Staleness. The single most consequential oracle check here: without it a
        // halted feed silently freezes a price that calls keep settling against.
        // A feed timestamp at or slightly ahead of block time is ordinary, not stale.
        if (feedTs + maxFeedAge < block.timestamp) {
            revert StaleFeed(_feedId, feedTs, uint64(block.timestamp));
        }
    }

    /// @dev Signed return in basis points. Long profits when price rises, short when it
    ///      falls. `entry` is guaranteed non-zero by `_mark`, so the division is safe.
    function _pnlBps(Direction _direction, uint256 _entryWad, uint256 _settleWad) internal pure returns (int256) {
        // Both values already passed `_mark`'s MAX_PRICE_WAD bound, so neither can
        // truncate here. SafeCast makes that guarantee enforced rather than asserted:
        // if the bound is ever loosened, this reverts instead of silently wrapping a
        // price into a negative number and inverting the sign of the P&L.
        int256 entryPrice = SafeCast.toInt256(_entryWad);
        int256 settlePrice = SafeCast.toInt256(_settleWad);
        int256 delta = _direction == Direction.Long ? settlePrice - entryPrice : entryPrice - settlePrice;
        return (delta * 10_000) / entryPrice;
    }

    /// @dev Return whatever the caller overpaid, as the final action. Settlers are
    ///      expected to be bots that pad `msg.value` against fee drift, so silently
    ///      keeping the remainder would quietly tax them. This contract is never meant
    ///      to hold a balance between calls, so sweeping the full balance is correct.
    function _refundExcess() internal {
        uint256 balance = address(this).balance;
        if (balance == 0) return;
        (bool ok,) = payable(msg.sender).call{value: balance}("");
        if (!ok) revert RefundFailed();
    }
}
