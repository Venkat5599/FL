// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

// Vendored verbatim from flare-foundation/fce-sign@main:
//   contracts/interfaces/ITeeMachineRegistry.sol
//
// See the note in ITeeExtensionRegistry.sol for why these are vendored rather than
// imported from @flarenetwork/flare-periphery-contracts.
interface ITeeMachineRegistry {
    /// @notice Pick TEE machines at random from those registered to an extension.
    /// @dev Randomness matters for integrity, not load balancing: it stops a caller from
    ///      steering their instruction to a machine of their choosing, which is what
    ///      makes "the enclave scored this" a meaningful claim rather than a formality.
    function getRandomTeeIds(uint256 _extensionId, uint256 _count) external view returns (address[] memory);
}
