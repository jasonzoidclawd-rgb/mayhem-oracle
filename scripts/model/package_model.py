#!/usr/bin/env python3
"""Build a signed, public-data-free Mayhem Oracle model package."""

from __future__ import annotations

import argparse
import gzip
import io
import json
import re
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import sign_model

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "dist"
SAFE_VERSION = re.compile(r"^[A-Za-z0-9._-]+$")


def load_current_model_config() -> dict:
    script = (
        'import("./src/lib/decision/model-config.ts")'
        ".then(({DEFAULT_MODEL_CONFIG}) => console.log(JSON.stringify(DEFAULT_MODEL_CONFIG)))"
    )
    result = subprocess.run(
        [
            "node",
            "--no-warnings",
            "--experimental-strip-types",
            "--input-type=module",
            "-e",
            script,
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def load_model_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("model config must be a JSON object")
    return config


def _add_bytes(archive: tarfile.TarFile, name: str, contents: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(contents)
    info.mode = 0o644
    info.mtime = 0
    archive.addfile(info, io.BytesIO(contents))


def _write_archive(path: Path, config: dict, manifest: dict) -> None:
    with path.open("wb") as destination:
        with gzip.GzipFile(fileobj=destination, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                _add_bytes(archive, "model-config.json", sign_model.canonical_json_bytes(config))
                manifest_bytes = json.dumps(
                    manifest,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
                _add_bytes(archive, "manifest.json", manifest_bytes)


def build_model_package(
    *,
    config: dict,
    engine_version: str,
    data_version: str,
    created_at: str,
    output_dir: Path,
) -> Path:
    model_version = config.get("modelVersion")
    if not isinstance(model_version, str) or not SAFE_VERSION.fullmatch(model_version):
        raise ValueError("config modelVersion must contain only letters, numbers, dot, dash, or underscore")

    manifest = sign_model.sign_manifest(
        {
            "modelVersion": model_version,
            "engineVersion": engine_version,
            "dataVersion": data_version,
            "createdAt": created_at,
            "configSha256": "",
            "signature": "",
        },
        config,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    package_path = output_dir / f"model-{model_version}.tar.gz"
    _write_archive(package_path, config, manifest)
    return package_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--engine-version", required=True)
    parser.add_argument("--data-version", required=True)
    parser.add_argument(
        "--created-at",
        default=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    package_path = build_model_package(
        config=load_model_config(args.config) if args.config else load_current_model_config(),
        engine_version=args.engine_version,
        data_version=args.data_version,
        created_at=args.created_at,
        output_dir=args.output_dir,
    )
    print(package_path)


if __name__ == "__main__":
    main()
