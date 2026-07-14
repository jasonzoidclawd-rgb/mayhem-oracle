#!/usr/bin/env python3
"""Fail when the public champion page reaches request-time server helpers."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
ENTRY = SRC / "app" / "[locale]" / "champions" / "[slug]" / "page.tsx"
IMPORT_RE = re.compile(
    r"(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?[\"']([^\"']+)[\"']"
)
FORBIDDEN_IMPORTS = {
    "next/headers",
    "@/lib/entitlements/server",
    "@/lib/supabase/server",
}
FORBIDDEN_SOURCE = {
    "cookies()": re.compile(r"\bcookies\s*\("),
    "headers()": re.compile(r"\bheaders\s*\("),
}


class StaticImportError(RuntimeError):
    pass


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def resolve_local_import(source_file: Path, specifier: str) -> Path | None:
    if specifier.startswith("@/"):
        base = SRC / specifier[2:]
    elif specifier.startswith("."):
        base = source_file.parent / specifier
    else:
        return None
    candidates = [
        base,
        base.with_suffix(".ts"),
        base.with_suffix(".tsx"),
        base / "index.ts",
        base / "index.tsx",
    ]
    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), None)


def verify_static_import_graph(entry: Path = ENTRY) -> dict[str, int]:
    pending = [entry.resolve()]
    visited: set[Path] = set()
    failures: list[str] = []
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        source = current.read_text(encoding="utf-8")
        for label, pattern in FORBIDDEN_SOURCE.items():
            if pattern.search(source):
                failures.append(f"{display_path(current)} invokes {label}")
        for specifier in IMPORT_RE.findall(source):
            if specifier in FORBIDDEN_IMPORTS:
                failures.append(
                    f"{display_path(current)} imports forbidden request helper {specifier}"
                )
            resolved = resolve_local_import(current, specifier)
            if resolved is not None and resolved not in visited:
                pending.append(resolved)
    if failures:
        raise StaticImportError("; ".join(sorted(set(failures))))
    return {"visited_module_count": len(visited), "forbidden_dependency_count": 0}


def main() -> int:
    try:
        summary = verify_static_import_graph()
    except (OSError, StaticImportError) as exc:
        print(f"champion static import invariant FAILED: {exc}")
        return 1
    print(
        "champion static import invariant passed: "
        f"visited_module_count={summary['visited_module_count']}, "
        "forbidden_dependency_count=0"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
