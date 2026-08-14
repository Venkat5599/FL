"""Tests for encoding utilities."""

import unittest

from base.encoding import hex_to_bytes, bytes_to_hex


class TestHexToBytes(unittest.TestCase):
    def test_with_prefix(self) -> None:
        self.assertEqual(hex_to_bytes("0xdeadbeef"), bytes([0xDE, 0xAD, 0xBE, 0xEF]))

    def test_without_prefix(self) -> None:
        self.assertEqual(hex_to_bytes("abcd"), bytes([0xAB, 0xCD]))

    def test_empty(self) -> None:
        self.assertEqual(hex_to_bytes(""), b"")

    def test_only_prefix(self) -> None:
        self.assertEqual(hex_to_bytes("0x"), b"")


class TestBytesToHex(unittest.TestCase):
    def test_basic(self) -> None:
        self.assertEqual(bytes_to_hex(bytes([0xDE, 0xAD])), "0xdead")


if __name__ == "__main__":
    unittest.main()
