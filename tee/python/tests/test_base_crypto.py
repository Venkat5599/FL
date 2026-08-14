"""Tests for base cryptographic utilities."""

import unittest

from base.crypto import keccak256
from base.encoding import bytes_to_hex


class TestKeccak256(unittest.TestCase):
    def test_empty(self) -> None:
        h = keccak256(b"")
        expected = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        self.assertEqual(bytes_to_hex(h), "0x" + expected)

    def test_hello(self) -> None:
        h = keccak256(b"hello")
        expected = "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
        self.assertEqual(bytes_to_hex(h), "0x" + expected)


if __name__ == "__main__":
    unittest.main()
