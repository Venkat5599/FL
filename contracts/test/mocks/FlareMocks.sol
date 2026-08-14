// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";

// Address of the singleton `FlareContractRegistry`. Identical on Flare, Songbird,
// Coston and Coston2, and hardcoded inside the `ContractRegistry` library, so tests
// must intercept lookups at exactly this address.
address constant FLARE_CONTRACT_REGISTRY_ADDRESS = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

// The registry name hashes the `ContractRegistry` library resolves against.
// `abi.encode`, not `abi.encodePacked` — matching the library exactly. Getting this
// wrong yields a silent zero address rather than a failure, so it is pinned once here.
bytes32 constant FTSO_V2_NAME_HASH = keccak256(abi.encode("FtsoV2"));
bytes32 constant FDC_VERIFICATION_NAME_HASH = keccak256(abi.encode("FdcVerification"));

/// @title MockFtsoV2
/// @notice Controllable stand-in for FTSOv2, so the price-dependent branches of CallTape
///         (staleness, zero/over-range price, fee handling) can be driven deterministically.
/// @dev Only the paths CallTape actually uses carry real behaviour. The rest satisfy the
///      interface and revert rather than pretending to work, so a future caller that
///      starts relying on them fails loudly instead of silently reading a fabricated price.
contract MockFtsoV2 is FtsoV2Interface {
    struct Feed {
        uint256 priceWad;
        uint64 timestamp;
        bool set;
    }

    mapping(bytes21 => Feed) public feeds;
    uint256 public fee;

    error NotMocked();

    function setFeed(bytes21 _feedId, uint256 _priceWad, uint64 _timestamp) external {
        feeds[_feedId] = Feed({priceWad: _priceWad, timestamp: _timestamp, set: true});
    }

    function setFee(uint256 _fee) external {
        fee = _fee;
    }

    function getFeedByIdInWei(bytes21 _feedId) external payable returns (uint256 _value, uint64 _timestamp) {
        Feed memory f = feeds[_feedId];
        if (!f.set) revert NotMocked();
        return (f.priceWad, f.timestamp);
    }

    function calculateFeeById(bytes21) external view returns (uint256) {
        return fee;
    }

    function calculateFeeByIds(bytes21[] memory _feedIds) external view returns (uint256) {
        return fee * _feedIds.length;
    }

    // ---- unused interface surface ------------------------------------------------

    function getFeedById(bytes21) external payable returns (uint256, int8, uint64) {
        revert NotMocked();
    }

    function getFeedsById(bytes21[] memory) external payable returns (uint256[] memory, int8[] memory, uint64) {
        revert NotMocked();
    }

    function getFeedsByIdInWei(bytes21[] memory) external payable returns (uint256[] memory, uint64) {
        revert NotMocked();
    }

    function getFtsoProtocolId() external pure returns (uint256) {
        return 100;
    }

    function getSupportedFeedIds() external pure returns (bytes21[] memory) {
        return new bytes21[](0);
    }

    function getFeedIdChanges() external pure returns (FeedIdChange[] memory) {
        return new FeedIdChange[](0);
    }

    function verifyFeedData(FeedDataWithProof calldata) external pure returns (bool) {
        return true;
    }

    /// @dev Accepts the fee CallTape forwards. Without this the `{value: fee}` call
    ///      reverts and every fee-path test would fail for the wrong reason.
    receive() external payable {}
}

/// @title MockFlareContractRegistry
/// @notice Minimal stand-in for the singleton registry, resolving name hashes to the
///         mock implementations a test has installed.
contract MockFlareContractRegistry {
    mapping(bytes32 => address) private _addresses;

    function setAddress(bytes32 _nameHash, address _addr) external {
        _addresses[_nameHash] = _addr;
    }

    function getContractAddressByHash(bytes32 _nameHash) external view returns (address) {
        return _addresses[_nameHash];
    }
}

/// @title MockFdcVerification
/// @notice Stand-in for the FDC verifier. `verifyWeb2Json` is the only method
///         PostRegistry calls, and a test flips it to drive the accept/reject branches.
/// @dev Deliberately not declared as `is IFdcVerification`: that interface aggregates
///      nine verification interfaces, and stubbing all of them would add a large surface
///      with no test value. PostRegistry reaches it through a cast, so answering the one
///      selector it invokes is sufficient — and honest about what is actually covered.
contract MockFdcVerification {
    bool public shouldVerify = true;

    function setShouldVerify(bool _v) external {
        shouldVerify = _v;
    }

    /// @dev A fallback rather than a typed method: the real `verifyWeb2Json` takes a
    ///      deeply-nested calldata struct, and decoding it here would add a second
    ///      implementation of the ABI layout that could disagree with the first. The
    ///      contract under test only cares about the boolean, so answer the boolean.
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(shouldVerify);
    }
}
