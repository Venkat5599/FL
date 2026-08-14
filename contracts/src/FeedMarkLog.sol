// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";

/// @title FeedMarkLog
/// @notice A public, append-only log of FTSOv2 price marks.
///
/// @dev This is not a demo prop bolted on for a video — it is the mechanism the rest of
///      TAPE depends on, isolated so it can be used before a call exists.
///
///      FTSOv2 is a spot oracle: it answers "what is this worth now" roughly every 1.8
///      seconds and keeps no history. So TAPE cannot look backwards to price a call after
///      the fact; it has to record marks FORWARD, at the moment it observes them, and let
///      those recordings become the history. `CallTape` does that at open and settle. This
///      contract does the same thing standalone, for the case where you want the price
///      witnessed and timestamped by the chain before any call is bound to it.
///
///      What makes a mark here worth more than a screenshot: the price is not supplied by
///      the caller. It is read inside this transaction from FTSOv2, resolved through the
///      Flare contract registry, and stored with the oracle's own timestamp alongside the
///      block's. Nobody — including whoever paid the gas — chooses the number.
contract FeedMarkLog {
    struct Mark {
        bytes21 feedId;
        uint256 priceWad; // 1e18-scaled, exactly as FTSOv2 returned it
        uint64 feedTimestamp; // the ORACLE's timestamp for the observation
        uint64 recordedAt; // block time when this contract witnessed it
        address recorder;
        /// @dev Free-form label the caller attaches, e.g. a post id or a call reference.
        ///      Never interpreted here — this contract records prices, it does not
        ///      pretend to know what they are being used for.
        bytes32 tag;
    }

    Mark[] private _marks;

    /// @dev feedId => the mark ids recorded for it, so a feed's observed history can be
    ///      read back without scanning everything.
    mapping(bytes21 => uint256[]) private _marksOfFeed;

    event MarkRecorded(
        uint256 indexed markId,
        bytes21 indexed feedId,
        address indexed recorder,
        uint256 priceWad,
        uint64 feedTimestamp,
        bytes32 tag
    );

    error PriceOutOfRange(bytes21 feedId, uint256 priceWad);
    error StaleFeed(bytes21 feedId, uint64 feedTs, uint64 nowTs);
    error InsufficientFeeValue(uint256 required, uint256 provided);
    error RefundFailed();
    error UnknownMark(uint256 markId);

    /// @dev Mirrors CallTape's staleness rule. A mark this contract would accept but
    ///      CallTape would reject is a mark that means nothing downstream.
    uint64 public constant MAX_FEED_AGE = 5 minutes;

    /// @dev Same sanity ceiling as CallTape, for the same reason: it keeps every stored
    ///      price inside a range where downstream signed arithmetic cannot overflow.
    uint256 public constant MAX_PRICE_WAD = 1e36;

    /// @notice Read a feed from FTSOv2 and write the result to the permanent record.
    /// @dev Permissionless. There is nothing to gate: the caller cannot influence the
    ///      price, only pay for it to be witnessed.
    /// @param _feedId The bytes21 FTSOv2 feed id.
    /// @param _tag Caller's own reference. Opaque to this contract.
    /// @return markId Index of the stored mark.
    function recordMark(bytes21 _feedId, bytes32 _tag) external payable returns (uint256 markId) {
        FtsoV2Interface ftso = ContractRegistry.getFtsoV2();

        uint256 fee = ftso.calculateFeeById(_feedId);
        if (msg.value < fee) revert InsufficientFeeValue(fee, msg.value);

        // `getFeedByIdInWei` rather than `getFeedById`: it returns the value already
        // scaled to 1e18, so marks taken at different times stay comparable even if the
        // feed's own `decimals` changes between them.
        (uint256 priceWad, uint64 feedTs) = ftso.getFeedByIdInWei{value: fee}(_feedId);

        if (priceWad == 0 || priceWad > MAX_PRICE_WAD) revert PriceOutOfRange(_feedId, priceWad);

        // A halted feed keeps returning its last value forever. Recording that as an
        // observation would put a stale number into a permanent record that presents
        // itself as a timestamped observation.
        if (feedTs + MAX_FEED_AGE < block.timestamp) {
            revert StaleFeed(_feedId, feedTs, uint64(block.timestamp));
        }

        markId = _marks.length;
        _marks.push(
            Mark({
                feedId: _feedId,
                priceWad: priceWad,
                feedTimestamp: feedTs,
                recordedAt: uint64(block.timestamp),
                recorder: msg.sender,
                tag: _tag
            })
        );
        _marksOfFeed[_feedId].push(markId);

        emit MarkRecorded(markId, _feedId, msg.sender, priceWad, feedTs, _tag);

        _refundExcess();
    }

    function getMark(uint256 _markId) external view returns (Mark memory) {
        if (_markId >= _marks.length) revert UnknownMark(_markId);
        return _marks[_markId];
    }

    function totalMarks() external view returns (uint256) {
        return _marks.length;
    }

    function markIdsOfFeed(bytes21 _feedId) external view returns (uint256[] memory) {
        return _marksOfFeed[_feedId];
    }

    /// @notice The fee FTSOv2 charges to read this feed, so callers can size `msg.value`.
    function markFee(bytes21 _feedId) external view returns (uint256) {
        return ContractRegistry.getFtsoV2().calculateFeeById(_feedId);
    }

    /// @dev Return any overpayment, last. Callers are expected to pad against fee drift,
    ///      and silently keeping the remainder would quietly tax every mark.
    function _refundExcess() internal {
        uint256 balance = address(this).balance;
        if (balance == 0) return;
        (bool ok,) = payable(msg.sender).call{value: balance}("");
        if (!ok) revert RefundFailed();
    }
}
