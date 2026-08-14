// Package types contains types that could be useful to other apps when interacting with the sign extension.
package types

import "github.com/ethereum/go-ethereum/common"

// State holds the extension's observable state, returned by GET /state.
//
// HasKey reports whether the TEE currently holds a private key (set by the
// most recent successful UPDATE_KEY instruction). The actual key material is
// never exposed.
type State struct {
	HasKey bool `json:"hasKey"`
}

// --- DO NOT MODIFY below this line. ---

// StateResponse is the envelope returned by GET /state.
type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
