"""
솔라메이트 MVP 검증 앱 — climate.gg 8단계 옥상 파이프라인 라이브 시각화.

목적:
- 좌표 1점 클릭 -> 옥상 polygon + 셀별 음영 + WFS 메타 + 사용량 + 발전 시뮬
- 셀 음영 히트맵을 folium 지도 위에 직접 표시 (climate.gg UI 와 동등 수준)

실행:
  pip install streamlit streamlit-folium folium branca requests pyproj shapely
  cd C:\\Users\\insung\\solar-power
  streamlit run scripts/mvp_app.py

문서:
- docs/api_spec_climate_har.md (API 명세)
- docs/DEV_HANDOFF_CLIMATE_APIS.md (개발자 핸드오프)
- scripts/poc_rooftop_pipeline.py (재사용 함수 본체)
"""
from __future__ import annotations

import json
from typing import Any

import branca.colormap as cm
import folium
import pandas as pd
import streamlit as st
from folium.plugins import MarkerCluster
from streamlit_folium import st_folium

from poc_rooftop_pipeline import (
    CELL_H_DEFAULT,
    CELL_W_DEFAULT,
    PipelineResult,
    result_to_bundle,
    run_pipeline,
)

# ----------------------------- 상수 -----------------------------
DEFAULT_CLICK = (127.0715, 37.2025)   # 화성 동탄 현대하이페리온 (37층 아파트, 적중 검증)
# 화성시 동탄 신도시 일대 (반경 ~500m 내 5건). 2026-05-22 라이브 API 적중 검증 완료.
# 원본: data/processed/sample_coords.csv
PRESET_LOCATIONS = {
    "화성 동탄 현대하이페리온 (37층 아파트)": (127.0715, 37.2025),
    "화성 동탄 지웰 에스테이트 (20층 아파트)": (127.0715, 37.2030),
    "화성 동탄 원영빌딩 (11층 오피스텔)": (127.0715, 37.2015),
    "화성 동탄 워터밸리 (8층 상가)": (127.0720, 37.2000),
    "화성 동탄 제일프라자 (9층)": (127.0715, 37.1995),
}
REGULATION_LABELS = {
    "ldsld_grd1": "산사태 1등급 위험지역",
    "landscape": "경관지구",
    "watershed_conservation_area": "수계보전구역",
    "forest_genetic_resource_protection_area": "산림유전자원보호구역",
    "disaster_prevention_protection_area": "재해방지보호구역",
    "national_cultural_property": "국가문화재",
    "national_cultural_property_zone": "국가문화재 보호구역",
    "national_registered_property": "국가등록문화재",
    "local_cultural_property": "지방문화재",
    "local_cultural_property_zone": "지방문화재 보호구역",
    "national_park": "국립공원",
    "provincial_park": "도립공원",
    "county_park": "군립공원",
    "provincial_ecological_landscape_conservation_area": "도지정 생태경관보전지역",
    "wildlife_protection_area": "야생생물보호구역",
    "drinking_water_protection_area": "상수원보호구역",
    "riparian_zone": "수변구역",
    "wetland_protection_area": "습지보호구역",
    "eco1_mgmt_area": "생태자연도 1등급",
}


# ----------------------------- Streamlit 설정 -----------------------------
st.set_page_config(page_title="솔라메이트 MVP 검증", layout="wide")
st.title("솔라메이트 — climate.gg 8단계 옥상 파이프라인 검증")
st.caption(
    "좌표 1점 → selectBuld + WFS + selectSunList + selectBuldInfo + pv/analysis 라이브 호출. "
    "셀별 음영을 지도 위에 히트맵으로 표시합니다."
)


# ----------------------------- 캐시된 호출 -----------------------------
@st.cache_data(show_spinner=False)
def cached_run_pipeline(
    lon: float,
    lat: float,
    panel_capacity_w: int,
    panel_type: int,
    cells_per_panel: int,
    angle: str,
    skip_rule_check: bool,
) -> dict[str, Any]:
    """캐시 가능한 dict 형태로 결과 반환 (PipelineResult 는 dataclass 라 캐시에 부적합)."""
    res: PipelineResult = run_pipeline(
        lon=lon,
        lat=lat,
        panel_capacity_w=panel_capacity_w,
        panel_type=panel_type,
        cells_per_panel=cells_per_panel,
        angle=angle,
        skip_rule_check=skip_rule_check,
    )
    bundle = result_to_bundle(res)
    return {
        "bundle": bundle,
        "panels_geojson": res.panels_geojson,
        "errors": res.errors,
        "cells_total": len(res.cells),
        "shading_per_cell": {str(k): v for k, v in res.shading.items()},
    }


