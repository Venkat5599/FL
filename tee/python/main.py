"""Entry point for the TEE extension server."""

import logging
import os
import sys

# Add the parent directory to the path so we can import the extension package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from base.server import Server
from app.config import VERSION
from app.handlers import register, report_state, set_sign_port


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    ext_port = os.environ.get("EXTENSION_PORT", "8080")
    sign_port = os.environ.get("SIGN_PORT", "9090")

    set_sign_port(sign_port)
    srv = Server(ext_port, sign_port, VERSION, register, report_state)
    srv.listen_and_serve()


if __name__ == "__main__":
    main()
