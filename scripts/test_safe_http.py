#!/usr/bin/env python3

from __future__ import annotations

import unittest

from safe_http import ResponseLimitError, read_limited_response


class FakeResponse:
    def __init__(self, payload: bytes, content_length: str | None = None):
        self.payload = payload
        self.offset = 0
        self.headers = {}
        if content_length is not None:
            self.headers["Content-Length"] = content_length

    def read(self, size: int) -> bytes:
        chunk = self.payload[self.offset:self.offset + size]
        self.offset += len(chunk)
        return chunk


class SafeHttpTests(unittest.TestCase):
    def test_reads_bounded_payload_in_chunks(self):
        self.assertEqual(read_limited_response(FakeResponse(b"payload"), max_bytes=16), b"payload")

    def test_rejects_declared_oversize_before_reading(self):
        response = FakeResponse(b"ignored", content_length="17")
        with self.assertRaisesRegex(ResponseLimitError, "safety limit"):
            read_limited_response(response, max_bytes=16)
        self.assertEqual(response.offset, 0)

    def test_rejects_streamed_oversize(self):
        with self.assertRaisesRegex(ResponseLimitError, "safety limit"):
            read_limited_response(FakeResponse(b"0123456789"), max_bytes=8)


if __name__ == "__main__":
    unittest.main()
