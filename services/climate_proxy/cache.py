"""Supabase 캐시 (옵션). 환경변수 없으면 로컬 파일 캐시로 폴백."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

try:
    from supabase import Client, create_client
except ImportError:
    Client = None  # type: ignore
    create_client = None  # type: ignore


CACHE_DIR = Path(__file__).resolve().parent / ".file_cache"
CACHE_DIR.mkdir(exist_ok=True)


class BundleCache:
    def __init__(self) -> None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        self.client: Client | None = None
        if url and key and create_client is not None:
            try:
                self.client = create_client(url, key)
            except Exception:
                self.client = None
        self.mode = "supabase" if self.client else "file"

    def get(self, grid_key: str) -> dict[str, Any] | None:
        if self.client is not None:
            try:
                resp = (
                    self.client.table("bundle_cache")
                    .select("bundle, panels_geojson, unq_id, source, computed_at")
                    .eq("grid_key", grid_key)
                    .limit(1)
                    .execute()
                )
                rows = resp.data or []
                if rows:
                    row = rows[0]
                    return {
                        "bundle": row["bundle"],
                        "panels_geojson": row["panels_geojson"],
                        "_meta": {
                            "unq_id": row.get("unq_id"),
                            "source": row.get("source"),
                            "computed_at": row.get("computed_at"),
                        },
                    }
                return None
            except Exception:
                return None

        path = CACHE_DIR / f"{grid_key}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def set(
        self,
        grid_key: str,
        bundle: dict[str, Any],
        panels_geojson: dict[str, Any],
        source: str = "live",
    ) -> None:
        unq_id = (bundle.get("meta") or {}).get("unq_id")
        if self.client is not None:
            try:
                self.client.table("bundle_cache").upsert(
                    {
                        "grid_key": grid_key,
                        "unq_id": unq_id,
                        "bundle": bundle,
                        "panels_geojson": panels_geojson,
                        "source": source,
                    },
                    on_conflict="grid_key",
                ).execute()
                return
            except Exception:
                pass

        payload = {
            "bundle": bundle,
            "panels_geojson": panels_geojson,
            "_meta": {"unq_id": unq_id, "source": source},
        }
        (CACHE_DIR / f"{grid_key}.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
