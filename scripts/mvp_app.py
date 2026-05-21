"""
화성시 옥상 태양광 MVP 검증 앱.

실행:
  pip install streamlit streamlit-folium folium httpx pandas
  cd C:\\Users\\Administrator\\Desktop\\solar-power
  streamlit run scripts/mvp_app.py

기능:
- 화성 행정동 선택 -> 정제된 건물 폴리곤을 folium 지도에 표시
- 폴리곤 클릭 -> properties.bld_id 기준 확인 -> 경기기후플랫폼 PV API 호출 -> 결과 카드
- 사이드바: 패널 사양, 각도, 활용계수, shading 조정

주의:
- 이 파일은 GIS/API 검증용 보조 스크립트입니다.
- 현재 제품 MVP의 활성 화면은 React + TypeScript + Supabase 기반 apps/web입니다.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import folium
import httpx
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "data" / "processed" / "hwaseong_buildings_v1_by_admdong"
LEGACY_DATA_DIR = ROOT / "data" / "processed" / "mvp" / "by_admdong"
DATA_DIR = DEFAULT_DATA_DIR if DEFAULT_DATA_DIR.exists() else LEGACY_DATA_DIR
INDEX_FP = DATA_DIR / "index.json"
PV_API = "https://climate.gg.go.kr/spsvc/pv/analysis"

PANEL_AREA_M2 = {500: 1.038 * 2.228, 640: 2.465 * 1.134}


def _index_rows(index_payload: Any) -> list[dict[str, Any]]:
    if isinstance(index_payload, dict) and isinstance(index_payload.get("files"), list):
        return index_payload["files"]
    if isinstance(index_payload, list):
        return index_payload
    return []


def _feature_area(props: dict[str, Any]) -> float:
    for key in ("effective_area_m2", "building_area_m2", "total_floor_area_m2", "site_area_m2"):
        value = props.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return 0.0


def _polygon_centroid(feature: dict[str, Any]) -> tuple[float | None, float | None]:
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    geometry_type = geometry.get("type")

    if geometry_type == "Polygon" and coordinates:
        ring = coordinates[0]
    elif geometry_type == "MultiPolygon" and coordinates and coordinates[0]:
        ring = coordinates[0][0]
    else:
        return None, None

    points = [point for point in ring if isinstance(point, list) and len(point) >= 2]
    if not points:
        return None, None

    lng = sum(float(point[0]) for point in points) / len(points)
    lat = sum(float(point[1]) for point in points) / len(points)
    return lat, lng


def _prepare_feature(feature: dict[str, Any], capacity: int) -> dict[str, Any]:
    props = feature.setdefault("properties", {})
    effective_area = _feature_area(props)
    lat, lng = _polygon_centroid(feature)

    props["effective_area_m2"] = round(effective_area, 1)
    props["centroid_lat"] = props.get("centroid_lat") or lat
    props["centroid_lng"] = props.get("centroid_lng") or lng
    props[f"panel_count_{capacity}w"] = max(2, int(effective_area * 0.5 / PANEL_AREA_M2[capacity]))
    props["usage_name"] = props.get("usage_name") or "미상"
    props["address"] = props.get("address") or "(주소 없음)"
    props["floors_above"] = props.get("floors_above") or "-"
    return feature


@st.cache_data
def load_index() -> list[dict[str, Any]]:
    with open(INDEX_FP, "r", encoding="utf-8") as file:
        return _index_rows(json.load(file))


@st.cache_data
def load_admdong_geojson(filename: str) -> dict[str, Any]:
    with open(DATA_DIR / filename, "r", encoding="utf-8") as file:
        return json.load(file)


@st.cache_data(show_spinner=False)
def call_pv_api(lat: float, lng: float, shading: float, angle: int, capacity: int, count: int, panel_type: int = 1) -> dict[str, Any]:
    payload = {
        "latitude": lat,
        "longitude": lng,
        "shading_index_average": shading,
        "solar_panel_angle": angle,
        "solar_panel_info": {
            "panel_capacity": capacity,
            "panel_count": count,
            "panel_type": panel_type,
        },
    }
    response = httpx.post(
        PV_API,
        json=payload,
        headers={
            "Content-Type": "application/json; charset=UTF-8",
            "User-Agent": "solarmate-mvp/0.1",
        },
        timeout=15.0,
    )
    response.raise_for_status()
    return response.json()


st.set_page_config(page_title="솔라메이트 - 화성 MVP", layout="wide")
st.title("솔라메이트 - 화성 옥상 PV MVP")
st.caption("정제된 화성 GIS 건물정보로 경기기후플랫폼 시뮬레이션 API를 검증합니다.")

if not INDEX_FP.exists():
    st.error(f"index.json을 찾을 수 없습니다: {INDEX_FP}")
    st.stop()

idx_df = pd.DataFrame(load_index()).sort_values("feature_count", ascending=False)

with st.sidebar:
    st.header("시뮬레이션 옵션")
    capacity = st.radio("패널 사양", [500, 640], format_func=lambda value: f"{value}W", horizontal=True)
    angle = st.radio("경사각", [30, 35], format_func=lambda value: f"{value}°", horizontal=True)
    shading = st.slider("음영지수", 1.0, 5.0, 3.5, 0.1)
    util = st.slider("옥상 활용계수", 0.2, 0.8, 0.5, 0.05)
    st.divider()
    st.subheader("행정동 선택")
    admdong = st.selectbox(
        "동",
        idx_df["admdong_name"].tolist(),
        format_func=lambda name: f"{name} ({idx_df.loc[idx_df.admdong_name == name, 'feature_count'].iloc[0]:,}건)",
    )
    max_features = st.slider("최대 표시 건물 수", 50, 1500, 400, 50, help="많이 그리면 지도가 무거워집니다.")
    show_area_label = st.checkbox("툴팁에 면적 표시", value=True)

row = idx_df.loc[idx_df.admdong_name == admdong].iloc[0]
geojson = load_admdong_geojson(row["file"])
bbox = row["bbox"]
center = [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2]

features = sorted(
    (_prepare_feature(feature, capacity) for feature in geojson["features"]),
    key=lambda feature: -float(feature["properties"]["effective_area_m2"]),
)[:max_features]

map_obj = folium.Map(location=center, zoom_start=15, tiles="CartoDB Positron")


def style_fn(_: Any) -> dict[str, Any]:
    return {"color": "#1f77b4", "weight": 1, "fillColor": "#1f77b4", "fillOpacity": 0.3}


def highlight_fn(_: Any) -> dict[str, Any]:
    return {"color": "#d62728", "weight": 2, "fillColor": "#d62728", "fillOpacity": 0.5}


fields = ["bld_id", "address", "usage_name", "effective_area_m2", f"panel_count_{capacity}w", "floors_above"]
aliases = ["ID", "주소", "용도", "면적(㎡)", f"추정패널수({capacity}W)", "지상층"]

folium.GeoJson(
    {"type": "FeatureCollection", "features": features},
    name="buildings",
    style_function=style_fn,
    highlight_function=highlight_fn,
    tooltip=folium.GeoJsonTooltip(fields=fields, aliases=aliases, localize=True) if show_area_label else None,
    popup=folium.GeoJsonPopup(fields=fields, aliases=aliases, localize=True, max_width=400),
).add_to(map_obj)

col_map, col_result = st.columns([3, 2])
with col_map:
    st.markdown(f"**{admdong}** - 표시 {len(features):,} / 전체 {row['feature_count']:,}건 (면적 큰 순)")
    map_state = st_folium(map_obj, height=620, width=None, returned_objects=["last_object_clicked", "last_active_drawing"])

with col_result:
    st.subheader("시뮬레이션 결과")
    clicked = map_state.get("last_active_drawing") or map_state.get("last_object_clicked")
    props = clicked.get("properties") if isinstance(clicked, dict) else None

    if props:
        eff_area = float(props.get("effective_area_m2") or 0)
        panel_count = max(2, int(eff_area * util / PANEL_AREA_M2[capacity]))
        lat = props.get("centroid_lat")
        lng = props.get("centroid_lng")

        st.markdown(f"**주소** {props.get('address') or '(미상)'}")
        c1, c2, c3 = st.columns(3)
        c1.metric("면적", f"{eff_area:,.0f} ㎡")
        c2.metric("용도", props.get("usage_name") or "미상")
        c3.metric("지상층", str(props.get("floors_above") or "-"))

        if lat is None or lng is None:
            st.error("중심 좌표를 계산할 수 없습니다.")
        else:
            try:
                with st.spinner("시뮬레이션 호출 중..."):
                    response_payload = call_pv_api(float(lat), float(lng), shading, angle, capacity, panel_count)
                data = response_payload["data"]
                expected_revenue = data["expected_revenue"]
                environmental = data["environmental_contribution"]

                st.success(f"API 응답 OK · 패널 {panel_count}장 ({expected_revenue['install_kw']} kW)")
                m1, m2, m3 = st.columns(3)
                m1.metric("연간 발전량", f"{data['annual_generation']:,.0f} kWh")
                m2.metric("1년차 수익", f"{expected_revenue['first_year_revenue']:,} 원")
                m3.metric("1년차 절감", f"{expected_revenue['first_year_save_cost']:,} 원")
                m4, m5, m6 = st.columns(3)
                m4.metric("설치비", f"{expected_revenue['expected_investment']:,} 원")
                m5.metric("CO2 저감", f"{environmental['carbon_reduction']:,} kg/년")
                m6.metric("소나무 환산", f"{environmental['pine_tree_effect']:,} 그루")

                revenue = pd.DataFrame(data["annual_revenue"]).rename(columns={"revenue": "수익(원)"})
                saving = pd.DataFrame(data["annual_saveCost"]).rename(columns={"saveCost": "절감(원)"})
                monthly = pd.DataFrame(data["monthly_generation"]).rename(columns={"generation": "발전량(kWh)"})

                tab1, tab2, tab3, tab4 = st.tabs(["연차별 수익", "연차별 절감", "월별 발전량", "원본 JSON"])
                tab1.line_chart(revenue.set_index("year"))
                tab2.line_chart(saving.set_index("year"))
                tab3.bar_chart(monthly.set_index("month"))
                tab4.json(response_payload)

                cumulative_revenue = revenue["수익(원)"].cumsum()
                payback = next(
                    (int(year) for year, value in zip(revenue["year"], cumulative_revenue) if value >= expected_revenue["expected_investment"]),
                    None,
                )
                cumulative_10_year = saving["절감(원)"].head(10).sum()
                cumulative_20_year = saving["절감(원)"].sum()
                st.info(
                    f"파생값 · 회수기간 **{payback}년** · 10년 누적절감 **{cumulative_10_year:,.0f}원** · "
                    f"20년 누적절감 **{cumulative_20_year:,.0f}원**"
                )
            except Exception as exc:  # noqa: BLE001 - Streamlit should surface external API failures.
                st.error(f"API 호출 실패: {exc}")
    else:
        st.info("지도에서 건물 폴리곤을 클릭하세요.")

with st.expander("현재 표시 데이터셋 메타"):
    st.write(f"- 동: **{admdong}** / 건물 {row['feature_count']:,}건")
    st.write(f"- 표시 한도: {max_features} (면적 큰 순)")
    st.write(f"- 옵션 적용: 패널 {capacity}W / 경사 {angle}° / 활용계수 {util} / 음영 {shading}")
    st.write(f"- 패널면적: {PANEL_AREA_M2[capacity]:.3f} ㎡/장")
