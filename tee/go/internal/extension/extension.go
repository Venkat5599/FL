package extension

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"sign-extension/internal/config"
	"sign-extension/pkg/types"

	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/flare-foundation/tee-node/pkg/processorutils"

	secp256k1 "github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// Extension holds mutable state for the sign extension. Access is serialized
// by the mutex; the framework dispatches actions serially anyway, but the
// state read in stateHandler is concurrent with action processing.
type Extension struct {
	mu     sync.RWMutex
	Server *http.Server

	// signPort is the TEE node's /decrypt endpoint port, used by handleKeyUpdate.
	signPort int

	// privateKey is the secp256k1 private key delivered via UPDATE_KEY. May be nil
	// before the first successful UPDATE_KEY instruction.
	privateKey *secp256k1.PrivateKey
}

// --- DO NOT MODIFY: New(), actionHandler() are boilerplate.
func New(extensionPort, signPort int) *Extension {
	e := &Extension{signPort: signPort}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)

	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

// stateHandler reports whether a key is stored, without exposing the key.
func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	e.mu.RLock()
	stateResponse := types.StateResponse{
		StateVersion: teeutils.ToHash(config.Version),
		State: types.State{
			HasKey: e.privateKey != nil,
		},
	}
	e.mu.RUnlock()

	err := json.NewEncoder(w).Encode(stateResponse)
	if err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
		return
	}
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}

	switch {
	case dataFixed.OPType == teeutils.ToHash(config.OPTypeKey):
		return e.processKey(action, dataFixed)

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op type: received %s, expected %s (%s)",
			dataFixed.OPType.Hex(), teeutils.ToHash(config.OPTypeKey).Hex(), config.OPTypeKey,
		))
	}
}

// processKey routes KEY instructions by OPCommand (UPDATE or SIGN).
func (e *Extension) processKey(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	switch {
	case df.OPCommand == teeutils.ToHash(config.OPCommandUpdate):
		ar := e.processKeyUpdate(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	case df.OPCommand == teeutils.ToHash(config.OPCommandSign):
		ar := e.processKeySign(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op command: received %s, expected one of [%s (%s), %s (%s)]",
			df.OPCommand.Hex(),
			teeutils.ToHash(config.OPCommandUpdate).Hex(), config.OPCommandUpdate,
			teeutils.ToHash(config.OPCommandSign).Hex(), config.OPCommandSign,
		))
	}
}

// processKeyUpdate decrypts the original message via the TEE node and stores
// the resulting bytes as a secp256k1 private key.
func (e *Extension) processKeyUpdate(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if len(df.OriginalMessage) == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("originalMessage is empty"))
	}

	keyBytes, err := decryptViaNode(e.signPort, df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decryption failed: %v", err))
	}

	privKey, err := parseSecp256k1PrivateKey(keyBytes)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("invalid private key: %v", err))
	}

	e.mu.Lock()
	e.privateKey = privKey
	e.mu.Unlock()

	return buildResult(action, df, nil, 1, nil)
}

// processKeySign signs the original message with the stored private key.
// Returns ABI-encoded (bytes message, bytes signature) in ActionResult.Data.
func (e *Extension) processKeySign(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	e.mu.RLock()
	key := e.privateKey
	e.mu.RUnlock()

	if key == nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("no private key stored"))
	}
	if len(df.OriginalMessage) == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("originalMessage is empty"))
	}

	sig, err := signECDSA(key, df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("signing failed: %v", err))
	}

	encoded, err := abiEncodeTwo(df.OriginalMessage, sig)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("ABI encoding failed: %v", err))
	}

	return buildResult(action, df, encoded, 1, nil)
}
