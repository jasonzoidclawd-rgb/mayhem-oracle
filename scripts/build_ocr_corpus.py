#!/usr/bin/env python3
"""Build OCR card-name crops from full-screen ARAM Mayhem screenshots.

Ground truth format:
{
  "screenshot_filename.png": {
    "region_1": "augment_slug_or_name_zh_TW",
    "region_2": "augment_slug_or_name_zh_TW",
    "region_3": "augment_slug_or_name_zh_TW"
  }
}
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Iterable, Tuple

from PIL import Image, ImageDraw


CARD_NAME_REGIONS = (
    (0.219, 0.347, 0.172, 0.083),
    (0.414, 0.347, 0.172, 0.083),
    (0.609, 0.347, 0.172, 0.083),
)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crop the three current Mayhem augment title regions from full screenshots.",
        epilog=(
            "Put screenshots in overlay/corpus/screenshots/. After this script creates "
            "overlay/corpus/ground_truth.json entries, fill each region with an augment "
            "slug or localized name before running scripts/benchmark_ocr.py."
        ),
    )
    parser.add_argument(
        "--input-dir",
        default="overlay/corpus/screenshots",
        type=Path,
        help="Directory containing full-screen screenshots. Default: overlay/corpus/screenshots",
    )
    parser.add_argument(
        "--output-dir",
        default="overlay/corpus/crops",
        type=Path,
        help="Directory for region crops and optional annotations. Default: overlay/corpus/crops",
    )
    parser.add_argument(
        "--ground-truth",
        default="overlay/corpus/ground_truth.json",
        type=Path,
        help="Ground-truth JSON file to create/update. Default: overlay/corpus/ground_truth.json",
    )
    parser.add_argument(
        "--annotate",
        action="store_true",
        help="Also save full screenshots with red boxes around the crop regions.",
    )
    return parser.parse_args()


def image_files(input_dir: Path) -> Iterable[Path]:
    if not input_dir.exists():
        return []
    return sorted(
        path for path in input_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def region_pixels(
    image_width: int,
    image_height: int,
    region: Tuple[float, float, float, float],
) -> Tuple[int, int, int, int]:
    x, y, width, height = region
    px = int(x * image_width)
    py = int(y * image_height)
    pw = int(width * image_width)
    ph = int(height * image_height)
    return px, py, pw, ph


def load_ground_truth(path: Path) -> Dict[str, Dict[str, str]]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def write_ground_truth(path: Path, data: Dict[str, Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def update_ground_truth_template(
    ground_truth: Dict[str, Dict[str, str]],
    screenshot_name: str,
) -> None:
    entry = ground_truth.setdefault(screenshot_name, {})
    for index in range(1, len(CARD_NAME_REGIONS) + 1):
        entry.setdefault(f"region_{index}", "")


def crop_screenshot(
    screenshot_path: Path,
    output_dir: Path,
    annotate: bool,
) -> int:
    with Image.open(screenshot_path) as image:
        rgba = image.convert("RGBA")
        width, height = rgba.size
        annotated = rgba.copy() if annotate else None
        draw = ImageDraw.Draw(annotated) if annotated is not None else None

        for index, region in enumerate(CARD_NAME_REGIONS, start=1):
            px, py, pw, ph = region_pixels(width, height, region)
            crop = rgba.crop((px, py, px + pw, py + ph))
            crop_path = output_dir / f"region_{screenshot_path.name}_{index}.png"
            crop.save(crop_path)

            if draw is not None:
                for offset in range(2):
                    draw.rectangle(
                        (px + offset, py + offset, px + pw - 1 - offset, py + ph - 1 - offset),
                        outline=(255, 0, 0, 255),
                    )

        if annotated is not None:
            annotated.save(output_dir / f"annotated_{screenshot_path.name}.png")

    return len(CARD_NAME_REGIONS)


def main() -> int:
    args = parse_args()
    args.input_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    screenshots = list(image_files(args.input_dir))
    ground_truth = load_ground_truth(args.ground_truth)
    crop_count = 0

    for screenshot_path in screenshots:
        update_ground_truth_template(ground_truth, screenshot_path.name)
        crop_count += crop_screenshot(screenshot_path, args.output_dir, args.annotate)

    write_ground_truth(args.ground_truth, ground_truth)
    print(
        f"Processed {len(screenshots)} screenshots, wrote {crop_count} crops to {args.output_dir}."
    )
    print(f"Fill empty values in {args.ground_truth} before benchmarking.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
