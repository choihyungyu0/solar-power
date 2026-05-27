"""scripts/poc_rooftop_pipeline.py 재export.

분석가가 알고리즘을 수정하면 본 서비스가 즉시 반영. 별도 fork 금지.
"""
from __future__ import annotations

import sys
from pathlib import Path

_scripts_dir = Path(__file__).resolve().parents[2] / "scripts"
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

from poc_rooftop_pipeline import (  # noqa: E402  (sys.path 조작 후 import)
    PipelineResult,
    result_to_bundle,
    run_pipeline,
)

__all__ = ["PipelineResult", "result_to_bundle", "run_pipeline"]
