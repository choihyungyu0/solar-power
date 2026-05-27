"""좌표 → 캐시 키 정규화. 같은 옥상 내 클릭이 같은 키로 떨어지도록 ~5m 격자로 반올림."""
from __future__ import annotations

GRID_DEG_LAT = 5 / 111_320  # 약 5m
GRID_DEG_LON = 5 / 88_800   # 위도 37° 부근 근사


def make_grid_key(longitude: float, latitude: float) -> str:
    """문자열 키. 'lon_lat' 형식, 소수점 5자리(약 1m) 까지 보존하되 5m 단위로 스냅."""
    snapped_lon = round(round(longitude / GRID_DEG_LON) * GRID_DEG_LON, 7)
    snapped_lat = round(round(latitude / GRID_DEG_LAT) * GRID_DEG_LAT, 7)
    return f"{snapped_lon:.7f}_{snapped_lat:.7f}"
