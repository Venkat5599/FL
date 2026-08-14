// check-tee-state — one-shot read-only diagnostic for "why does test.sh revert with TooMany()?"
//
// Pulls four facts and prints them side by side:
//   1. Extension ID the TEE proxy reports (from /info).
//   2. Extension ID stored inside the deployed InstructionSender (slot 0).
//   3. Extension ID the on-chain TEE machine record is bound to.
//   4. getActiveTeeMachines for both extension IDs (proxy's and InstructionSender's).
//
// All four should agree and the active set should include the TEE address.
// When they don't, the printed verdict says exactly which mismatch is breaking
// test.sh (and post-build.sh's toProduction).
package main

import (
	"context"
	"flag"
	"fmt"
	"math/big"
	"os"

	"sign-extension/tools/pkg/configs"
	"sign-extension/tools/pkg/fccutils"
	"sign-extension/tools/pkg/support"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
)

// TeeStatus enum order from the verified MachineManagerFacet source on Coston2.
// enum TeeStatus { NONE, INITIALIZED, PRODUCTION, SUSPENDED, PAUSED, BANNED }
var teeStatusNames = []string{
	"NONE",
	"INITIALIZED",
	"PRODUCTION",
	"SUSPENDED",
	"PAUSED",
	"BANNED",
}

func statusName(s uint8) string {
	if int(s) < len(teeStatusNames) {
		return teeStatusNames[s]
	}
	return "UNKNOWN"
}

func main() {
	af := flag.String("a", configs.AddressesFile, "deployed-addresses.json path")
	cf := flag.String("c", configs.ChainNodeURL, "chain RPC URL")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy URL")
	isf := flag.String("instructionSender", os.Getenv("INSTRUCTION_SENDER"), "InstructionSender contract address")
	flag.Parse()

	if *isf == "" {
		fmt.Fprintln(os.Stderr, "ERROR: --instructionSender required (or set INSTRUCTION_SENDER env)")
		os.Exit(1)
	}
	instructionSender := common.HexToAddress(*isf)

	s, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fmt.Fprintf(os.Stderr, "support init: %v\n", err)
		os.Exit(1)
	}

	teeInfo, err := fccutils.TeeInfo(*pf)
	if err != nil {
		fmt.Fprintf(os.Stderr, "proxy /info: %v\n", err)
		os.Exit(1)
	}
	teeID, _, err := fccutils.TeeProxyId(teeInfo)
	if err != nil {
		fmt.Fprintf(os.Stderr, "derive teeID: %v\n", err)
		os.Exit(1)
	}

	ctx := context.Background()
	callOpts := &bind.CallOpts{Context: ctx}

	proxyExtID := teeInfo.MachineData.ExtensionID.Big()

	// InstructionSender storage layout:
	//   ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;  // immutable, no slot
	//   ITeeMachineRegistry  public immutable TEE_MACHINE_REGISTRY;     // immutable, no slot
	//   uint256 private _extensionId;                                   // slot 0
	slot0, err := s.ChainClient.StorageAt(ctx, instructionSender, common.Hash{}, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read InstructionSender slot 0: %v\n", err)
		os.Exit(1)
	}
	isExtID := new(big.Int).SetBytes(slot0)

	teeStatus, statusErr := s.TeeMachineRegistry.GetTeeMachineStatus(callOpts, teeID)
	teeOnchainExtID, extIDErr := s.TeeMachineRegistry.GetExtensionId(callOpts, teeID)
	teeOwner, ownerErr := s.TeeMachineRegistry.GetTeeMachineOwner(callOpts, teeID)
	teeRecord, recordErr := s.TeeMachineRegistry.GetTeeMachine(callOpts, teeID)

	fmt.Println("=== Inputs ===")
	fmt.Printf("  Chain RPC:           %s\n", *cf)
	fmt.Printf("  Proxy:               %s\n", *pf)
	fmt.Printf("  FlareTeeManager:     %s\n", s.Addresses.FlareTeeManager.Hex())
	fmt.Printf("  InstructionSender:   %s\n", instructionSender.Hex())
	fmt.Printf("  TEE ID (from proxy): %s\n", teeID.Hex())

	fmt.Println("\n=== Extension IDs (the three things that must agree) ===")
	fmt.Printf("  Proxy /info:                   %s\n", proxyExtID.String())
	fmt.Printf("  InstructionSender._extensionId %s\n", isExtID.String())
	if extIDErr != nil {
		fmt.Printf("  TEE on-chain getExtensionId    ERROR: %v\n", extIDErr)
	} else {
		fmt.Printf("  TEE on-chain getExtensionId    %s\n", teeOnchainExtID.String())
	}

	fmt.Println("\n=== TEE machine record ===")
	if recordErr != nil {
		fmt.Printf("  getTeeMachine ERROR: %v\n", recordErr)
	} else if teeRecord.TeeId == (common.Address{}) {
		fmt.Println("  (no record — TEE is not registered)")
	} else {
		fmt.Printf("  teeId=%s teeProxyId=%s url=%q\n", teeRecord.TeeId.Hex(), teeRecord.TeeProxyId.Hex(), teeRecord.Url)
	}
	if statusErr != nil {
		fmt.Printf("  getTeeMachineStatus ERROR: %v\n", statusErr)
	} else {
		fmt.Printf("  status: %d (%s)\n", teeStatus, statusName(teeStatus))
	}
	if ownerErr != nil {
		fmt.Printf("  getTeeMachineOwner ERROR: %v\n", ownerErr)
	} else {
		fmt.Printf("  owner: %s\n", teeOwner.Hex())
	}

	fmt.Println("\n=== Active TEE set membership ===")
	listActive("proxy", proxyExtID, teeID, s, callOpts)
	if isExtID.Cmp(proxyExtID) != 0 {
		listActive("InstructionSender", isExtID, teeID, s, callOpts)
	}
	if extIDErr == nil && teeOnchainExtID.Cmp(proxyExtID) != 0 && teeOnchainExtID.Cmp(isExtID) != 0 {
		listActive("TEE record", teeOnchainExtID, teeID, s, callOpts)
	}

	fmt.Println("\n=== InstructionSender registered for the TEE's extension ===")
	registeredSenders := map[*big.Int]string{}
	if extIDErr == nil {
		registeredSenders[teeOnchainExtID] = "TEE record"
	}
	registeredSenders[proxyExtID] = "proxy"
	registeredSenders[isExtID] = "InstructionSender slot 0"
	seen := map[string]bool{}
	for ext, label := range registeredSenders {
		key := ext.String()
		if seen[key] {
			continue
		}
		seen[key] = true
		addr, err := s.TeeExtensionRegistry.GetTeeExtensionInstructionsSender(callOpts, ext)
		if err != nil {
			fmt.Printf("  [%s ext=%s] getTeeExtensionInstructionsSender ERROR: %v\n", label, ext.String(), err)
		} else {
			fmt.Printf("  [%s ext=%s] -> %s\n", label, ext.String(), addr.Hex())
		}
	}

	fmt.Println("\n=== Verdict ===")
	verdict(proxyExtID, isExtID, teeOnchainExtID, extIDErr, teeStatus, statusErr, instructionSender, s, callOpts)
}

