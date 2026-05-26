from __future__ import annotations

import os
from typing import Any

from .supabase_client import (
    insert_subsidy_chunk as insert_subsidy_chunk_row,
    insert_subsidy_document as insert_subsidy_document_row,
    match_subsidy_chunks,
)


DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_MATCH_COUNT = 5
MAIN_SUBSIDY_PROGRAM_NAME = "경기 주택태양광 지원사업"


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _as_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        normalized = value.replace(",", "").replace("원", "").replace("%", "").strip()

        if not normalized:
            return None

        try:
            return float(normalized)
        except ValueError:
            return None

    return None


def _as_int(value: Any) -> int | None:
    number = _as_float(value)

    return round(number) if number is not None else None


def _rag_enabled() -> bool:
    return os.getenv("ENABLE_SUBSIDY_RAG", "").strip().lower() == "true"


def _embedding_model() -> str:
    return os.getenv("SUBSIDY_EMBEDDING_MODEL", "").strip() or DEFAULT_EMBEDDING_MODEL


def _disabled_result(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "ragEnabled": False,
        "message": "보조금 RAG가 비활성화되어 있습니다.",
        "reason": reason,
        "matches": [],
    }


def build_subsidy_chunk_text(row: dict[str, Any]) -> str:
    parts = [
        f"사업명: {_as_text(row.get('program_name')) or MAIN_SUBSIDY_PROGRAM_NAME}",
        f"지역: {_as_text(row.get('region_sido')) or '경기도'} {_as_text(row.get('region_sigungu'))}".strip(),
        f"대상: {_as_text(row.get('target_building_type')) or '주택/공동주택 검토'}",
    ]

    subsidy_amount = _as_int(row.get("subsidy_amount_krw"))
    subsidy_rate = _as_float(row.get("subsidy_rate"))
    max_subsidy = _as_int(row.get("max_subsidy_krw"))
    self_payment = _as_int(row.get("self_payment_krw"))

    if subsidy_amount is not None:
        parts.append(f"보조금 금액: {subsidy_amount:,}원")

    if subsidy_rate is not None:
        parts.append(f"보조율: {subsidy_rate:g}%")

    if max_subsidy is not None:
        parts.append(f"최대 보조금: {max_subsidy:,}원")

    if self_payment is not None:
        parts.append(f"자부담: {self_payment:,}원")

    if row.get("stacking_allowed") is not None:
        stacking_text = "가능" if row.get("stacking_allowed") is True else "불가"
        parts.append(f"중복 지원: {stacking_text}")

    if _as_text(row.get("eligibility_note")):
        parts.append(f"자격/유의사항: {_as_text(row.get('eligibility_note'))}")

    if _as_text(row.get("source_title")):
        parts.append(f"출처: {_as_text(row.get('source_title'))}")

    if row.get("source_year"):
        parts.append(f"기준연도: {row.get('source_year')}")

    raw_payload = row.get("raw_payload")
    if isinstance(raw_payload, dict):
        extra_text = " ".join(
            f"{key}: {_as_text(value)}"
            for key, value in raw_payload.items()
            if _as_text(value)
        )

        if extra_text:
            parts.append(f"원문 행: {extra_text[:1200]}")

    return "\n".join(parts)


def generate_embedding(text: str) -> dict[str, Any]:
    if not _rag_enabled():
        return _disabled_result("ENABLE_SUBSIDY_RAG is not true.")

    api_key = os.getenv("OPENAI_API_KEY", "").strip()

    if not api_key:
        return _disabled_result("OPENAI_API_KEY is missing.")

    try:
        from openai import OpenAI
    except Exception:
        return _disabled_result("OpenAI SDK is not installed.")

    try:
        client = OpenAI(api_key=api_key, timeout=20)
        response = client.embeddings.create(
            model=_embedding_model(),
            input=text[:8000],
        )
        embedding = response.data[0].embedding if response.data else None

        if not isinstance(embedding, list) or not embedding:
            return {
                "ok": False,
                "ragEnabled": True,
                "message": "보조금 임베딩 생성에 실패했습니다.",
                "errorType": "EmptyEmbedding",
            }

        return {
            "ok": True,
            "ragEnabled": True,
            "embedding": embedding,
            "model": _embedding_model(),
        }
    except Exception as error:
        return {
            "ok": False,
            "ragEnabled": True,
            "message": "보조금 임베딩 생성에 실패했습니다.",
            "errorType": type(error).__name__,
        }


def upsert_subsidy_document(metadata: dict[str, Any]) -> dict[str, Any]:
    return insert_subsidy_document_row(metadata)


def insert_subsidy_chunk(document_id: str, chunk: dict[str, Any]) -> dict[str, Any]:
    payload = {
        **chunk,
        "document_id": document_id,
    }

    return insert_subsidy_chunk_row(payload)


