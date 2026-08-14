package configs

import (
	"crypto/ecdsa"
	"encoding/json"
	"os"

	"github.com/ethereum/go-ethereum/crypto"
)

const (
	ExtensionProxyURL = "http://localhost:6664"
	ChainNodeURL      = "http://127.0.0.1:8545"
)

const (
	AddressesFile            = "../docker/sim_dump/deployed-addresses.json"
	ExtensionProxyConfigFile = "./configs/proxy/extension_proxy.toml"
)

const (
	ExtConfigurationPort = 5501 // port on tee for setting the configurations (proxyURL, initialOwner, extensionID)
	ExtProxyInternalPort = 6663 // internal port for tee to get actions from the queue from the proxy
	ExtensionServerPort  = 7701 // port on the tee that the extension server calls for signing, encrypting, etc.
	ExtensionPort        = 7702 // the port on the extension server that the tee calls to send non system actions
)

var PrvWithFunds, AnotherPrivWithFunds *ecdsa.PrivateKey

func init() {
	var err error
	PrvWithFunds, err = crypto.HexToECDSA("804b01a8c27a65cc694a867be76edae3ccce7a7161cda1f67a8349df696d2207")
	if err != nil {
		panic("cannot read privateKey with funds")
	}
	AnotherPrivWithFunds, err = crypto.HexToECDSA("a6e1741818d41de64c15e04ba0820a9714c254e69790e52324c240d02576d5e5")
	if err != nil {
		panic("cannot read another privateKey with funds")
	}
}

func ReadAddresses[T any](filePath string, dest *T) error {
	file, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	err = json.Unmarshal(file, dest)

	return err
}
