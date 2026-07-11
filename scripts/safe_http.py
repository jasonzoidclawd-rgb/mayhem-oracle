"""Bounded, fail-closed reads for remote pipeline payloads."""

from __future__ import annotations

from typing import Any


MAX_RESPONSE_BYTES = 128 * 1024 * 1024
READ_CHUNK_BYTES = 1024 * 1024


class ResponseLimitError(ValueError):
    """Raised when an upstream response exceeds the pipeline safety limit."""


def read_limited_response(response: Any, *, max_bytes: int = MAX_RESPONSE_BYTES) -> bytes:
    """Read a response without allowing an unbounded allocation."""
    if max_bytes <= 0:
        raise ValueError("max_bytes must be positive")

    declared = response.headers.get("Content-Length") if hasattr(response, "headers") else None
    if declared is not None:
        try:
            declared_size = int(declared)
        except (TypeError, ValueError) as exc:
            raise ResponseLimitError("response has an invalid Content-Length") from exc
        if declared_size > max_bytes:
            raise ResponseLimitError(
                f"response exceeds {max_bytes} byte safety limit ({declared_size} declared)",
            )

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ResponseLimitError(
                f"response exceeds {max_bytes} byte safety limit ({total} read)",
            )
        chunks.append(chunk)
    return b"".join(chunks)
