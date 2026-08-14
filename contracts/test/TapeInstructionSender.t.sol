// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

import {TapeInstructionSender} from "../src/TapeInstructionSender.sol";
import {PostRegistry} from "../src/PostRegistry.sol";
import {CallTape} from "../src/CallTape.sol";
import {ITeeExtensionRegistry} from "../src/interfaces/ITeeExtensionRegistry.sol";
import {ITeeMachineRegistry} from "../src/interfaces/ITeeMachineRegistry.sol";
import {
    MockFdcVerification,
    MockFlareContractRegistry,
    FLARE_CONTRACT_REGISTRY_ADDRESS,
    FDC_VERIFICATION_NAME_HASH
} from "./mocks/FlareMocks.sol";

/// @dev Records what was dispatched so the test can assert on the exact instruction the
///      enclave would receive, rather than merely that "something was sent".
contract MockTeeExtensionRegistry is ITeeExtensionRegistry {
    uint256 public nextId = 0x10002;
    mapping(uint256 => address) public senders;

    bytes32 public lastOpType;
    bytes32 public lastOpCommand;
    bytes public lastMessage;
    address public lastClaimBack;
    uint256 public lastValue;
    uint256 public sendCount;

    function setSender(uint256 _id, address _sender) external {
        senders[_id] = _sender;
    }

    function setNextId(uint256 _id) external {
        nextId = _id;
    }

    function sendInstructions(address[] calldata, TeeInstructionParams calldata _p)
        external
        payable
        returns (bytes32)
    {
        lastOpType = _p.opType;
        lastOpCommand = _p.opCommand;
        lastMessage = _p.message;
        lastClaimBack = _p.claimBackAddress;
        lastValue = msg.value;
        sendCount++;
        return keccak256(abi.encode(_p.opCommand, sendCount));
    }

    function nextPublicExtensionId() external view returns (uint256) {
        return nextId;
    }

    function getTeeExtensionInstructionsSender(uint256 _extensionId) external view returns (address) {
        return senders[_extensionId];
    }
}

contract MockTeeMachineRegistry is ITeeMachineRegistry {
    uint256 public count = 1;

    function setCount(uint256 _c) external {
        count = _c;
    }

    function getRandomTeeIds(uint256, uint256) external view returns (address[] memory ids) {
        ids = new address[](count);
        for (uint256 i = 0; i < count; ++i) {
            ids[i] = address(uint160(0x1000 + i));
        }
    }
}

