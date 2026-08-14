package extension

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"

	"sign-extension/internal/config"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	"golang.org/x/crypto/sha3"
)

// --- In most cases, you will not need to modify this file. ---

func (e *Extension) actionHandler(w http.ResponseWriter, r *http.Request) {
	var action teetypes.Action
	err := json.NewDecoder(r.Body).Decode(&action)
	if err != nil {
		http.Error(w, fmt.Sprintf("decoding action: %v", err), http.StatusBadRequest)
		return
	}

	logger.Infof("received action, ID: %s", action.Data.ID)

	status, body := e.processAction(action)

	logger.Infof("sending action result, ID: %s, status: %d, log: %s", action.Data.ID, status, getLogFromBody(body))

	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func buildResult(a teetypes.Action, df *instruction.DataFixed, data []byte, status uint8, err error) teetypes.ActionResult {
	ar := teetypes.ActionResult{
		ID:            a.Data.ID,
		SubmissionTag: a.Data.SubmissionTag,
		Version:       config.Version,
		OPType:        df.OPType,
		OPCommand:     df.OPCommand,
		Data:          data,
		Status:        status,
	}
	switch status {
	case 0:
		ar.Log = fmt.Sprintf("error: %v", err)
	case 1:
		ar.Log = "ok"
	}
	return ar
}

func getLogFromBody(body []byte) string {
	var ar teetypes.ActionResult
	if err := json.Unmarshal(body, &ar); err != nil {
		return string(body)
	}
	return ar.Log
}

// --- TEE node /decrypt RPC ---

// decryptRequest mirrors the tee-node's DecryptRequest. EncryptedMessage is
// []byte so JSON-marshals to base64.
type decryptRequest struct {
	EncryptedMessage []byte `json:"encryptedMessage"`
}

type decryptResponse struct {
	DecryptedMessage []byte `json:"decryptedMessage"`
}

// decryptViaNode forwards the ECIES ciphertext to the local tee-node's
// /decrypt endpoint. The TEE node holds the key material and returns the
// plaintext bytes.
func decryptViaNode(signPort int, ciphertext []byte) ([]byte, error) {
	url := fmt.Sprintf("http://localhost:%d/decrypt", signPort)
	reqBody, _ := json.Marshal(decryptRequest{EncryptedMessage: ciphertext})

	resp, err := http.DefaultClient.Post(url, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("request error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("node returned %d: %s", resp.StatusCode, string(b))
	}

	var dr decryptResponse
	if err := json.NewDecoder(resp.Body).Decode(&dr); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return dr.DecryptedMessage, nil
}

// --- secp256k1 + ECDSA ---

func parseSecp256k1PrivateKey(b []byte) (*secp256k1.PrivateKey, error) {
	if len(b) == 0 {
		return nil, fmt.Errorf("key bytes are empty")
	}
	if len(b) > 32 {
		return nil, fmt.Errorf("key too long: %d bytes", len(b))
	}
	key := secp256k1.PrivKeyFromBytes(padLeft(b, 32))
	if key.Key.IsZero() {
		return nil, fmt.Errorf("key is zero")
	}
	return key, nil
}

// signECDSA Keccak256-hashes the message and signs with ECDSA, returning a
// 65-byte Ethereum-style signature [r(32), s(32), v(1)] where v is 27 or 28.
func signECDSA(key *secp256k1.PrivateKey, message []byte) ([]byte, error) {
	hash := keccak256(message)
	// SignCompact returns [recoveryFlag, r(32), s(32)] where recoveryFlag is 27 or 28.
	sig := ecdsa.SignCompact(key, hash, false)
	result := make([]byte, 65)
	copy(result[0:32], sig[1:33])   // r
	copy(result[32:64], sig[33:65]) // s
	result[64] = sig[0]             // v
	return result, nil
}

func keccak256(data []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(data)
	return h.Sum(nil)
}

func padLeft(b []byte, size int) []byte {
	if len(b) >= size {
		return b[len(b)-size:]
	}
	result := make([]byte, size)
	copy(result[size-len(b):], b)
	return result
}

// --- ABI encoding ---

// abiEncodeTwo ABI-encodes two dynamic byte arrays: (bytes, bytes).
func abiEncodeTwo(a, b []byte) ([]byte, error) {
	aPadded := padToMultipleOf32(a)
	bPadded := padToMultipleOf32(b)

	offsetA := big.NewInt(64)
	offsetB := big.NewInt(int64(64 + 32 + len(aPadded)))

	buf := make([]byte, 0, 64+32+len(aPadded)+32+len(bPadded))

	buf = append(buf, padLeft(offsetA.Bytes(), 32)...)
	buf = append(buf, padLeft(offsetB.Bytes(), 32)...)

	buf = append(buf, padLeft(big.NewInt(int64(len(a))).Bytes(), 32)...)
	buf = append(buf, aPadded...)

	buf = append(buf, padLeft(big.NewInt(int64(len(b))).Bytes(), 32)...)
	buf = append(buf, bPadded...)

	return buf, nil
}

func padToMultipleOf32(data []byte) []byte {
	if len(data) == 0 {
		return nil
	}
	remainder := len(data) % 32
	if remainder == 0 {
		result := make([]byte, len(data))
		copy(result, data)
		return result
	}
	padded := make([]byte, len(data)+32-remainder)
	copy(padded, data)
	return padded
}
