"""Tests for handler functions and server integration."""

import base64
import json
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
from typing import Any

from base.server import Server
from base.types import version_to_hex
from base.encoding import bytes_to_hex, hex_to_bytes
from app.config import VERSION
from app.handlers import register, report_state, set_sign_port, _sign_port
from app.abi import abi_decode_two
import app.handlers as handlers_module


def _string_to_bytes32_hex(s: str) -> str:
    return version_to_hex(s)


def _make_action_body(op_type: str, op_command: str, original_message: str) -> bytes:
    df = {
        "instructionId": "0x0000000000000000000000000000000000000000000000000000000000000001",
        "teeId": "0x0000000000000000000000000000000001",
        "timestamp": 1234567890,
        "opType": op_type,
        "opCommand": op_command,
        "originalMessage": original_message,
    }

    df_json = json.dumps(df).encode("utf-8")
    action = {
        "data": {
            "id": "0x0000000000000000000000000000000000000000000000000000000000000001",
            "type": "instruction",
            "submissionTag": "submit",
            "message": bytes_to_hex(df_json),
        }
    }
    return json.dumps(action).encode("utf-8")


class MockDecryptHandler(BaseHTTPRequestHandler):
    """Mock TEE node /decrypt endpoint."""

    response_bytes: bytes = b""
    fail: bool = False

    def do_POST(self) -> None:
        if self.path == "/decrypt":
            if self.fail:
                self.send_error(500, "decryption error")
                return
            content_length = int(self.headers.get("Content-Length", 0))
            self.rfile.read(content_length)
            response = json.dumps({
                "decryptedMessage": base64.b64encode(self.response_bytes).decode("ascii"),
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        else:
            self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:
        pass


class TestActionKeyUpdateAndSign(unittest.TestCase):
    def setUp(self) -> None:
        # Reset state.
        handlers_module._private_key = None

        priv_key_bytes = (12345).to_bytes(32, "big")

        # Start mock node.
        MockDecryptHandler.response_bytes = priv_key_bytes
        MockDecryptHandler.fail = False
        self.mock_server = HTTPServer(("127.0.0.1", 0), MockDecryptHandler)
        self.mock_port = str(self.mock_server.server_address[1])
        self.mock_thread = threading.Thread(target=self.mock_server.serve_forever)
        self.mock_thread.daemon = True
        self.mock_thread.start()

        set_sign_port(self.mock_port)
        self.srv = Server("0", self.mock_port, VERSION, register, report_state)

    def tearDown(self) -> None:
        self.mock_server.shutdown()
        self.mock_thread.join(timeout=5)
        handlers_module._private_key = None

    def test_update_and_sign(self) -> None:
        # Step 1: Update key.
        update_body = _make_action_body(
            _string_to_bytes32_hex("KEY"),
            _string_to_bytes32_hex("UPDATE"),
            bytes_to_hex(b"encrypteddata"),
        )
        status, resp = self.srv.handle_request_bytes("POST", "/action", update_body)
        self.assertEqual(status, 200)
        self.assertEqual(resp["status"], 1)

        # Step 2: Sign.
        msg_hex = bytes_to_hex(b"hello")
        sign_body = _make_action_body(
            _string_to_bytes32_hex("KEY"),
            _string_to_bytes32_hex("SIGN"),
            msg_hex,
        )
        status, resp = self.srv.handle_request_bytes("POST", "/action", sign_body)
        self.assertEqual(status, 200)
        self.assertEqual(resp["status"], 1)
        self.assertIn("data", resp)

        # Decode ABI.
        data_bytes = hex_to_bytes(resp["data"])
        msg, sig = abi_decode_two(data_bytes)
        self.assertEqual(msg, b"hello")
        self.assertEqual(len(sig), 65)


class TestActionSignWithoutKey(unittest.TestCase):
    def setUp(self) -> None:
        handlers_module._private_key = None
        set_sign_port("9999")
        self.srv = Server("0", "9999", VERSION, register, report_state)

    def test_sign_without_key(self) -> None:
        msg_hex = bytes_to_hex(b"hello")
        body = _make_action_body(
            _string_to_bytes32_hex("KEY"),
            _string_to_bytes32_hex("SIGN"),
            msg_hex,
        )
        status, resp = self.srv.handle_request_bytes("POST", "/action", body)
        self.assertEqual(status, 200)
        self.assertEqual(resp["status"], 0)
        self.assertIn("no private key", resp["log"])


class TestActionUnknownOperation(unittest.TestCase):
    def setUp(self) -> None:
        handlers_module._private_key = None
        set_sign_port("9999")
        self.srv = Server("0", "9999", VERSION, register, report_state)

    def test_unknown_op(self) -> None:
        body = _make_action_body(
            _string_to_bytes32_hex("UNKNOWN"),
            _string_to_bytes32_hex("OP"),
            "0xdeadbeef",
        )
        status, resp = self.srv.handle_request_bytes("POST", "/action", body)
        self.assertEqual(status, 501)


class TestActionUpdateEmptyMessage(unittest.TestCase):
    def setUp(self) -> None:
        handlers_module._private_key = None
        set_sign_port("9999")
        self.srv = Server("0", "9999", VERSION, register, report_state)

    def test_empty_message(self) -> None:
        body = _make_action_body(
            _string_to_bytes32_hex("KEY"),
            _string_to_bytes32_hex("UPDATE"),
            "",
        )
        status, resp = self.srv.handle_request_bytes("POST", "/action", body)
        self.assertEqual(status, 200)
        self.assertEqual(resp["status"], 0)
        self.assertIn("originalMessage is empty", resp["log"])


class TestActionMethodNotAllowed(unittest.TestCase):
    def setUp(self) -> None:
        self.srv = Server("0", "9999", VERSION, register, report_state)

    def test_get_action(self) -> None:
        status, _ = self.srv.handle_request_bytes("GET", "/action", b"")
        self.assertEqual(status, 405)


class TestStateEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        handlers_module._private_key = None
        self.srv = Server("0", "9999", VERSION, register, report_state)

    def test_state(self) -> None:
        status, resp = self.srv.handle_request_bytes("GET", "/state", b"")
        self.assertEqual(status, 200)
        self.assertIn("stateVersion", resp)
        self.assertEqual(resp["state"]["hasKey"], False)

    def test_post_state(self) -> None:
        status, _ = self.srv.handle_request_bytes("POST", "/state", b"")
        self.assertEqual(status, 405)


class TestActionDecryptionFailure(unittest.TestCase):
    def setUp(self) -> None:
        handlers_module._private_key = None

        MockDecryptHandler.fail = True
        self.mock_server = HTTPServer(("127.0.0.1", 0), MockDecryptHandler)
        self.mock_port = str(self.mock_server.server_address[1])
        self.mock_thread = threading.Thread(target=self.mock_server.serve_forever)
        self.mock_thread.daemon = True
        self.mock_thread.start()

        set_sign_port(self.mock_port)
        self.srv = Server("0", self.mock_port, VERSION, register, report_state)

    def tearDown(self) -> None:
        self.mock_server.shutdown()
        self.mock_thread.join(timeout=5)

    def test_decryption_failure(self) -> None:
        body = _make_action_body(
            _string_to_bytes32_hex("KEY"),
            _string_to_bytes32_hex("UPDATE"),
            bytes_to_hex(b"baddata"),
        )
        status, resp = self.srv.handle_request_bytes("POST", "/action", body)
        self.assertEqual(status, 200)
        self.assertEqual(resp["status"], 0)
        self.assertIn("decryption failed", resp["log"])


if __name__ == "__main__":
    unittest.main()