func listActive(label string, extID *big.Int, teeID common.Address, s *support.Support, callOpts *bind.CallOpts) {
	out, err := s.TeeMachineRegistry.GetActiveTeeMachines(callOpts, extID)
	if err != nil {
		fmt.Printf("  [%s ext=%s] ERROR: %v\n", label, extID.String(), err)
		return
	}
	contains := false
	for _, id := range out.TeeIds {
		if id == teeID {
			contains = true
			break
		}
	}
	fmt.Printf("  [%s ext=%s] count=%d contains-this-TEE=%v\n", label, extID.String(), len(out.TeeIds), contains)
	for i, id := range out.TeeIds {
		fmt.Printf("    %d: %s %q\n", i, id.Hex(), out.Urls[i])
	}
}

func verdict(proxy, is, onchain *big.Int, onchainErr error, status uint8, statusErr error, currentSender common.Address, s *support.Support, callOpts *bind.CallOpts) {
	if onchainErr != nil {
		fmt.Println("  TEE has no on-chain record — register it (run post-build.sh against a fresh extension).")
		return
	}
	mismatch := false
	if is.Cmp(onchain) != 0 {
		fmt.Printf("  MISMATCH: InstructionSender ext=%s ≠ TEE on-chain ext=%s\n", is.String(), onchain.String())
		fmt.Println("    → updateKey calls getRandomTeeIds(InstructionSender's ext) which has no TEEs → TooMany.")
		if registered, err := s.TeeExtensionRegistry.GetTeeExtensionInstructionsSender(callOpts, onchain); err == nil && registered != (common.Address{}) {
			fmt.Printf("    → Quick fix: set INSTRUCTION_SENDER=%s in config/extension.env (this is the sender registered against the TEE's ext %s).\n", registered.Hex(), onchain.String())
			if registered == currentSender {
				fmt.Println("    → (Same address as your current INSTRUCTION_SENDER. Did slot 0 read wrong, or is the binding stale?)")
			}
		} else {
			fmt.Println("    → Or redeploy InstructionSender + register fresh TEE under it.")
		}
		mismatch = true
	}
	if proxy.Cmp(onchain) != 0 {
		fmt.Printf("  MISMATCH: proxy reports ext=%s ≠ TEE on-chain ext=%s\n", proxy.String(), onchain.String())
		fmt.Println("    → post-build.sh will request attestations against the wrong extension.")
		mismatch = true
	}
	if statusErr == nil && status != 1 && status != 4 { // not INITIALIZED, not PAUSED
		fmt.Printf("  toProduction will revert: status=%d (%s); toProduction requires INITIALIZED(1) or PAUSED(4).\n", status, statusName(status))
		if status == 2 {
			fmt.Println("    → TEE is already in PRODUCTION. If active set contains it, you're done — skip post-build's `p` step.")
			fmt.Println("    → If active set is empty (TooMany), the TEE is orphaned — see mismatches above, or call pause() then re-promote.")
		}
		mismatch = true
	}
	if !mismatch {
		fmt.Println("  All consistent. If test.sh still fails, the active set was emptied for a non-status reason (banned/disabled version).")
	}
}
