#!/usr/bin/env python3
"""Sign and verify Mayhem Oracle model manifests with Ed25519."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

MANIFEST_FIELDS = (
    "modelVersion",
    "engineVersion",
    "dataVersion",
    "createdAt",
    "configSha256",
    "signature",
)
UNSIGNED_MANIFEST_FIELDS = MANIFEST_FIELDS[:-1]


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def config_sha256(config: object) -> str:
    return hashlib.sha256(canonical_json_bytes(config)).hexdigest()


def ordered_manifest(manifest: dict) -> dict:
    if set(manifest) != set(MANIFEST_FIELDS):
        raise ValueError(f"manifest fields must be exactly: {', '.join(MANIFEST_FIELDS)}")
    return {field: manifest[field] for field in MANIFEST_FIELDS}


def canonical_manifest_bytes(manifest: dict) -> bytes:
    ordered = ordered_manifest(manifest)
    unsigned = {field: ordered[field] for field in UNSIGNED_MANIFEST_FIELDS}
    return canonical_json_bytes(unsigned)


def signing_key_from_env() -> str:
    value = os.environ.get("MAYHEM_MODEL_SIGNING_KEY", "").strip()
    if not value:
        raise ValueError("MAYHEM_MODEL_SIGNING_KEY is required")
    if "BEGIN PRIVATE KEY" in value:
        return value + ("\n" if not value.endswith("\n") else "")
    try:
        decoded = base64.b64decode(value, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("MAYHEM_MODEL_SIGNING_KEY must be PEM or base64-encoded PEM") from exc
    if "BEGIN PRIVATE KEY" not in decoded:
        raise ValueError("MAYHEM_MODEL_SIGNING_KEY does not contain a private key")
    return decoded


def resolve_openssl() -> str:
    candidates = [
        "/opt/homebrew/bin/openssl",
        "/usr/local/bin/openssl",
        shutil.which("openssl"),
    ]
    checked = set()
    for candidate in candidates:
        if not candidate or candidate in checked:
            continue
        checked.add(candidate)
        if candidate.startswith("/") and not Path(candidate).is_file():
            continue
        try:
            result = subprocess.run(
                [candidate, "version"],
                check=False,
                capture_output=True,
                text=True,
            )
        except FileNotFoundError:
            continue
        if result.returncode == 0 and result.stdout.startswith("OpenSSL 3."):
            return candidate
    raise RuntimeError("OpenSSL 3.x is required for Ed25519 signing")


def _run_openssl(args: list[str], *, input_bytes: bytes | None = None) -> bytes:
    try:
        result = subprocess.run(
            [resolve_openssl(), *args],
            input=input_bytes,
            check=True,
            capture_output=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("OpenSSL is required for Ed25519 signing") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(detail or "OpenSSL command failed") from exc
    return result.stdout


def public_key_from_private(private_key: str | None = None) -> str:
    key = private_key or signing_key_from_env()
    return _run_openssl(["pkey", "-pubout"], input_bytes=key.encode("utf-8")).decode("utf-8")


def _sign_bytes(data: bytes, private_key: str) -> bytes:
    with tempfile.TemporaryDirectory() as directory:
        key_path = Path(directory) / "private.pem"
        data_path = Path(directory) / "manifest.bin"
        signature_path = Path(directory) / "signature.bin"
        key_path.write_text(private_key, encoding="utf-8")
        key_path.chmod(0o600)
        data_path.write_bytes(data)
        _run_openssl(
            [
                "pkeyutl",
                "-sign",
                "-rawin",
                "-inkey",
                str(key_path),
                "-in",
                str(data_path),
                "-out",
                str(signature_path),
            ]
        )
        return signature_path.read_bytes()


def _verify_bytes(data: bytes, signature: bytes, public_key: str) -> bool:
    with tempfile.TemporaryDirectory() as directory:
        key_path = Path(directory) / "public.pem"
        data_path = Path(directory) / "manifest.bin"
        signature_path = Path(directory) / "signature.bin"
        key_path.write_text(public_key, encoding="utf-8")
        data_path.write_bytes(data)
        signature_path.write_bytes(signature)
        try:
            _run_openssl(
                [
                    "pkeyutl",
                    "-verify",
                    "-rawin",
                    "-pubin",
                    "-inkey",
                    str(key_path),
                    "-in",
                    str(data_path),
                    "-sigfile",
                    str(signature_path),
                ]
            )
        except ValueError:
            return False
    return True


def sign_manifest(manifest: dict, config: object) -> dict:
    signed = ordered_manifest(manifest)
    signed["configSha256"] = config_sha256(config)
    signed["signature"] = ""
    signature = _sign_bytes(canonical_manifest_bytes(signed), signing_key_from_env())
    signed["signature"] = base64.b64encode(signature).decode("ascii")
    return signed


def verify_manifest(manifest: dict, config: object, public_key: str) -> bool:
    try:
        ordered = ordered_manifest(manifest)
        if ordered["configSha256"] != config_sha256(config):
            return False
        signature = base64.b64decode(ordered["signature"], validate=True)
        return _verify_bytes(canonical_manifest_bytes(ordered), signature, public_key)
    except (ValueError, TypeError):
        return False


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    sign = subparsers.add_parser("sign", help="sign a manifest and bind it to a config")
    sign.add_argument("--manifest", type=Path, required=True)
    sign.add_argument("--config", type=Path, required=True)
    sign.add_argument("--output", type=Path, required=True)

    verify = subparsers.add_parser("verify", help="verify a manifest and config")
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--config", type=Path, required=True)
    verify.add_argument("--public-key", type=Path, required=True)

    subparsers.add_parser("public-key", help="print the public key for the configured secret")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.command == "public-key":
        print(public_key_from_private(), end="")
        return
    if args.command == "sign":
        signed = sign_manifest(read_json(args.manifest), read_json(args.config))
        write_json(args.output, signed)
        print(args.output)
        return

    valid = verify_manifest(
        read_json(args.manifest),
        read_json(args.config),
        args.public_key.read_text(encoding="utf-8"),
    )
    print("valid" if valid else "invalid")
    raise SystemExit(0 if valid else 1)


if __name__ == "__main__":
    main()
