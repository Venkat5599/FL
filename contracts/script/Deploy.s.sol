// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";

import {PostRegistry} from "../src/PostRegistry.sol";
import {CallTape} from "../src/CallTape.sol";
import {TapeInstructionSender} from "../src/TapeInstructionSender.sol";
import {ITeeExtensionRegistry} from "../src/interfaces/ITeeExtensionRegistry.sol";
import {ITeeMachineRegistry} from "../src/interfaces/ITeeMachineRegistry.sol";

/// @title Deploy
/// @notice Deploys the TAPE contract set to a Flare network.
///
/// @dev Deployment order is not arbitrary — each contract is immutably bound to the one
///      before it, which is what stops the pieces from being repointed later:
///        1. PostRegistry  — standalone; resolves FDC through the contract registry.
///        2. CallTape      — immutably bound to PostRegistry, so calls can never be
///                           rebased onto different evidence.
///        3. TapeInstructionSender — bound to both, and then set as CallTape's
///                           verdictWriter so the TEE is the only source of verdicts.
///
///      The TEE registry addresses are NOT resolvable through ContractRegistry (the FCC
///      registries are absent from the periphery package), so they are supplied by env
///      and read from the FCC scaffold's config/coston2/deployed-addresses.json.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url coston2 --broadcast --verify
///
/// Required env:
///   PRIVATE_KEY              deployer key (hex, no 0x)
///   TEE_EXTENSION_REGISTRY   from the FCC scaffold's deployed-addresses.json
///   TEE_MACHINE_REGISTRY     from the FCC scaffold's deployed-addresses.json
/// Optional env:
///   OWNER                    defaults to the deployer address
contract Deploy is Script {
    function run()
        external
        returns (PostRegistry postRegistry, CallTape callTape, TapeInstructionSender sender)
    {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("OWNER", deployer);

        address teeExtensionRegistry = vm.envAddress("TEE_EXTENSION_REGISTRY");
        address teeMachineRegistry = vm.envAddress("TEE_MACHINE_REGISTRY");

        vm.startBroadcast(pk);

        postRegistry = new PostRegistry();
        callTape = new CallTape(postRegistry, owner);
        sender = new TapeInstructionSender(
            ITeeExtensionRegistry(teeExtensionRegistry),
            ITeeMachineRegistry(teeMachineRegistry),
            postRegistry,
            callTape,
            owner
        );

        // Hand the tape's only write path to the instruction sender. Until this runs,
        // openCall reverts for everyone including the owner — which is the correct
        // failure mode: a tape with no wired TEE should record nothing rather than
        // accept self-reported verdicts.
        if (owner == deployer) {
            callTape.setVerdictWriter(address(sender));
        } else {
            console.log("NOTE: owner is not the deployer.");
            console.log("Run callTape.setVerdictWriter(sender) as the owner before use:");
            console.log("  callTape:", address(callTape));
            console.log("  sender:  ", address(sender));
        }

        vm.stopBroadcast();

        console.log("--- TAPE deployed ---");
        console.log("PostRegistry:          ", address(postRegistry));
        console.log("CallTape:              ", address(callTape));
        console.log("TapeInstructionSender: ", address(sender));
        console.log("owner:                 ", owner);
        console.log("");
        console.log("Next: register the extension (FCC pre-build.sh), then call");
        console.log("sender.setExtensionId() to pin the discovered extension id.");
    }
}
