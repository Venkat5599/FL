"""Infrastructure HTTP server for the TEE extension framework."""

from __future__ import annotations

import json
import logging
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from typing import Optional

from .encoding import hex_to_bytes
from .types import (
    ActionResult,
    Framework,
    RegisterFunc,
    ReportStateFunc,
    StateResponse,
    bytes32_hex_to_string,
    parse_action,
    parse_data_fixed,
    version_to_hex,
)

logger = logging.getLogger(__name__)


class Server:
    """TEE extension HTTP server."""

    def __init__(
        self,
        ext_port: str,
        sign_port: str,
        version: str,
        register: RegisterFunc,
        report_state: ReportStateFunc,
    ) -> None:
        self.ext_port = ext_port
        self.sign_port = sign_port
        self.version = version
        self.version_hex = version_to_hex(version)
        self.framework = Framework()
        self.report_state = report_state
        self.mu = threading.Lock()

        register(self.framework)

        # Create the handler class bound to this server instance.
        server_ref = self

        class RequestHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                if self.path == "/action":
                    server_ref._handle_action(self)
                else:
                    self.send_error(404, "Not Found")

            def do_GET(self) -> None:
                if self.path == "/state":
                    server_ref._handle_state(self)
                else:
                    self.send_error(404, "Not Found")

            def log_message(self, format: str, *args: object) -> None:
                # Suppress default request logging; we log ourselves.
                pass

        self._handler_class = RequestHandler
        self._http_server: Optional[ThreadingHTTPServer] = None

    def listen_and_serve(self) -> None:
        """Start the HTTP server (blocking)."""
        self._http_server = ThreadingHTTPServer(
            ("", int(self.ext_port)), self._handler_class
        )
        logger.info("extension listening on port %s", self.ext_port)
        self._http_server.serve_forever()

    def shutdown(self) -> None:
        """Shutdown the HTTP server."""
        if self._http_server:
            self._http_server.shutdown()

    def handle_request_bytes(self, method: str, path: str, body: bytes) -> tuple[int, object]:
        """Process a request directly (for testing). Returns (status_code, response)."""
        if method == "POST" and path == "/action":
            return self._process_action(body)
        elif method == "GET" and path == "/state":
            return self._process_state()
        elif method == "GET" and path == "/action":
            return 405, {"error": "method not allowed"}
        elif method == "POST" and path == "/state":
            return 405, {"error": "method not allowed"}
        else:
            return 404, {"error": "not found"}

    def _handle_action(self, handler: BaseHTTPRequestHandler) -> None:
        content_length = int(handler.headers.get("Content-Length", 0))
        body = handler.rfile.read(content_length)

        status_code, response = self._process_action(body)
        self._send_json(handler, status_code, response)

    def _handle_state(self, handler: BaseHTTPRequestHandler) -> None:
        status_code, response = self._process_state()
        self._send_json(handler, status_code, response)

    def _process_action(self, body: bytes) -> tuple[int, object]:
        try:
            raw = json.loads(body)
        except (json.JSONDecodeError, ValueError):
            return 400, {"error": "invalid action JSON"}

        try:
            action = parse_action(raw)
        except (KeyError, TypeError) as e:
            return 400, {"error": f"invalid action structure: {e}"}

        try:
            msg_bytes = hex_to_bytes(action.data.message)
        except (ValueError, Exception) as e:
            return 400, {"error": f"invalid hex in message: {e}"}

        try:
            df_raw = json.loads(msg_bytes)
            df = parse_data_fixed(df_raw)
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            return 400, {"error": f"invalid DataFixed JSON in message: {e}"}

        handler = self.framework.lookup(df.op_type, df.op_command)
        if handler is None:
            return 501, "unsupported op type"

        # Serialize handler calls with exclusive lock.
        with self.mu:
            data, status, err = handler(df.original_message)

        result = ActionResult(
            id=action.data.id,
            submission_tag=action.data.submission_tag,
            op_type=df.op_type,
            op_command=df.op_command,
            version=self.version_hex,
            status=status,
            data=data,
        )

        if status == 0:
            result.log = f"error: {err}" if err else "error: unknown"
        elif status == 1:
            result.log = "ok"
        else:
            result.log = "pending"

        logger.info(
            "action %s: opType=%s opCommand=%s status=%d",
            action.data.id,
            bytes32_hex_to_string(df.op_type),
            bytes32_hex_to_string(df.op_command),
            status,
        )

        return 200, result.to_dict()

    def _process_state(self) -> tuple[int, object]:
        with self.mu:
            state_data = self.report_state()

        resp = StateResponse(
            state_version=self.version_hex,
            state=state_data,
        )
        return 200, resp.to_dict()

    def _send_json(self, handler: BaseHTTPRequestHandler, status: int, data: object) -> None:
        if isinstance(data, str):
            body = data.encode("utf-8")
            handler.send_response(status)
            handler.send_header("Content-Type", "text/plain")
            handler.send_header("Content-Length", str(len(body)))
            handler.end_headers()
            handler.wfile.write(body)
        else:
            body = json.dumps(data).encode("utf-8")
            handler.send_response(status)
            handler.send_header("Content-Type", "application/json")
            handler.send_header("Content-Length", str(len(body)))
            handler.end_headers()
            handler.wfile.write(body)
