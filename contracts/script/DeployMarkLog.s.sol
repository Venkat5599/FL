// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {FeedMarkLog} from "../src/FeedMarkLog.sol";

/// @notice Deploys FeedMarkLog. Standalone because it has no dependencies on the rest of
///         the system — it only needs the Flare contract registry, which is a fixed
///         address on every network.
contract DeployMarkLog is Script {
    function run() external returns (FeedMarkLog log) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        log = new FeedMarkLog();
        vm.stopBroadcast();
        console.log("FeedMarkLog:", address(log));
    }
}
