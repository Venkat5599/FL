"""Tests for ABI encoding/decoding."""

import unittest

from app.abi import abi_encode_two, abi_decode_two


class TestAbiEncodeTwoRoundTrip(unittest.TestCase):
    def test_basic(self) -> None:
        a = b"hello world"
        b_data = bytes([0xDE, 0xAD, 0xBE, 0xEF])
        encoded = abi_encode_two(a, b_data)
        decoded_a, decoded_b = abi_decode_two(encoded)
        self.assertEqual(a, decoded_a)
        self.assertEqual(b_data, decoded_b)

    def test_empty(self) -> None:
        encoded = abi_encode_two(b"", b"")
        decoded_a, decoded_b = abi_decode_two(encoded)
        self.assertEqual(decoded_a, b"")
        self.assertEqual(decoded_b, b"")

    def test_exact_32(self) -> None:
        a = bytes(range(32))
        b_data = bytes([0xFF])
        encoded = abi_encode_two(a, b_data)
        decoded_a, decoded_b = abi_decode_two(encoded)
        self.assertEqual(a, decoded_a)
        self.assertEqual(b_data, decoded_b)

    def test_too_short(self) -> None:
        with self.assertRaises(Exception):
            abi_decode_two(b"\x00" * 10)


if __name__ == "__main__":
    unittest.main()