# ----------------------------- 사이드바 -----------------------------
with st.sidebar:
    st.header("입력")

    preset = st.selectbox("좌표 프리셋", list(PRESET_LOCATIONS.keys()))
    default_lon, default_lat = PRESET_LOCATIONS[preset]

    col_lon, col_lat = st.columns(2)
    input_lon = col_lon.number_input("경도 (lon)", value=float(default_lon), format="%.7f")
    input_lat = col_lat.number_input("위도 (lat)", value=float(default_lat), format="%.7f")

    st.caption("지도를 직접 클릭하면 좌표가 자동 갱신됩니다.")

    st.divider()
    st.header("패널 옵션")
    panel_capacity_w = st.radio("패널 사양 (W)", [500, 640], index=1, horizontal=True)
    panel_angle = st.radio("패널 경사각 (°)", ["30", "35"], index=1, horizontal=True)
    panel_type = st.radio("패널 타입 코드", [1, 2], index=0, horizontal=True, help="climate.gg API panel_type 코드 (1 추정 표준)")
    cells_per_panel = st.slider("1 패널 당 셀 개수", 1, 4, 2, help="climate.gg 셀 1m×3.5m, 실패널 1.1m×1.8m 기준 잠정 가정")

    st.divider()
    skip_rules = st.checkbox("규제 매칭 호출 스킵 (MVP)", value=True)
    auto_run = st.checkbox("좌표 변경 시 자동 호출", value=True)

    run_button = st.button("파이프라인 실행", type="primary", use_container_width=True)


# ----------------------------- 클릭 좌표 상태 관리 -----------------------------
if "click_lon" not in st.session_state:
    st.session_state["click_lon"] = input_lon
    st.session_state["click_lat"] = input_lat

# 수동 입력 변경 시 동기화
if input_lon != st.session_state["click_lon"] or input_lat != st.session_state["click_lat"]:
    st.session_state["click_lon"] = input_lon
    st.session_state["click_lat"] = input_lat

lon = float(st.session_state["click_lon"])
lat = float(st.session_state["click_lat"])


# ----------------------------- 파이프라인 호출 -----------------------------
should_run = run_button or auto_run
result: dict[str, Any] | None = None

if should_run:
    with st.spinner(f"climate.gg API 호출 중 ({lon:.6f}, {lat:.6f})..."):
        result = cached_run_pipeline(
            lon=lon,
            lat=lat,
            panel_capacity_w=int(panel_capacity_w),
            panel_type=int(panel_type),
            cells_per_panel=int(cells_per_panel),
            angle=str(panel_angle),
            skip_rule_check=bool(skip_rules),
        )

# ----------------------------- 지도 빌드 -----------------------------
map_obj = folium.Map(location=[lat, lon], zoom_start=18, tiles="CartoDB Positron")
folium.TileLayer(
    tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attr="Esri",
    name="위성영상",
    overlay=False,
    control=True,
).add_to(map_obj)

# 클릭 마커
folium.Marker(
    [lat, lon],
    icon=folium.Icon(color="red", icon="crosshairs", prefix="fa"),
    tooltip=f"입력 좌표 ({lon:.5f}, {lat:.5f})",
).add_to(map_obj)

