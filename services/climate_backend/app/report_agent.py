"""태양광 설치 종합 분석 보고서 에이전트.

개발자(climate_backend)의 `aiSimulationResult`(적합도·발전량·경제성)를 입력으로 받아
시군별 보조금(subsidy_table)과 대출 가정을 결합한 뒤,
사용자에게 보여줄 세일즈/분석 보고서를 (1) 구조화 데이터와 (2) 자립형 HTML 로 생성한다.

설계 원칙
- 톤: 중립 분석 리포트체 (추정/예상/확인 필요 표기 준수).
- HTML 은 외부 CDN 없이 인라인 CSS + SVG 로 자립 렌더 (오프라인/캡처 가능).
- 순수 함수 중심. 개발자가 FastAPI 라우트에서 import 해 그대로 호출 가능.

[목업 가정 — 현석(기획) 확정 시 교체]
- 대출: 자부담액의 최대 80%, 5년 만기, "예상 수익 담보" 포장. 이자 미반영.
"""
from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Any, Optional

from .subsidy_table import classify_housing_type, estimate_subsidy, normalize_sigungu

REPORT_VERSION = "solarmate-report-agent-v1"

# 대출 목업 가정 (현석 확정 시 교체)
DEFAULT_LOAN_RATIO = 0.80
DEFAULT_LOAN_TERM_YEARS = 5

GRADE_COLORS = {
    "S": "#1f9d55",
    "A": "#38a169",
    "B": "#3182ce",
    "C": "#dd9b22",
    "D": "#e0533d",
}

FEATURE_LABELS = {
    "shadingQuality": ("음영 품질", 35),
    "usableArea": ("사용 가능 면적", 20),
    "generationPotential": ("발전 잠재력", 20),
    "economicValue": ("경제성", 15),
}

MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"]
MONTHLY_GENERATION_WEIGHTS = [
    0.072, 0.079, 0.092, 0.101, 0.107, 0.104,
    0.097, 0.096, 0.087, 0.073, 0.049, 0.043,
]


# ---------- helpers ----------

def _as_float(value: Any, fallback: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return fallback
    return out if out == out else fallback


def _as_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return fallback


def _won(value: Any) -> str:
    """원 단위 정수를 만원/억 단위 한글 표기로."""
    n = _as_int(value)
    if n == 0:
        return "0원"
    eok, rem = divmod(abs(n), 100_000_000)
    man = rem // 10_000
    parts = []
    if eok:
        parts.append(f"{eok:,}억")
    if man:
        parts.append(f"{man:,}만원")
    if not parts:
        parts.append(f"{abs(n):,}원")
    elif not parts[-1].endswith("원"):
        parts[-1] = parts[-1] + ""
    text = " ".join(parts)
    if not text.endswith("원"):
        text += "원"
    return ("-" if n < 0 else "") + text


def _esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""))


def _dig(d: Any, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


# ---------- data assembly ----------

def _resolve_sigungu(ai: dict[str, Any], explicit: Optional[str]) -> Optional[str]:
    if explicit:
        return explicit
    for path in (
        ("building", "jibunAddress"),
        ("building", "roadAddress"),
        ("agentPayload", "subsidyRagInput", "location", "jibunAddress"),
        ("agentPayload", "subsidyRagInput", "location", "roadAddress"),
    ):
        val = _dig(ai, *path)
        if isinstance(val, str) and val.strip():
            return val
    return None


def _monthly_series(annual_kwh: float, ai: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"month": MONTH_LABELS[i], "kwh": round(annual_kwh * w)}
        for i, w in enumerate(MONTHLY_GENERATION_WEIGHTS)
    ]


