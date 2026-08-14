// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

// Vendored verbatim from flare-foundation/fce-sign@main:
//   contracts/interfaces/ITeeExtensionRegistry.sol
//
// Vendored rather than imported because the Flare Confidential Compute registries are
// NOT part of @flarenetwork/flare-periphery-contracts (checked against 0.1.52: the
// coston2/ tree contains no Tee* interfaces). The upstream file carries this note:
//
//   TODO: Replace this minimal interface with the full import once flare-smart-contracts-v2
//   is published as a package:
//     import { ITeeExtensionRegistry } from "flare-smart-contracts-v2/contracts/userInterfaces/tee/ITeeExtensionRegistry.sol";
//
// so this copy should be re-synced when that package ships.
interface ITeeExtensionRegistry {
    /// @dev `opType` and `opCommand` route the instruction to a handler inside the TEE.
    ///      They are compared against hashed string constants on the extension side, so
    ///      the exact bytes32 string here must match the extension's constants
    ///      byte-for-byte, or the enclave rejects the instruction as an unsupported
    ///      op type/command.
    struct TeeInstructionParams {
        bytes32 opType;
        bytes32 opCommand;
        bytes message;
        address[] cosigners;
        uint64 cosignersThreshold;
        address claimBackAddress;
    }

    function sendInstructions(address[] calldata _teeIds, TeeInstructionParams calldata _instructionParams)
        external
        payable
        returns (bytes32 _instructionId);

    function nextPublicExtensionId() external view returns (uint256);

    function getTeeExtensionInstructionsSender(uint256 _extensionId) external view returns (address);
}
