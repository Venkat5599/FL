// Package main runs the sign-extension end-to-end test:
//   1. setExtensionId on the deployed InstructionSender (idempotent)
//   2. fetch TEE public key from the extension proxy
//   3. ECIES-encrypt a fixed test private key under the TEE pubkey
//   4. send updateKey on-chain, poll for result
//   5. send sign(testMessage) on-chain, poll for result
//   6. ABI-decode (bytes message, bytes signature) from result.Data,
//      ecrecover the signer, verify it matches the test key's address
package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"

	"sign-extension/tools/pkg/configs"
	"sign-extension/tools/pkg/fccutils"
	"sign-extension/tools/pkg/support"
	instrutils "sign-extension/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/ecies"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/tee-node/pkg/types"
	"github.com/pkg/errors"
)

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	instructionSenderF := flag.String("instructionSender", os.Getenv("INSTRUCTION_SENDER"), "InstructionSender contract address")
	flag.Parse()

	if *instructionSenderF == "" {
		logger.Fatal("--instructionSender flag is required (or set INSTRUCTION_SENDER in .env)")
	}

	instructionSenderAddress := common.HexToAddress(*instructionSenderF)

	testSupport, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	// --- Step 1: setExtensionId ---
	logger.Infof("Step 1: Setting extension ID on InstructionSender...")
	if err := instrutils.SetExtensionId(testSupport, instructionSenderAddress); err != nil {
		if strings.Contains(err.Error(), "already set") || strings.Contains(err.Error(), "Extension ID already set") {
			logger.Infof("  Extension ID already set on contract, continuing")
		} else {
			fccutils.FatalWithCause(errors.Errorf(
				"setExtensionId failed — is the extension registered? Check pre-build.sh completed. Error: %s", err))
		}
	} else {
		logger.Infof("  Extension ID set.")
	}

	// --- Step 2: Fetch TEE public key and ECIES-encrypt a test private key ---
	logger.Infof("Step 2: Fetching TEE public key from extension proxy...")
	teeInfo, err := fccutils.TeeInfo(*pf)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("fetch TEE info: %s", err))
	}

	ecdsaPub, err := types.ParsePubKey(teeInfo.MachineData.PublicKey)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("parse TEE public key: %s", err))
	}

	eciesPub := &ecies.PublicKey{
		X:      ecdsaPub.X,
		Y:      ecdsaPub.Y,
		Curve:  ecies.DefaultCurve,
		Params: ecies.ECIES_AES128_SHA256,
	}

	// Fixed test private key for deterministic verification.
	testPrivKeyHex := "fad9c8855b740a0b7ed4c221dbad0f33a83a49cad6b3fe8d5817ac83d38b6a19"
	testPrivKeyBytes, _ := hex.DecodeString(testPrivKeyHex)
	testPrivKey, err := crypto.ToECDSA(testPrivKeyBytes)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("parse test private key: %s", err))
	}
	testAddress := crypto.PubkeyToAddress(testPrivKey.PublicKey)
	logger.Infof("  Test private key address: %s", testAddress.Hex())

	ciphertext, err := ecies.Encrypt(rand.Reader, eciesPub, testPrivKeyBytes, nil, nil)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ECIES encrypt: %s", err))
	}
	logger.Infof("  Encrypted key: %d bytes", len(ciphertext))

	// --- Step 3: updateKey ---
	logger.Infof("Step 3: Sending updateKey instruction on-chain...")
	updateKeyID, _, err := instrutils.SendUpdateKey(testSupport, instructionSenderAddress, ciphertext)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("updateKey: %s", err))
	}
	logger.Infof("  updateKey instruction ID: %s", updateKeyID.Hex())

	time.Sleep(5 * time.Second)

	// --- Step 4: poll for updateKey result ---
	logger.Infof("Step 4: Waiting for updateKey result...")
	updateResp, err := fccutils.ActionResult(*pf, updateKeyID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll updateKey: %s", err))
	}
	if updateResp.Result.Status == 0 {
		fccutils.FatalWithCause(errors.Errorf("updateKey instruction failed: %s", updateResp.Result.Log))
	}
	logger.Infof("  updateKey succeeded (status=%d)", updateResp.Result.Status)

	// --- Step 5: sign ---
	logger.Infof("Step 5: Sending sign instruction on-chain...")
	testMessage := []byte("Hello from the sign extension e2e test!")
	signID, _, err := instrutils.SendSign(testSupport, instructionSenderAddress, testMessage)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("sign: %s", err))
	}
	logger.Infof("  sign instruction ID: %s", signID.Hex())

	time.Sleep(5 * time.Second)

	// --- Step 6: poll for sign result and verify ---
	logger.Infof("Step 6: Waiting for sign result...")
	signResp, err := fccutils.ActionResult(*pf, signID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll sign: %s", err))
	}
	if signResp.Result.Status == 0 {
		fccutils.FatalWithCause(errors.Errorf("sign instruction failed: %s", signResp.Result.Log))
	}

	// The result data is ABI-encoded (bytes, bytes) = (originalMessage, signature).
	_, sigBytes, err := abiDecodeTwo(signResp.Result.Data)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ABI decode (bytes,bytes): %s", err))
	}
	logger.Infof("  Signature: %s", hex.EncodeToString(sigBytes))

	// Recover signer. signECDSA in the TEE returns [r,s,v] where v is 27 or 28;
	// SigToPub expects v in [0,3], so normalize.
	msgHash := crypto.Keccak256(testMessage)
	recoveredPub, err := crypto.SigToPub(msgHash, normalizeV(sigBytes))
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ecrecover: %s", err))
	}
	recoveredAddr := crypto.PubkeyToAddress(*recoveredPub)
	logger.Infof("  Recovered signer: %s", recoveredAddr.Hex())
	logger.Infof("  Expected signer:  %s", testAddress.Hex())

	if recoveredAddr != testAddress {
		fccutils.FatalWithCause(errors.Errorf("FAIL: recovered signer %s does not match expected %s", recoveredAddr.Hex(), testAddress.Hex()))
	}

	logger.Infof("All tests passed.")
}

// normalizeV converts a 65-byte [r,s,v] signature where v is 27 or 28 into the
// form expected by go-ethereum's SigToPub (v in [0,3]).
func normalizeV(sig []byte) []byte {
	if len(sig) != 65 {
		return sig
	}
	out := make([]byte, 65)
	copy(out, sig)
	if out[64] >= 27 {
		out[64] -= 27
	}
	return out
}

// abiDecodeTwo decodes ABI-encoded (bytes, bytes).
func abiDecodeTwo(data []byte) ([]byte, []byte, error) {
	if len(data) < 64 {
		return nil, nil, fmt.Errorf("data too short for (bytes,bytes): %d bytes", len(data))
	}
	offset1 := new(big.Int).SetBytes(data[0:32]).Uint64()
	offset2 := new(big.Int).SetBytes(data[32:64]).Uint64()

	readBytes := func(offset uint64) ([]byte, error) {
		if int(offset)+32 > len(data) {
			return nil, fmt.Errorf("offset %d out of range", offset)
		}
		length := new(big.Int).SetBytes(data[offset : offset+32]).Uint64()
		start := offset + 32
		if int(start+length) > len(data) {
			return nil, fmt.Errorf("length %d exceeds data at offset %d", length, offset)
		}
		return data[start : start+length], nil
	}

	a, err := readBytes(offset1)
	if err != nil {
		return nil, nil, err
	}
	b, err := readBytes(offset2)
	if err != nil {
		return nil, nil, err
	}
	return a, b, nil
}