/// @notice Tests for the FCC entry point.
/// @dev The property that matters most here is the text↔attestation binding. The enclave
///      must reason about exactly the text FDC proved, and nothing else — otherwise a
///      relayer could obtain a genuine, signed verdict about a post that was never made.
contract TapeInstructionSenderTest is Test {
    PostRegistry registry;
    CallTape tape;
    TapeInstructionSender sender;
    MockTeeExtensionRegistry extReg;
    MockTeeMachineRegistry machineReg;
    MockFdcVerification fdc;

    uint64 constant NOW_TS = 1_755_100_000;
    uint256 constant EXTENSION_ID = 0x10001;
    string constant POST_TEXT = "longing XRP here, target 3.20";

    address requester = makeAddr("requester");
    address owner = makeAddr("owner");

    function setUp() public {
        vm.warp(NOW_TS);

        fdc = new MockFdcVerification();
        MockFlareContractRegistry impl = new MockFlareContractRegistry();
        vm.etch(FLARE_CONTRACT_REGISTRY_ADDRESS, address(impl).code);
        MockFlareContractRegistry(FLARE_CONTRACT_REGISTRY_ADDRESS).setAddress(
            FDC_VERIFICATION_NAME_HASH, address(fdc)
        );

        registry = new PostRegistry();
        tape = new CallTape(registry, owner);
        extReg = new MockTeeExtensionRegistry();
        machineReg = new MockTeeMachineRegistry();
        sender = new TapeInstructionSender(extReg, machineReg, registry, tape, owner);

        extReg.setSender(EXTENSION_ID, address(sender));
    }

    function _recordDefaultPost() internal returns (uint256) {
        IWeb2Json.Proof memory proof;
        proof.data.votingRound = 987_654;
        proof.data.responseBody.abiEncodedData = abi.encode(
            PostRegistry.AttestedPost({
                postId: "1750000000000000001",
                author: "SomeCaller",
                text: POST_TEXT,
                createdAt: NOW_TS - 60
            })
        );
        return registry.recordPost(proof);
    }

    // ---- extension id discovery -------------------------------------------------

    function test_SetExtensionId_PinsVerifiedId() public {
        vm.prank(owner);
        assertEq(sender.setExtensionId(EXTENSION_ID), EXTENSION_ID);
        assertEq(sender.extensionId(), EXTENSION_ID);
    }

    /// @dev The id is supplied by the caller but verified against the registry, so a
    ///      wrong or hostile id is rejected by the registry's own record rather than by
    ///      our say-so. This is what makes taking the id as an argument safe.
    function test_SetExtensionId_RevertsWhenRegistryDisagrees() public {
        extReg.setSender(EXTENSION_ID, address(0xdead));
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                TapeInstructionSender.ExtensionIdMismatch.selector,
                EXTENSION_ID,
                address(0xdead),
                address(sender)
            )
        );
        sender.setExtensionId(EXTENSION_ID);
    }

    function test_SetExtensionId_RevertsForUnregisteredId() public {
        vm.prank(owner);
        vm.expectRevert();
        sender.setExtensionId(999_999);
    }

    function test_SetExtensionId_IsOwnerOnly() public {
        vm.prank(requester);
        vm.expectRevert();
        sender.setExtensionId(EXTENSION_ID);
    }

    /// @dev Reassignment would silently reroute every later instruction to a different
    ///      extension, so it is a one-shot operation.
    function test_SetExtensionId_IsOneShot() public {
        vm.startPrank(owner);
        sender.setExtensionId(EXTENSION_ID);
        vm.expectRevert(TapeInstructionSender.ExtensionIdAlreadySet.selector);
        sender.setExtensionId(EXTENSION_ID);
        vm.stopPrank();
    }

    /// @dev The bounded finder replaces the old unbounded on-chain scan. It is a view,
    ///      so the range cap is not about gas — it is about the pattern never being
    ///      copied into a state-changing path.
    function test_FindExtensionId_LocatesAndRefusesHugeRanges() public {
        (bool found, uint256 id) = sender.findExtensionId(EXTENSION_ID, EXTENSION_ID + 5);
        assertTrue(found);
        assertEq(id, EXTENSION_ID);

        (bool missing,) = sender.findExtensionId(EXTENSION_ID + 10, EXTENSION_ID + 20);
        assertFalse(missing);

        vm.expectRevert(
            abi.encodeWithSelector(TapeInstructionSender.ScanRangeTooLarge.selector, uint256(0), uint256(100_000))
        );
        sender.findExtensionId(0, 100_000);
    }

    function test_RequestClassify_RevertsBeforeExtensionIdSet() public {
        uint256 postId = _recordDefaultPost();
        vm.expectRevert(TapeInstructionSender.ExtensionIdNotSet.selector);
        sender.requestClassify(postId, POST_TEXT);
    }

    // ---- the text/attestation binding -------------------------------------------

    /// @dev THE test in this file. Substituted text must be impossible to get scored,
    ///      even though the text itself travels off-chain with the instruction.
    function test_RequestClassify_RevertsOnSubstitutedText() public {
        uint256 postId = _recordDefaultPost();
        vm.prank(owner);
        sender.setExtensionId(EXTENSION_ID);

        string memory forged = "shorting XRP here, target 1.00";
        vm.expectRevert(
            abi.encodeWithSelector(
                TapeInstructionSender.TextDoesNotMatchAttestation.selector,
                keccak256(bytes(POST_TEXT)),
                keccak256(bytes(forged))
            )
        );
        sender.requestClassify(postId, forged);
    }

    /// @dev Even a single-character difference must fail — the binding is a hash
    ///      equality, not a similarity check.
    function test_RequestClassify_RevertsOnSingleCharacterChange() public {
        uint256 postId = _recordDefaultPost();
        vm.prank(owner);
        sender.setExtensionId(EXTENSION_ID);
        vm.expectRevert();
        sender.requestClassify(postId, "longing XRP here, target 3.21");
    }

    function test_RequestClassify_RevertsForUnattestedPost() public {
        vm.prank(owner);
        sender.setExtensionId(EXTENSION_ID);
        vm.expectRevert(PostRegistry.UnknownPost.selector);
        sender.requestClassify(99, POST_TEXT);
    }

    // ---- dispatch ---------------------------------------------------------------

    function test_RequestClassify_SendsCorrectlyRoutedInstruction() public {
        uint256 postId = _recordDefaultPost();
        vm.prank(owner);
        sender.setExtensionId(EXTENSION_ID);

        vm.deal(requester, 1 ether);
        vm.prank(requester);
        sender.requestClassify{value: 0.1 ether}(postId, POST_TEXT);

        assertEq(extReg.sendCount(), 1);
        assertEq(extReg.lastOpType(), bytes32("SCORE"));
        assertEq(extReg.lastOpCommand(), bytes32("CLASSIFY"));
        assertEq(extReg.lastValue(), 0.1 ether);
        // Unused fees must return to whoever paid, not to this contract.
        assertEq(extReg.lastClaimBack(), requester);

        (uint256 sentPostId, string memory sentText) = abi.decode(extReg.lastMessage(), (uint256, string));
        assertEq(sentPostId, postId);
        assertEq(sentText, POST_TEXT);
    }

    /// @dev A caller with no settled calls has no record to rank. Refusing here keeps
    ///      the enclave from being paid to score an empty history and emit a
    ///      TEE-signed zero that reads like a real verdict.
    function test_RequestRank_RevertsWithoutSettledCalls() public {
        vm.prank(owner);
        sender.setExtensionId(EXTENSION_ID);
        bytes32 authorHash = keccak256(bytes("somecaller"));

        vm.prank(requester);
        vm.expectRevert(abi.encodeWithSelector(TapeInstructionSender.NoSettledCalls.selector, authorHash));
        sender.requestRank(authorHash, 0, 50);
    }

    /// @dev If no machine is registered, fail loudly rather than dispatching into
    ///      nowhere and leaving the caller waiting for a verdict that cannot arrive.
    function test_Request_RevertsWhenNoTeeMachines() public {
        uint256 postId = _recordDefaultPost();
        vm.prank(owner);
        sender.setExtensionId(EXTENSION_ID);
        machineReg.setCount(0);
        vm.expectRevert(TapeInstructionSender.NoTeeMachinesAvailable.selector);
        sender.requestClassify(postId, POST_TEXT);
    }

    /// @dev Weights define the leaderboard, so the right to set them is the right to
    ///      decide who ranks well. It cannot be public.
    function test_UpdateWeights_IsOwnerOnly() public {
        vm.prank(owner);
        sender.setExtensionId(EXTENSION_ID);
        vm.prank(requester);
        vm.expectRevert();
        sender.updateWeights(hex"deadbeef");

        vm.prank(owner);
        sender.updateWeights(hex"deadbeef");
        assertEq(extReg.lastOpCommand(), bytes32("WEIGHTS"));
        assertEq(extReg.lastMessage(), hex"deadbeef");
    }

    function test_Constructor_RejectsZeroAddresses() public {
        vm.expectRevert(TapeInstructionSender.ZeroAddress.selector);
        new TapeInstructionSender(ITeeExtensionRegistry(address(0)), machineReg, registry, tape, owner);

        vm.expectRevert(TapeInstructionSender.ZeroAddress.selector);
        new TapeInstructionSender(extReg, ITeeMachineRegistry(address(0)), registry, tape, owner);

        vm.expectRevert(TapeInstructionSender.ZeroAddress.selector);
        new TapeInstructionSender(extReg, machineReg, PostRegistry(address(0)), tape, owner);

        vm.expectRevert(TapeInstructionSender.ZeroAddress.selector);
        new TapeInstructionSender(extReg, machineReg, registry, CallTape(address(0)), owner);
    }

    // ---- fuzz -------------------------------------------------------------------

    /// @dev No text other than the attested text may ever be accepted.
    function testFuzz_OnlyAttestedTextIsAccepted(string calldata _candidate) public {
        uint256 postId = _recordDefaultPost();
        vm.prank(owner);
        sender.setExtensionId(EXTENSION_ID);

        if (keccak256(bytes(_candidate)) == keccak256(bytes(POST_TEXT))) {
            sender.requestClassify(postId, _candidate);
            assertEq(extReg.sendCount(), 1);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(
                    TapeInstructionSender.TextDoesNotMatchAttestation.selector,
                    keccak256(bytes(POST_TEXT)),
                    keccak256(bytes(_candidate))
                )
            );
            sender.requestClassify(postId, _candidate);
            assertEq(extReg.sendCount(), 0);
        }
    }
}
