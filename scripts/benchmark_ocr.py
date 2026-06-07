#!/usr/bin/env python3
"""Benchmark OCR providers against the local augment-card crop corpus."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from PIL import Image


TESSERACT_PASSES = ((2, "11"), (2, "6"))
CROP_RE = re.compile(r"^region_(.+)_([123])\.png$")
AUGMENT_NAME_FIELDS = ("name", "name_zh_TW", "name_zh_CN", "name_ja", "name_ko")
AUGMENT_OCR_ALIASES = {
    "missing-ping": ["???", "\uff1f\uff1f\uff1f", "Missing Ping", "\u6575\u8ecd\u5931\u53bb\u884c\u8e64", "\u6575\u4eba\u5931\u53bb\u884c\u8e64"],
    "quest-steel-your-heart": ["\u4efb\u52d9:\u92fc\u9435\u96c4\u5fc3", "\u4efb\u52d9\uff1a\u92fc\u9435\u96c4\u5fc3"],
    "ultimate-revolution": ["\u7d42\u6975\u9769\u65b0"],
}

try:
    RESAMPLE_LANCZOS = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE_LANCZOS = Image.LANCZOS


@dataclass
class ProviderResult:
    raw_text: str
    latency_ms: float
    error: Optional[str] = None


@dataclass
class Row:
    crop_path: Path
    screenshot_name: str
    region_key: str
    latency_ms: float
    raw_text: str
    matched_slug: Optional[str]
    expected_slug: Optional[str]
    status: str
    error: Optional[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run OCR on corpus/crops and compare matched augment slugs to ground truth.",
        epilog=(
            "Ground truth values may be augment slugs or localized augment names. "
            "The rapidocr provider is a Phase 1 stub; use tesseract for live measurements."
        ),
    )
    parser.add_argument(
        "--crops-dir",
        default="overlay/corpus/crops",
        type=Path,
        help="Directory containing region_*.png crops. Default: overlay/corpus/crops",
    )
    parser.add_argument(
        "--ground-truth",
        default="overlay/corpus/ground_truth.json",
        type=Path,
        help="Ground-truth JSON file. Default: overlay/corpus/ground_truth.json",
    )
    parser.add_argument(
        "--augments",
        default="public/data/augments.json",
        type=Path,
        help="Augment data used for OCR text to slug matching. Default: public/data/augments.json",
    )
    parser.add_argument(
        "--provider",
        default="tesseract",
        choices=("tesseract", "rapidocr"),
        help="OCR provider to benchmark. Default: tesseract",
    )
    parser.add_argument(
        "--timeout",
        default=15.0,
        type=float,
        help="Per Tesseract pass timeout in seconds. Default: 15",
    )
    return parser.parse_args()


def remove_whitespace(value: str) -> str:
    return re.sub(r"\s+", "", value)


def han_only(value: str) -> str:
    return "".join(char for char in value if "\u4e00" <= char <= "\u9fff")


def is_likely_cjk_ocr_match(raw_text: str, target_name: str) -> bool:
    ocr = han_only(raw_text)
    target = han_only(target_name)
    if len(target) < 4:
        return False
    if target in ocr:
        return True

    window_size = max(3, len(target) - 1)
    if any(
        target[start:start + window_size] in ocr
        for start in range(0, len(target) - window_size + 1)
    ):
        return True

    for window_size in range(max(1, len(target) - 1), min(len(ocr), len(target) + 1) + 1):
        if any(
            levenshtein(ocr[start:start + window_size], target) <= 1
            for start in range(0, len(ocr) - window_size + 1)
        ):
            return True

    return False


def levenshtein(a: str, b: str) -> int:
    rows = len(a) + 1
    cols = len(b) + 1
    dp = [[0] * cols for _ in range(rows)]
    for i in range(rows):
        dp[i][0] = i
    for j in range(cols):
        dp[0][j] = j
    for i in range(1, rows):
        for j in range(1, cols):
            dp[i][j] = dp[i - 1][j - 1] if a[i - 1] == b[j - 1] else 1 + min(
                dp[i - 1][j],
                dp[i][j - 1],
                dp[i - 1][j - 1],
            )
    return dp[-1][-1]


def load_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_lookup(augments_path: Path) -> Tuple[Dict[str, str], Dict[str, str]]:
    data = load_json(augments_path)
    augments = data.get("augments", []) if isinstance(data, dict) else []
    lookup: Dict[str, str] = {}
    slug_by_key: Dict[str, str] = {}

    for augment in augments:
        if not isinstance(augment, dict):
            continue
        slug = augment.get("slug")
        if not isinstance(slug, str) or not slug:
            continue
        slug_by_key[remove_whitespace(slug)] = slug
        for field in AUGMENT_NAME_FIELDS:
            value = augment.get(field)
            if isinstance(value, str) and value:
                lookup[value] = slug
                slug_by_key[remove_whitespace(value)] = slug

    for slug, aliases in AUGMENT_OCR_ALIASES.items():
        slug_by_key[remove_whitespace(slug)] = slug
        for alias in aliases:
            lookup[alias] = slug
            slug_by_key[remove_whitespace(alias)] = slug

    return lookup, slug_by_key


def match_augment(raw_text: str, lookup: Dict[str, str]) -> Optional[str]:
    if not raw_text:
        return None
    cleaned = remove_whitespace(raw_text)

    exact = lookup.get(cleaned)
    if exact:
        return exact

    for name, slug in lookup.items():
        if cleaned in name or name in cleaned:
            return slug
        if is_likely_cjk_ocr_match(cleaned, name):
            return slug

    best_slug: Optional[str] = None
    best_distance: Optional[int] = None
    for name, slug in lookup.items():
        distance = levenshtein(cleaned, name)
        threshold = int((min(len(cleaned), len(name)) * 0.3) + 0.999)
        if distance <= threshold and (best_distance is None or distance < best_distance):
            best_distance = distance
            best_slug = slug

    return best_slug


def expected_slug_for(
    ground_truth: Dict[str, Dict[str, str]],
    slug_by_key: Dict[str, str],
    lookup: Dict[str, str],
    screenshot_name: str,
    region_key: str,
) -> Optional[str]:
    expected = ground_truth.get(screenshot_name, {}).get(region_key, "")
    if not expected:
        return None
    key = remove_whitespace(expected)
    if key in slug_by_key:
        return slug_by_key[key]
    return match_augment(expected, lookup)


def tesseract_pass(crop_path: Path, scale: int, psm: str, timeout: float) -> str:
    with tempfile.TemporaryDirectory(prefix="mayhem_ocr_") as tmpdir:
        tmp_path = Path(tmpdir) / f"{crop_path.stem}_{scale}x_psm{psm}.png"
        with Image.open(crop_path) as image:
            rgba = image.convert("RGBA")
            width, height = rgba.size
            resized = rgba.resize((max(1, width * scale), max(1, height * scale)), RESAMPLE_LANCZOS)
            resized.save(tmp_path)

        output = subprocess.run(
            ["tesseract", str(tmp_path), "stdout", "-l", "chi_tra", "--oem", "1", "--psm", psm],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    if output.returncode != 0:
        stderr = output.stderr.strip() or "no diagnostic output"
        raise RuntimeError(f"tesseract psm {psm} failed: {stderr}")

    return output.stdout.strip().replace(" ", "").replace("\n", "")


def run_tesseract(crop_path: Path, timeout: float) -> ProviderResult:
    started = time.perf_counter()
    texts: List[str] = []
    errors: List[str] = []

    with ThreadPoolExecutor(max_workers=len(TESSERACT_PASSES)) as executor:
        futures = [
            (scale, psm, executor.submit(tesseract_pass, crop_path, scale, psm, timeout))
            for scale, psm in TESSERACT_PASSES
        ]

    for scale, psm, future in futures:
        try:
            text = future.result()
            if text and text not in texts:
                texts.append(text)
        except Exception as exc:  # noqa: BLE001 - benchmark should report provider failures.
            errors.append(f"{scale}x/psm{psm}: {exc}")

    latency_ms = (time.perf_counter() - started) * 1000
    return ProviderResult("".join(texts), latency_ms, "; ".join(errors) or None)


def run_provider(provider: str, crop_path: Path, timeout: float) -> ProviderResult:
    if provider == "tesseract":
        return run_tesseract(crop_path, timeout)

    started = time.perf_counter()
    return ProviderResult(
        raw_text="",
        latency_ms=(time.perf_counter() - started) * 1000,
        error="rapidocr provider stub: not implemented in Phase 1",
    )


def crop_files(crops_dir: Path) -> Iterable[Path]:
    if not crops_dir.exists():
        return []
    return sorted(crops_dir.glob("region_*.png"))


def crop_identity(crop_path: Path) -> Optional[Tuple[str, str]]:
    match = CROP_RE.match(crop_path.name)
    if not match:
        return None
    screenshot_name, region_index = match.groups()
    return screenshot_name, f"region_{region_index}"


def benchmark(args: argparse.Namespace) -> List[Row]:
    ground_truth_raw = load_json(args.ground_truth) if args.ground_truth.exists() else {}
    if not isinstance(ground_truth_raw, dict):
        raise ValueError(f"{args.ground_truth} must contain a JSON object")
    ground_truth = ground_truth_raw
    lookup, slug_by_key = build_lookup(args.augments)

    rows: List[Row] = []
    for crop_path in crop_files(args.crops_dir):
        identity = crop_identity(crop_path)
        if identity is None:
            continue
        screenshot_name, region_key = identity
        result = run_provider(args.provider, crop_path, args.timeout)
        matched_slug = match_augment(result.raw_text, lookup)
        expected_slug = expected_slug_for(
            ground_truth,
            slug_by_key,
            lookup,
            screenshot_name,
            region_key,
        )

        if expected_slug is None:
            status = "unlabeled"
        elif matched_slug == expected_slug:
            status = "correct"
        else:
            status = "incorrect"

        rows.append(Row(
            crop_path=crop_path,
            screenshot_name=screenshot_name,
            region_key=region_key,
            latency_ms=result.latency_ms,
            raw_text=result.raw_text,
            matched_slug=matched_slug,
            expected_slug=expected_slug,
            status=status,
            error=result.error,
        ))

    return rows


def print_report(rows: List[Row]) -> None:
    print("crop\tlatency_ms\traw_ocr\tmatched_slug\texpected_slug\tstatus\terror")
    for row in rows:
        print(
            "\t".join([
                row.crop_path.name,
                f"{row.latency_ms:.1f}",
                row.raw_text or "<empty>",
                row.matched_slug or "<unmatched>",
                row.expected_slug or "<unlabeled>",
                row.status,
                row.error or "",
            ])
        )

    labeled = [row for row in rows if row.status != "unlabeled"]
    correct = sum(1 for row in labeled if row.status == "correct")
    failures = sum(1 for row in rows if row.error or row.matched_slug is None)
    avg_latency = sum(row.latency_ms for row in rows) / len(rows) if rows else 0.0
    accuracy = (correct / len(labeled) * 100) if labeled else 0.0

    print()
    print(f"Summary: accuracy={accuracy:.1f}% ({correct}/{len(labeled)} labeled)")
    print(f"Summary: avg_latency_ms={avg_latency:.1f}")
    print(f"Summary: failure_count={failures}")


def main() -> int:
    args = parse_args()
    rows = benchmark(args)
    print_report(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
