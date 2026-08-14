// SPDX-License-Identifier: MIT
// Bundled reference copy for create-extension skill.
// Source: flare-smart-contracts-v2/contracts/userInterfaces/tee/ITeeExtensionRegistry.sol
pragma solidity >=0.7.6 <0.9;

// Minimal stub -- full definition in ITeeMachineRegistry.sol
interface ITeeMachineRegistry {
    struct TeeMachine {
        address teeId;
        address teeProxyId;
        string url;
    }
}

/**
 * TeeExtensionRegistry interface.
 */
interface ITeeExtensionRegistry {

    struct TeeInstructionParams {
        bytes32 opType;
        bytes32 opCommand;
        bytes message;
        address[] cosigners;
        uint64 cosignersThreshold;
        address claimBackAddress;
    }

    event TeeInstructionsSent(
        uint256 indexed extensionId,
        bytes32 indexed instructionId,
        uint32 indexed rewardEpochId,
        ITeeMachineRegistry.TeeMachine[] teeMachines,
        bytes32 opType,
        bytes32 opCommand,
        bytes message,
        address[] cosigners,
        uint64 cosignersThreshold,
        uint256 fee
    );

    error NoTeeMachinesSpecified();
    error OperationTypeEmpty();
    error OperationCommandEmpty();
    error MessageEmpty();
    error ExtensionIdMismatch();
    error OnlyInstructionsSender();
    error FeeTooLow();
    error TeeMachineNotAvailable();

    /**
     * Send instructions to the TEE machines. Instruction ID will be generated internally and returned.
     * Emits a TeeInstructionsSent event.
     * @param _teeIds The TEE machine IDs to which the instructions are sent (must all belong to the same extension).
     * @param _instructionParams The instruction parameters (opType, opCommand, message, and optional cosigner/claimBack fields).
     * @return _instructionId The generated instruction ID.
     * Can only be called by the TEE machines extension instructions sender.
     */
    function sendInstructions(
        address[] memory _teeIds,
        TeeInstructionParams memory _instructionParams
    )
        external payable
        returns (bytes32 _instructionId);

    /**
     * Get the next public extension ID to be assigned. Public extension IDs are
     * assigned from FIRST_PUBLIC_EXTENSION_ID (0x10000) upward; IDs below that
     * are reserved for system/reserved extensions.
     * @return The next public extension ID.
     */
    function nextPublicExtensionId()
        external view
        returns (uint256);

    /**
     * Get the TEE extension instructions sender address.
     * @param _extensionId The id of the extension.
     * @return The TEE extension instructions sender address.
     */
    function getTeeExtensionInstructionsSender(uint256 _extensionId)
        external view
        returns (address);
}