def build_report_data(
    ai_simulation_result: dict[str, Any],
    *,
    sigungu: Optional[str] = None,
    loan_ratio: float = DEFAULT_LOAN_RATIO,
    loan_term_years: int = DEFAULT_LOAN_TERM_YEARS,
) -> dict[str, Any]:
    ai = ai_simulation_result if isinstance(ai_simulation_result, dict) else {}

    suitability = ai.get("buildingSuitability") if isinstance(ai.get("buildingSuitability"), dict) else (
        ai.get("suitability") if isinstance(ai.get("suitability"), dict) else {}
    )
    economics = ai.get("economics") if isinstance(ai.get("economics"), dict) else {}
    generation = ai.get("generationPrediction") if isinstance(ai.get("generationPrediction"), dict) else {}
    building = ai.get("building") if isinstance(ai.get("building"), dict) else {}

    # --- 발전/수익 ---
    annual_kwh = _as_float(generation.get("annualGenerationKwh")) or _as_float(economics.get("annualGenerationKwh"))
    annual_saving = _as_float(economics.get("annualSavingKrw"))

    # --- 비용/보조금/대출 ---
    install_cost = _as_float(economics.get("estimatedInstallCostKrw"))
    capacity_kw = _as_float(_dig(ai, "agentPayload", "subsidyRagInput", "installCapacityKw")) or _as_float(economics.get("installCapacityKw"))
    housing_type = classify_housing_type(building.get("buildingUsage") or building.get("usage"))
    sg_name = _resolve_sigungu(ai, sigungu)
    display_sigungu = normalize_sigungu(sg_name)
    subsidy = estimate_subsidy(install_cost, sg_name, housing_type=housing_type, capacity_kw=capacity_kw)
    subsidy_krw = _as_float(subsidy.get("subsidyKrw"))

    self_payment = max(0.0, install_cost - subsidy_krw)
    loan_limit = round(self_payment * loan_ratio)
    net_investment = max(0, round(self_payment - loan_limit))

    payback_raw = round(install_cost / annual_saving, 1) if annual_saving > 0 and install_cost > 0 else 0.0
    payback_net = round(net_investment / annual_saving, 1) if annual_saving > 0 and net_investment > 0 else 0.0

    grade = suitability.get("grade") or "C"
    feature_scores = suitability.get("featureScores") if isinstance(suitability.get("featureScores"), dict) else {}

    return {
        "meta": {
            "reportVersion": REPORT_VERSION,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "tone": "neutral-analytical",
            "sourceModelVersion": ai.get("modelVersion"),
        },
        "building": {
            "name": building.get("buildingName") or "선택 건물",
            "roadAddress": building.get("roadAddress") or "",
            "jibunAddress": building.get("jibunAddress") or "",
            "usage": building.get("buildingUsage") or "확인 필요",
            "sigungu": display_sigungu,
            "housingType": housing_type,
        },
        "suitability": {
            "score": _as_int(suitability.get("score")),
            "grade": grade,
            "label": suitability.get("label") or "",
            "featureScores": feature_scores,
            "cluster": _dig(suitability, "cluster", "clusterName") or "군집 확인 필요",
            "reasons": suitability.get("reasons") or [],
            "warnings": suitability.get("warnings") or [],
        },
        "generation": {
            "annualKwh": round(annual_kwh),
            "monthlyKwh": _as_int(generation.get("monthlyGenerationKwh")) or (round(annual_kwh / 12) if annual_kwh else 0),
            "confidence": _as_float(generation.get("confidence")),
            "confidenceLabel": generation.get("confidenceLabel") or "확인 필요",
            "series": _monthly_series(annual_kwh, ai),
        },
        "economics": {
            "installCapacityKw": capacity_kw,
            "installCostKrw": round(install_cost),
            "annualSavingKrw": round(annual_saving),
            "subsidy": subsidy,
            "subsidyKrw": round(subsidy_krw),
            "selfPaymentAfterSubsidyKrw": round(self_payment),
            "loan": {
                "limitKrw": loan_limit,
                "ratio": loan_ratio,
                "termYears": loan_term_years,
                "basis": "예상 수익 담보(목업 가정)",
                "disclaimer": (
                    f"자부담액의 최대 {round(loan_ratio * 100)}%를 {loan_term_years}년 만기 정책자금으로 "
                    "조달한다는 가정입니다. 이자·심사 조건 미반영, 실제 상품·한도는 협의 후 확정됩니다."
                ),
            },
            "netInvestmentKrw": net_investment,
            "paybackYearsRaw": payback_raw,
            "paybackYearsNet": payback_net,
        },
        "cta": {
            "headline": "정확한 설치 규모·자부담·보조금 한도는 현장조사와 최신 공고 확인 후 상담에서 확정됩니다.",
            "buttonText": "무료 상담 신청하기",
        },
        "disclaimers": [
            "본 보고서의 발전량·수익은 시뮬레이션 기반 대리 회귀 모델의 예상·추정값이며 실측을 보증하지 않습니다.",
            subsidy.get("disclaimer", ""),
            "대출 조건은 목업 가정값으로, 실제 정책자금 상품·금리·심사 결과에 따라 달라집니다.",
            "실제 발전량·경제성은 현장 장애물, 구조안전성, 계통연계 조건, 관리주체 협의에 따라 변동될 수 있습니다.",
        ],
    }


# ---------- SVG / HTML rendering ----------

