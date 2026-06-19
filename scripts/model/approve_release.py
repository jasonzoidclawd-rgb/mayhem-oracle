#!/usr/bin/env python3
"""Generate manually approved model-release JSON and transactional SQL."""

from __future__ import annotations

import argparse
import json
import tarfile
from pathlib import Path

import sign_model

VALID_STATUSES = {"candidate", "active", "rolled-back"}
RELEASE_FIELDS = (
    "model_version",
    "engine_version",
    "data_version",
    "config_sha256",
    "signature",
    "package_url",
    "status",
    "approved_by",
)


def read_package(package_path: Path, public_key: str) -> tuple[dict, dict]:
    with tarfile.open(package_path, "r:gz") as archive:
        if sorted(archive.getnames()) != ["manifest.json", "model-config.json"]:
            raise ValueError("model package must contain only manifest.json and model-config.json")
        manifest_file = archive.extractfile("manifest.json")
        config_file = archive.extractfile("model-config.json")
        if manifest_file is None or config_file is None:
            raise ValueError("model package is missing manifest or config")
        manifest = json.load(manifest_file)
        config = json.load(config_file)
    if not sign_model.verify_manifest(manifest, config, public_key):
        raise ValueError("model package signature verification failed")
    return manifest, config


def read_releases(path: Path) -> list[dict]:
    releases = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(releases, list):
        raise ValueError("releases snapshot must be a JSON array")
    for release in releases:
        if not isinstance(release, dict):
            raise ValueError("each release snapshot entry must be an object")
        if release.get("status") not in VALID_STATUSES:
            raise ValueError(f"invalid release status for {release.get('model_version')}")
    return releases


def release_by_version(releases: list[dict], version: str) -> dict | None:
    matches = [release for release in releases if release.get("model_version") == version]
    if len(matches) > 1:
        raise ValueError(f"release snapshot has duplicate model version: {version}")
    return matches[0] if matches else None


def active_release(releases: list[dict]) -> dict:
    active = [release for release in releases if release.get("status") == "active"]
    if len(active) != 1:
        raise ValueError("release snapshot must contain exactly one active release")
    return active[0]


def build_payload(
    *,
    manifest: dict,
    releases: list[dict],
    package_url: str,
    approved_by: str,
    rollback: bool,
) -> dict:
    version = manifest["modelVersion"]
    current_active = active_release(releases)
    target = release_by_version(releases, version)
    expected_status = "rolled-back" if rollback else "candidate"
    if target is None or target.get("status") != expected_status:
        raise ValueError(f"{version} must be {expected_status} before approval")
    if current_active.get("model_version") == version:
        raise ValueError(f"{version} is already active")

    previous_active_status = "candidate" if rollback else "rolled-back"
    release = {
        "model_version": version,
        "engine_version": manifest["engineVersion"],
        "data_version": manifest["dataVersion"],
        "config_sha256": manifest["configSha256"],
        "signature": manifest["signature"],
        "package_url": package_url,
        "status": "active",
        "approved_by": approved_by,
    }
    transitions = [
        {
            "model_version": current_active["model_version"],
            "from": "active",
            "to": previous_active_status,
        },
        {"model_version": version, "from": expected_status, "to": "active"},
    ]
    return {"release": release, "transitions": transitions}


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def render_sql(payload: dict) -> str:
    release = payload["release"]
    previous, target = payload["transitions"]
    columns = ", ".join(RELEASE_FIELDS)
    candidate = {**release, "status": target["from"]}
    values = ", ".join(sql_literal(str(candidate[field])) for field in RELEASE_FIELDS)
    updates = ",\n    ".join(
        f"{field} = EXCLUDED.{field}"
        for field in RELEASE_FIELDS[1:]
        if field != "status"
    )
    return f"""BEGIN;
LOCK TABLE model_releases IN EXCLUSIVE MODE;

DO $$
BEGIN
  IF (SELECT count(*) FROM model_releases WHERE status = 'active') <> 1
    OR NOT EXISTS (
    SELECT 1 FROM model_releases
    WHERE model_version = {sql_literal(previous["model_version"])}
      AND status = {sql_literal(previous["from"])}
  ) THEN
    RAISE EXCEPTION 'recorded active model release changed before approval';
  END IF;
END $$;

UPDATE model_releases
SET status = {sql_literal(previous["to"])}
WHERE model_version = {sql_literal(previous["model_version"])}
  AND status = {sql_literal(previous["from"])};

INSERT INTO model_releases ({columns})
VALUES ({values})
ON CONFLICT (model_version) DO UPDATE SET
    {updates};

UPDATE model_releases
SET status = 'active'
WHERE model_version = {sql_literal(target["model_version"])}
  AND status = {sql_literal(target["from"])};

DO $$
BEGIN
  IF (SELECT count(*) FROM model_releases WHERE status = 'active') <> 1 THEN
    RAISE EXCEPTION 'model release approval must leave exactly one active release';
  END IF;
END $$;

COMMIT;
"""


def write_outputs(output_dir: Path, payload: dict) -> tuple[Path, Path]:
    version = payload["release"]["model_version"]
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"model-{version}.json"
    sql_path = output_dir / f"model-{version}.sql"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    sql_path.write_text(render_sql(payload), encoding="utf-8")
    return json_path, sql_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--public-key", type=Path, required=True)
    parser.add_argument("--package-url", required=True)
    parser.add_argument("--approved-by", required=True)
    parser.add_argument("--releases", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--approve", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    if not args.approve:
        parser.error("manual approval required: pass --approve")
    return args


def main() -> None:
    args = parse_args()
    manifest, _config = read_package(
        args.package,
        args.public_key.read_text(encoding="utf-8"),
    )
    payload = build_payload(
        manifest=manifest,
        releases=read_releases(args.releases),
        package_url=args.package_url,
        approved_by=args.approved_by,
        rollback=args.rollback,
    )
    write_outputs(args.output_dir, payload)
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
