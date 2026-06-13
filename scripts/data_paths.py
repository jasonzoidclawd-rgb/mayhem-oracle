"""Shared generated-data paths.

Decision-capable generated data defaults to data/internal. MAYHEM_DATA_DIR can
override the destination for isolated pipeline runs.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _data_dir() -> Path:
    configured = os.getenv("MAYHEM_DATA_DIR")
    if not configured:
        return ROOT / "data" / "internal"
    path = Path(configured)
    return path if path.is_absolute() else ROOT / path


INTERNAL_DATA_DIR = _data_dir()