def _svg_score_donut(score: int, grade: str) -> str:
    color = GRADE_COLORS.get(grade, "#3182ce")
    r = 52
    circ = 2 * 3.14159 * r
    filled = circ * min(100, max(0, score)) / 100
    return f"""
<svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="적합도 점수 {score}점">
  <circle cx="70" cy="70" r="{r}" fill="none" stroke="#eceff3" stroke-width="14"/>
  <circle cx="70" cy="70" r="{r}" fill="none" stroke="{color}" stroke-width="14"
          stroke-linecap="round" stroke-dasharray="{filled:.1f} {circ:.1f}"
          transform="rotate(-90 70 70)"/>
  <text x="70" y="64" text-anchor="middle" font-size="30" font-weight="700" fill="#1a202c">{score}</text>
  <text x="70" y="86" text-anchor="middle" font-size="13" fill="#718096">/ 100점</text>
</svg>"""


def _bars_features(feature_scores: dict[str, Any]) -> str:
    rows = []
    for key, (label, maxv) in FEATURE_LABELS.items():
        val = _as_float(feature_scores.get(key))
        pct = min(100, max(0, val / maxv * 100)) if maxv else 0
        rows.append(f"""
    <div class="bar-row">
      <span class="bar-label">{_esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:{pct:.0f}%"></span></span>
      <span class="bar-value">{val:.1f}<small>/{maxv}</small></span>
    </div>""")
    return "".join(rows)


def _bars_monthly(series: list[dict[str, Any]]) -> str:
    if not series:
        return ""
    maxv = max((_as_float(s.get("kwh")) for s in series), default=0) or 1
    bars = []
    for s in series:
        v = _as_float(s.get("kwh"))
        h = max(2, v / maxv * 120)
        bars.append(f"""
      <div class="mbar" title="{_esc(s.get('month'))} {v:,.0f} kWh">
        <span class="mbar-fill" style="height:{h:.0f}px"></span>
        <span class="mbar-x">{_esc(s.get('month'))}</span>
      </div>""")
    return f'<div class="mbars">{"".join(bars)}</div>'


def _waterfall(econ: dict[str, Any]) -> str:
    install = _as_float(econ.get("installCostKrw"))
    subsidy = _as_float(econ.get("subsidyKrw"))
    self_pay = _as_float(econ.get("selfPaymentAfterSubsidyKrw"))
    loan = _as_float(_dig(econ, "loan", "limitKrw"))
    net = _as_float(econ.get("netInvestmentKrw"))
    base = install or 1

    def seg(label, value, color, note=""):
        pct = min(100, max(0, value / base * 100))
        return f"""
    <div class="wf-row">
      <span class="wf-label">{_esc(label)}</span>
      <span class="wf-track"><span class="wf-fill" style="width:{pct:.0f}%;background:{color}"></span></span>
      <span class="wf-value">{_won(value)}{(' · ' + note) if note else ''}</span>
    </div>"""

    return (
        seg("총 설치비(추정)", install, "#4a5568")
        + seg("− 보조금", subsidy, "#1f9d55")
        + seg("자부담", self_pay, "#3182ce")
        + seg("− 대출(수익 담보, 목업)", loan, "#805ad5")
        + seg("실투자금", net, "#dd6b20", "초기 필요 자금")
    )


