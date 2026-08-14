// SPDX-License-Identifier: MIT
// Bundled reference copy for tee-builder skill.
// Source: flare-smart-contracts-v2/contracts/userInterfaces/tee/ITeeMachineRegistry.sol
pragma solidity >=0.7.6 <0.9;

// Inlined from IPublicKey.sol
struct PublicKey {
    bytes32 x;
    bytes32 y;
}

// Inlined from ISignature.sol
struct Signature {
    uint8 v;
    bytes32 r;
    bytes32 s;
}

// Minimal stub — full definition in ITeeAvailabilityCheck.sol
interface ITeeAvailabilityCheck {
    struct Proof { bytes data; }
}

/**
 * TeeMachineRegistry interface.
 */
interface ITeeMachineRegistry {

    enum TeeStatus { NONE, INITIALIZED, PRODUCTION, SUSPENDED, PAUSED, BANNED }

    struct TeeMachineData {
        uint256 extensionId;
        address initialOwner;
        bytes32 codeHash;
        bytes32 platform;
        PublicKey publicKey;
    }

    struct TeeMachine {
        address teeId;
        address teeProxyId;
        string url;
    }

    struct TeeMachineWithAttestationData {
        address teeId;
        address initialTeeId;
        string url;
        bytes32 codeHash;
        bytes32 platform;
    }

    event TeeMachineRegistered(
        address indexed teeId,
        address indexed teeProxyId,
        address indexed owner,
        uint256 extensionId,
        string url,
        bytes32 codeHash,
        bytes32 platform
    );

    event TeeMachineStatusChanged(
        address indexed teeId,
        TeeStatus indexed newStatus
    );

    error TeeNotFound();
    error TooMany();
    error InvalidTeeStatus();

    /**
     * Returns random active TEE machine ids for a given extension.
     * @param _extensionId The id of the extension.
     * @param _count The number of TEE machine ids to return.
     * @return The list of TEE machine ids.
     */
    function getRandomTeeIds(uint256 _extensionId, uint256 _count)
        external view
        returns (address[] memory);

    /**
     * Get active TEE machines for a given extension.
     * @param _extensionId The id of the extension.
     * @return _teeIds The list of TEE machine ids.
     * @return _urls The list of TEE machine URLs.
     */
    function getActiveTeeMachines(uint256 _extensionId)
        external view
        returns (address[] memory _teeIds, string[] memory _urls);

    /**
     * Get the status of a TEE machine.
     * @param _teeId The TEE machine id.
     * @return The status of the TEE machine.
     */
    function getTeeMachineStatus(address _teeId)
        external view
        returns (TeeStatus);

    /**
     * Get the extension id for a TEE machine.
     * @param _teeId The TEE machine id.
     * @return The extension id.
     */
    function getExtensionId(address _teeId)
        external view
        returns (uint256);
}