if result and result["bundle"].get("roof_polygon_4326"):
    bundle = result["bundle"]

    # 옥상 polygon 외곽선
    folium.GeoJson(
        {
            "type": "Feature",
            "geometry": bundle["roof_polygon_4326"],
            "properties": {},
        },
        name="옥상 polygon (selectBuld)",
        style_function=lambda _: {"color": "#d62728", "weight": 3, "fill": False},
    ).add_to(map_obj)

    # 셀 음영 히트맵
    panels_geojson = result["panels_geojson"]
    if panels_geojson and panels_geojson.get("features"):
        scores = [f["properties"]["shading_score"] for f in panels_geojson["features"]]
        s_min, s_max = (min(scores), max(scores)) if scores else (0, 1)
        if s_max - s_min < 1e-6:
            s_max = s_min + 1
        colormap = cm.LinearColormap(
            colors=["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
            vmin=s_min, vmax=s_max,
            caption="셀별 음영점수 (높을수록 일조 양호)",
        )
        for feature in panels_geojson["features"]:
            score = feature["properties"]["shading_score"]
            folium.GeoJson(
                feature,
                style_function=lambda _f, s=score: {
                    "fillColor": colormap(s),
                    "color": colormap(s),
                    "weight": 0.5,
                    "fillOpacity": 0.85,
                },
                tooltip=f"cell {feature['properties']['cell_id']} · score {score:.3f}",
            ).add_to(map_obj)
        colormap.add_to(map_obj)

folium.LayerControl(collapsed=False).add_to(map_obj)


# ----------------------------- 레이아웃 -----------------------------
col_map, col_side = st.columns([3, 2])

with col_map:
    st.subheader("지도")
    map_state = st_folium(
        map_obj,
        height=620,
        width=None,
        returned_objects=["last_clicked"],
        key="mainmap",
    )

    clicked = map_state.get("last_clicked") if isinstance(map_state, dict) else None
    if clicked and isinstance(clicked, dict):
        new_lat = float(clicked.get("lat"))
        new_lon = float(clicked.get("lng"))
        if abs(new_lon - st.session_state["click_lon"]) > 1e-7 or abs(new_lat - st.session_state["click_lat"]) > 1e-7:
            st.session_state["click_lon"] = new_lon
            st.session_state["click_lat"] = new_lat
            st.rerun()

with col_side:
    st.subheader("8단계 결과 요약")

    if not result:
        st.info("좌측 사이드바에서 좌표 입력 후 '파이프라인 실행' 또는 지도 클릭.")
    else:
        bundle = result["bundle"]
        errs = result["errors"]
        meta = bundle["meta"]
        shading = bundle["shading"]
        pv_out = bundle.get("pv_analysis_output") or {}

        if errs:
            for err in errs:
                st.error(err)

        # 단계별 상태 칩
        steps = [
            ("1 selectBuld", bool(bundle.get("roof_polygon_4326")), f"면적 {bundle['roof_area_sqm_5186']:.0f}㎡"),
            ("2 WFS 메타", bool(meta.get("unq_id")), meta.get("bldg_nm") or "-"),
            ("3 셀 격자", shading["cells_total"] > 0, f"{shading['cells_total']}장"),
            ("4 selectSunList", shading["cells_with_score"] > 0, f"평균 {shading['score_mean']:.2f}" if shading.get("score_mean") is not None else "-"),
            ("5 selectBuldInfo", len(bundle["usage_monthly"]["electricity_kwh"]) > 0, f"{len(bundle['usage_monthly']['electricity_kwh'])}개월"),
            ("6 selectRuleList", not skip_rules, "양성 " + str(len(bundle["regulation_hits"])) if not skip_rules else "스킵"),
            ("7 pv/analysis", bool(pv_out), f"{pv_out.get('annual_generation', 0):,.0f}kWh/년" if pv_out else "-"),
        ]
        df_steps = pd.DataFrame(
            [{"단계": s, "상태": "✅" if ok else "✖", "비고": note} for s, ok, note in steps]
        )
        st.dataframe(df_steps, hide_index=True, use_container_width=True)


# ----------------------------- 상세 탭 -----------------------------
if result:
    bundle = result["bundle"]
    meta = bundle["meta"]
    pv_out = bundle.get("pv_analysis_output") or {}
    pv_in = bundle.get("pv_analysis_input") or {}

    tab_meta, tab_shading, tab_usage, tab_rules, tab_pv, tab_raw = st.tabs(
        ["건물 메타 (WFS)", "셀 음영 (selectSunList)", "사용량 (selectBuldInfo)", "규제 (selectRuleList)", "발전·경제성 (pv/analysis)", "Raw JSON"]
    )

    with tab_meta:
        cols = st.columns(4)
        cols[0].metric("건물명", meta.get("bldg_nm") or "-")
        cols[1].metric("층수", f"{meta.get('bldg_nofl') or '-'}")
        cols[2].metric("높이", f"{meta.get('bldg_hgt') or '-'} m")
        cols[3].metric("건축면적", f"{meta.get('bdar') or 0:,} ㎡")
        st.write({
            "unq_id": meta.get("unq_id"),
            "용도코드": meta.get("bldg_usg_cd"),
            "시군코드": meta.get("sigun_cd"),
            "사용승인일": meta.get("use_aprv_ymd"),
            "옥상 polygon 면적 (5186 계산)": f"{bundle['roof_area_sqm_5186']} ㎡",
        })

    with tab_shading:
        shading = bundle["shading"]
        cols = st.columns(4)
        cols[0].metric("총 셀", shading["cells_total"])
        cols[1].metric("음영 반환", shading["cells_with_score"])
        cols[2].metric("평균 score", f"{shading['score_mean']:.3f}" if shading.get("score_mean") is not None else "-")
        cols[3].metric("범위", f"{shading['score_min']:.2f} ~ {shading['score_max']:.2f}" if shading.get("score_min") is not None else "-")
        st.caption(f"셀 크기: {shading['cell_w_m']}m × {shading['cell_h_m']}m (EPSG:5186)")

        if result.get("shading_per_cell"):
            sc_df = pd.DataFrame(
                [{"cell_id": int(k), "shading_score": v} for k, v in result["shading_per_cell"].items()]
            ).sort_values("cell_id")
            st.bar_chart(sc_df.set_index("cell_id"))

    with tab_usage:
        u = bundle["usage_monthly"]
        if not u["electricity_kwh"]:
            st.warning("이 건물은 selectBuldInfo 사용량 미수집 (unq_id 결손 또는 비대상 건물)")
        else:
            df_u = pd.DataFrame({
                "월": u["labels"],
                "전력 (kWh)": u["electricity_kwh"],
                "가스 (m³)": u["gas_m3"],
            })
            cols = st.columns(3)
            cols[0].metric("평균 전력", f"{sum(u['electricity_kwh']) / len(u['electricity_kwh']):,.0f} kWh/월")
            cols[1].metric("평균 가스", f"{sum(u['gas_m3']) / len(u['gas_m3']):,.0f} m³/월")
            cols[2].metric("측정 개월", f"{len(u['electricity_kwh'])}")
            st.dataframe(df_u, hide_index=True, use_container_width=True)
            st.line_chart(df_u.set_index("월")[["전력 (kWh)"]])
            st.line_chart(df_u.set_index("월")[["가스 (m³)"]])

    with tab_rules:
        if skip_rules:
            st.info("규제 매칭 호출이 스킵되었습니다 (사이드바 옵션).")
        else:
            hits = bundle["regulation_hits"]
            if not hits:
                st.success("19종 규제 모두 무관 (cnt=0). 설치 검토에 추가 제약 없음.")
            else:
                st.warning(f"{len(hits)}개 규제 매칭")
                for layer, cnt in hits:
                    st.write(f"- **{REGULATION_LABELS.get(layer, layer)}** ({layer}) · cnt={cnt}")

    with tab_pv:
        if not pv_out:
            st.info("pv/analysis 응답이 비어 있습니다.")
        else:
            er = pv_out["expected_revenue"]
            env = pv_out["environmental_contribution"]
            cols = st.columns(4)
            cols[0].metric("설치 용량", f"{er['install_kw']} kW")
            cols[1].metric("연간 발전", f"{pv_out['annual_generation']:,.0f} kWh")
            cols[2].metric("1년차 수익", f"{er['first_year_revenue']:,} 원")
            cols[3].metric("1년차 절감", f"{er['first_year_save_cost']:,} 원")
            cols = st.columns(4)
            cols[0].metric("설치비", f"{er['expected_investment']:,} 원")
            cols[1].metric("CO₂ 저감", f"{env['carbon_reduction']:,} kg/년")
            cols[2].metric("소나무 환산", f"{env['pine_tree_effect']:,} 그루")
            payback = er["expected_investment"] / max(1, er["first_year_save_cost"])
            cols[3].metric("회수기간(추정)", f"{payback:.1f} 년")

            st.caption(f"입력 요약: shading_avg={pv_in.get('shading_index_average', 0):.3f}, "
                       f"panel_count={pv_in.get('solar_panel_info', {}).get('panel_count')}, "
                       f"panel_capacity={pv_in.get('solar_panel_info', {}).get('panel_capacity')}W")

            monthly = pd.DataFrame(pv_out.get("monthly_generation", [])).rename(columns={"generation": "발전량(kWh)"})
            if not monthly.empty:
                st.bar_chart(monthly.set_index("month"))
            annual_rev = pd.DataFrame(pv_out.get("annual_revenue", [])).rename(columns={"revenue": "수익(원)"})
            annual_save = pd.DataFrame(pv_out.get("annual_saveCost", [])).rename(columns={"saveCost": "절감(원)"})
            if not annual_rev.empty:
                merged = annual_rev.set_index("year").join(annual_save.set_index("year"), how="outer")
                st.line_chart(merged)

    with tab_raw:
        st.download_button(
            "bundle.json 다운로드",
            data=json.dumps(bundle, ensure_ascii=False, indent=2).encode("utf-8"),
            file_name=f"bundle_{meta.get('unq_id') or 'unknown'}.json",
            mime="application/json",
        )
        st.download_button(
            "panels_4326.geojson 다운로드",
            data=json.dumps(result["panels_geojson"], ensure_ascii=False).encode("utf-8"),
            file_name=f"panels_{meta.get('unq_id') or 'unknown'}.geojson",
            mime="application/geo+json",
        )
        st.json(bundle, expanded=False)