def _format_match(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "documentId": row.get("document_id"),
        "chunkText": row.get("chunk_text"),
        "programName": row.get("program_name"),
        "regionSido": row.get("region_sido"),
        "regionSigungu": row.get("region_sigungu"),
        "subsidyAmountKrw": row.get("subsidy_amount_krw"),
        "subsidyRate": row.get("subsidy_rate"),
        "maxSubsidyKrw": row.get("max_subsidy_krw"),
        "selfPaymentKrw": row.get("self_payment_krw"),
        "stackingAllowed": row.get("stacking_allowed"),
        "sourceTitle": row.get("source_title"),
        "sourceUrl": row.get("source_url"),
        "sourceYear": row.get("source_year"),
        "similarity": row.get("similarity"),
    }


def search_subsidy_chunks(
    query: str,
    region_sido: str | None = None,
    region_sigungu: str | None = None,
    match_count: int = DEFAULT_MATCH_COUNT,
) -> dict[str, Any]:
    if not _rag_enabled():
        return _disabled_result("ENABLE_SUBSIDY_RAG is not true.")

    embedding_result = generate_embedding(query)

    if embedding_result.get("ok") is not True or not isinstance(embedding_result.get("embedding"), list):
        return {
            **embedding_result,
            "query": query,
            "matches": [],
        }

    match_result = match_subsidy_chunks(
        query_embedding=embedding_result["embedding"],
        match_count=max(1, min(match_count, 10)),
        filter_region_sido=region_sido,
        filter_region_sigungu=region_sigungu,
    )

    if match_result.get("ok") is not True:
        return {
            "ok": False,
            "ragEnabled": True,
            "query": query,
            "message": "보조금 RAG 검색에 실패했습니다.",
            "errorType": match_result.get("errorType"),
            "reason": match_result.get("reason"),
            "matches": [],
        }

    matches = [
        _format_match(row)
        for row in match_result.get("matches", [])
        if isinstance(row, dict)
    ]

    return {
        "ok": True,
        "ragEnabled": True,
        "query": query,
        "embeddingModel": embedding_result.get("model"),
        "matches": matches,
    }


def _get_path(value: dict[str, Any], *keys: str) -> Any:
    current: Any = value

    for key in keys:
        if not isinstance(current, dict):
            return None

        current = current.get(key)

    return current


def _extract_region(agent_payload: dict[str, Any]) -> tuple[str, str | None]:
    location = _get_path(agent_payload, "subsidyRagInput", "location")
    address = ""

    if isinstance(location, dict):
        address = _as_text(location.get("roadAddress") or location.get("jibunAddress"))
    elif isinstance(location, str):
        address = location

    region_sido = "경기도" if "경기" in address or not address else address.split()[0]
    region_sigungu = None
    parts = address.split()

    if len(parts) >= 2 and parts[0].startswith("경기"):
        region_sigungu = parts[1]

    return region_sido, region_sigungu


def build_subsidy_rag_query(
    agent_payload: dict[str, Any],
    report_input_metrics: dict[str, Any],
) -> dict[str, Any]:
    region_sido, region_sigungu = _extract_region(agent_payload)
    install_capacity_kw = (
        _get_path(agent_payload, "simulationInput", "installCapacityKw")
        or _get_path(agent_payload, "reportInputMetrics", "installCapacityKw")
        or report_input_metrics.get("installCapacityKw")
    )
    building_usage = (
        _get_path(agent_payload, "subsidyRagInput", "buildingUsage")
        or _get_path(agent_payload, "building", "usage")
        or "공동주택"
    )
    query = " ".join(
        part
        for part in (
            region_sido,
            region_sigungu,
            MAIN_SUBSIDY_PROGRAM_NAME,
            _as_text(building_usage),
            f"설치용량 {install_capacity_kw}kW" if install_capacity_kw else "",
            "보조금 자부담 중복 지원 여부",
            "gyeonggi_home_solar_only",
        )
        if _as_text(part)
    )

    return {
        "query": query,
        "regionSido": region_sido,
        "regionSigungu": region_sigungu,
        "buildingUsage": building_usage,
        "installCapacityKw": install_capacity_kw,
    }


def build_subsidy_rag_context(matches_result: dict[str, Any]) -> dict[str, Any]:
    matches = matches_result.get("matches") if isinstance(matches_result.get("matches"), list) else []

    return {
        "enabled": matches_result.get("ok") is True and matches_result.get("ragEnabled") is True and len(matches) > 0,
        "ragEnabled": matches_result.get("ragEnabled") is True,
        "query": matches_result.get("query") if isinstance(matches_result.get("query"), str) else "",
        "matches": matches,
        "message": matches_result.get("message"),
        "errorType": matches_result.get("errorType"),
    }