def render_report_html(data: dict[str, Any]) -> str:
    b = data["building"]
    s = data["suitability"]
    g = data["generation"]
    e = data["economics"]
    grade = s["grade"]
    grade_color = GRADE_COLORS.get(grade, "#3182ce")

    reasons = "".join(f"<li>{_esc(x)}</li>" for x in s["reasons"][:4]) or "<li>추가 분석이 필요합니다.</li>"
    warnings = "".join(f"<li>{_esc(x)}</li>" for x in s["warnings"][:4])
    warnings_block = f'<div class="warn"><h4>검토 시 유의사항</h4><ul>{warnings}</ul></div>' if warnings else ""
    disclaimers = "".join(f"<li>{_esc(x)}</li>" for x in data["disclaimers"] if x)

    addr = b["roadAddress"] or b["jibunAddress"] or "주소 확인 필요"
    payback_net = e["paybackYearsNet"]
    payback_raw = e["paybackYearsRaw"]

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI 태양광 설치 분석 보고서 — {_esc(b['name'])}</title>
<style>
  :root {{ --ink:#1a202c; --sub:#718096; --line:#e2e8f0; --bg:#f7fafc; --brand:#1f6feb; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
         font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif; line-height:1.6; }}
  .page {{ max-width:840px; margin:0 auto; padding:32px 24px 64px; }}
  .hero {{ background:linear-gradient(135deg,#0b2e63,#1f6feb); color:#fff; border-radius:18px; padding:28px 30px; }}
  .hero .tag {{ font-size:13px; opacity:.85; letter-spacing:.04em; }}
  .hero h1 {{ margin:6px 0 2px; font-size:24px; }}
  .hero .addr {{ font-size:14px; opacity:.9; }}
  .grade-chip {{ display:inline-flex; align-items:baseline; gap:8px; margin-top:14px;
                background:rgba(255,255,255,.15); border-radius:999px; padding:8px 16px; }}
  .grade-chip b {{ font-size:22px; }}
  section {{ background:#fff; border:1px solid var(--line); border-radius:16px; padding:22px 24px; margin-top:18px; }}
  section h2 {{ font-size:17px; margin:0 0 4px; }}
  section .lead {{ color:var(--sub); font-size:13px; margin:0 0 16px; }}
  .grid2 {{ display:grid; grid-template-columns:140px 1fr; gap:22px; align-items:center; }}
  .bar-row {{ display:grid; grid-template-columns:96px 1fr 64px; gap:10px; align-items:center; margin:8px 0; font-size:13px; }}
  .bar-track {{ background:#eceff3; border-radius:6px; height:10px; overflow:hidden; }}
  .bar-fill {{ display:block; height:100%; background:var(--brand); border-radius:6px; }}
  .bar-value {{ text-align:right; color:var(--sub); }} .bar-value small {{ color:#a0aec0; }}
  .kpis {{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }}
  .kpi {{ background:var(--bg); border-radius:12px; padding:14px 16px; }}
  .kpi .k {{ font-size:12px; color:var(--sub); }} .kpi .v {{ font-size:20px; font-weight:700; margin-top:4px; }}
  .mbars {{ display:flex; align-items:flex-end; gap:6px; height:150px; padding-top:8px; }}
  .mbar {{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; }}
  .mbar-fill {{ width:60%; background:linear-gradient(180deg,#4a9eff,#1f6feb); border-radius:4px 4px 0 0; }}
  .mbar-x {{ font-size:10px; color:var(--sub); margin-top:4px; }}
  .wf-row {{ display:grid; grid-template-columns:160px 1fr 200px; gap:10px; align-items:center; margin:9px 0; font-size:13px; }}
  .wf-track {{ background:#f0f2f5; border-radius:6px; height:14px; overflow:hidden; }}
  .wf-fill {{ display:block; height:100%; border-radius:6px; }}
  .wf-value {{ text-align:right; font-variant-numeric:tabular-nums; }}
  .highlight {{ display:flex; gap:16px; flex-wrap:wrap; margin-top:16px; }}
  .highlight .box {{ flex:1; min-width:180px; background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; padding:16px; }}
  .highlight .box.blue {{ background:#eff6ff; border-color:#bfdbfe; }}
  .highlight .box .k {{ font-size:12px; color:var(--sub); }} .highlight .box .v {{ font-size:22px; font-weight:800; color:#c2410c; }}
  .highlight .box.blue .v {{ color:#1d4ed8; }}
  ul {{ margin:6px 0 0; padding-left:18px; }} li {{ font-size:13px; margin:3px 0; }}
  .warn {{ background:#fffaf0; border:1px solid #feebc8; border-radius:10px; padding:12px 16px; margin-top:14px; }}
  .warn h4 {{ margin:0 0 4px; font-size:13px; color:#b7791f; }}
  .cta {{ background:linear-gradient(135deg,#1f6feb,#0b2e63); color:#fff; text-align:center; border-radius:16px; padding:26px; margin-top:18px; }}
  .cta p {{ margin:0 0 14px; font-size:14px; opacity:.95; }}
  .cta a {{ display:inline-block; background:#fff; color:#0b2e63; font-weight:700; text-decoration:none;
            padding:12px 28px; border-radius:999px; }}
  .foot {{ color:#a0aec0; font-size:11px; margin-top:22px; }}
  .foot ul {{ padding-left:16px; }}
  .badge {{ display:inline-block; font-size:11px; color:var(--sub); border:1px solid var(--line);
            border-radius:6px; padding:2px 8px; margin-left:6px; }}
</style>
</head>
<body>
<div class="page">

  <div class="hero">
    <div class="tag">AI 태양광 설치 종합 분석 보고서</div>
    <h1>{_esc(b['name'])}</h1>
    <div class="addr">{_esc(addr)} · 용도 {_esc(b['usage'])}{f" · {_esc(b['sigungu'])}" if b['sigungu'] else ""}</div>
    <div class="grade-chip" style="border:1px solid {grade_color}">
      <span>AI 적합도</span><b style="color:#fff">{_esc(grade)}등급</b>
      <span>{_esc(s['label'])} · {s['score']}점</span>
    </div>
  </div>

  <section>
    <h2>1. AI 설치 적합도 분석</h2>
    <p class="lead">음영·면적·발전 잠재력·경제성 4개 지표를 종합한 설명 가능한 AI 점수화 결과입니다. (군집 유형: {_esc(s['cluster'])})</p>
    <div class="grid2">
      <div style="text-align:center">{_svg_score_donut(s['score'], grade)}</div>
      <div>{_bars_features(s['featureScores'])}</div>
    </div>
    <ul>{reasons}</ul>
    {warnings_block}
  </section>

  <section>
    <h2>2. 예상 발전량 · 절감 수익</h2>
    <p class="lead">시뮬레이션 기반 대리 회귀 모델의 예상값입니다. (예측 신뢰도: {_esc(g['confidenceLabel'])})</p>
    <div class="kpis">
      <div class="kpi"><div class="k">연간 예상 발전량</div><div class="v">{g['annualKwh']:,} kWh</div></div>
      <div class="kpi"><div class="k">월 평균 발전량</div><div class="v">{g['monthlyKwh']:,} kWh</div></div>
      <div class="kpi"><div class="k">연간 예상 절감액</div><div class="v">{_won(e['annualSavingKrw'])}</div></div>
    </div>
    {_bars_monthly(g['series'])}
  </section>

  <section>
    <h2>3. 설치비 · 보조금 · 대출 구조</h2>
    <p class="lead">{_esc(_dig(e, 'subsidy', 'program') or '주택태양광 보조금')} 기준 추정 보조금과 대출 가정을 반영한 자금 구조입니다.</p>
    {_waterfall(e)}
    <div class="highlight">
      <div class="box blue"><div class="k">예상 보조금</div><div class="v">{_won(e['subsidyKrw'])}</div></div>
      <div class="box blue"><div class="k">대출 한도(수익 담보·{e['loan']['termYears']}년)</div><div class="v">{_won(e['loan']['limitKrw'])}</div></div>
      <div class="box"><div class="k">실제 필요한 초기 투자금</div><div class="v">{_won(e['netInvestmentKrw'])}</div></div>
    </div>
  </section>

  <section>
    <h2>4. 투자 회수 분석</h2>
    <p class="lead">연간 예상 절감액 기준 단순 회수기간입니다. (대출 이자 미반영 가정)</p>
    <div class="kpis">
      <div class="kpi"><div class="k">보조금·대출 적용 전</div><div class="v">{payback_raw if payback_raw else '—'}년</div></div>
      <div class="kpi"><div class="k">실투자금 기준 회수기간</div><div class="v" style="color:#dd6b20">{payback_net if payback_net else '—'}년</div></div>
      <div class="kpi"><div class="k">설치 용량(추정)</div><div class="v">{e['installCapacityKw'] if e['installCapacityKw'] else '—'} kW</div></div>
    </div>
  </section>

  <div class="cta">
    <p>{_esc(data['cta']['headline'])}</p>
    <a href="#consult">{_esc(data['cta']['buttonText'])}</a>
  </div>

  <div class="foot">
    <strong>안내 및 면책</strong>
    <ul>{disclaimers}</ul>
    <div>보고서 버전 {_esc(data['meta']['reportVersion'])} · 생성 {_esc(data['meta']['generatedAt'][:19])}Z</div>
  </div>

</div>
</body>
</html>"""


def build_solar_report(
    ai_simulation_result: dict[str, Any],
    *,
    sigungu: Optional[str] = None,
    loan_ratio: float = DEFAULT_LOAN_RATIO,
    loan_term_years: int = DEFAULT_LOAN_TERM_YEARS,
) -> dict[str, Any]:
    """공개 진입점: aiSimulationResult -> {reportData, reportHtml}."""
    data = build_report_data(
        ai_simulation_result,
        sigungu=sigungu,
        loan_ratio=loan_ratio,
        loan_term_years=loan_term_years,
    )
    return {
        "ok": True,
        "reportVersion": REPORT_VERSION,
        "reportData": data,
        "reportHtml": render_report_html(data),
    }
