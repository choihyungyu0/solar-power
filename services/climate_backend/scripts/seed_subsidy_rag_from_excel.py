from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


SCRIPT_PATH = Path(__file__).resolve()
BACKEND_ROOT = SCRIPT_PATH.parents[1]
REPO_ROOT = SCRIPT_PATH.parents[3]
EXCEL_PATH = REPO_ROOT / "data" / "policy" / "태양광_지원사업_정리.xlsx"

sys.path.insert(0, str(BACKEND_ROOT))

from app.subsidy_rag import (  # noqa: E402
    build_subsidy_chunk_text,
    generate_embedding,
    insert_subsidy_chunk,
    upsert_subsidy_document,
)


SOURCE_TITLE = "태양광 지원사업 정리"
MAIN_PROGRAM_NAME = "경기 주택태양광 지원사업"


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        normalized = (
            value.replace(",", "")
            .replace("만원", "0000")
            .replace("원", "")
            .replace("%", "")
            .strip()
        )

        if not normalized:
            return None

        try:
            return float(normalized)
        except ValueError:
            return None

    return None


def _int(value: Any) -> int | None:
    number = _number(value)

    return round(number) if number is not None else None


def _pick(row: dict[str, Any], *keywords: str) -> Any:
    for key, value in row.items():
        normalized_key = key.replace(" ", "").lower()

        if any(keyword.replace(" ", "").lower() in normalized_key for keyword in keywords):
            return value

    return None


def _extract_year(row: dict[str, Any]) -> int:
    explicit = _int(_pick(row, "연도", "년도", "year"))

    if explicit and 2000 <= explicit <= 2100:
        return explicit

    return datetime.now().year


def _normalize_program_name(row: dict[str, Any]) -> str:
    program_name = _text(_pick(row, "사업명", "지원사업", "program"))

    if "경기" in program_name and "태양광" in program_name:
        return MAIN_PROGRAM_NAME

    return program_name or MAIN_PROGRAM_NAME


def _normalize_region_sido(row: dict[str, Any]) -> str:
    value = _text(_pick(row, "시도", "광역", "region_sido", "sido"))

    if value:
        return "경기도" if value in {"경기", "경기도"} else value

    address_like = " ".join(_text(value) for value in row.values())
    return "경기도" if "경기" in address_like or "화성" in address_like else ""


def _normalize_region_sigungu(row: dict[str, Any]) -> str | None:
    value = _text(_pick(row, "시군구", "시군", "지역", "지자체", "sigungu"))

    if value and value not in {"경기도", "경기"}:
        return value

    for cell in row.values():
        text = _text(cell)

        if text.endswith("시") or text.endswith("군") or text.endswith("구"):
            return text

    return None


def _row_to_chunk(sheet_name: str, row: dict[str, Any], chunk_index: int) -> dict[str, Any]:
    program_name = _normalize_program_name(row)
    region_sido = _normalize_region_sido(row) or "경기도"
    region_sigungu = _normalize_region_sigungu(row)
    target_building_type = _text(_pick(row, "대상", "건물", "주택", "building")) or "주택/공동주택 검토"
    subsidy_amount = _int(_pick(row, "보조금", "지원금", "지원액", "subsidy_amount"))
    max_subsidy = _int(_pick(row, "최대", "한도", "max"))
    self_payment = _int(_pick(row, "자부담", "본인부담", "self"))
    subsidy_rate = _number(_pick(row, "비율", "보조율", "rate"))
    stacking_note = _text(_pick(row, "중복", "stack"))
    stacking_allowed = False if "경기" in program_name and "태양광" in program_name else None

    if stacking_note:
        stacking_allowed = not any(word in stacking_note for word in ("불가", "금지", "미지원", "안됨"))

    source_year = _extract_year(row)
    chunk = {
        "chunk_index": chunk_index,
        "chunk_type": "xlsx-row",
        "region_sido": region_sido,
        "region_sigungu": region_sigungu,
        "program_name": program_name,
        "target_building_type": target_building_type,
        "subsidy_amount_krw": subsidy_amount,
        "subsidy_rate": subsidy_rate,
        "max_subsidy_krw": max_subsidy,
        "self_payment_krw": self_payment,
        "stacking_allowed": stacking_allowed,
        "eligibility_note": _text(_pick(row, "유의", "자격", "조건", "eligibility")),
        "source_title": f"{SOURCE_TITLE} - {sheet_name}",
        "source_url": None,
        "source_year": source_year,
        "raw_payload": {
            key: _text(value)
            for key, value in row.items()
            if _text(value)
        },
        "is_active": True,
        "is_test": False,
    }
    chunk["chunk_text"] = build_subsidy_chunk_text(chunk)

    return chunk


def _load_rows() -> list[tuple[str, dict[str, Any]]]:
    try:
        from openpyxl import load_workbook
    except ImportError:
        print("openpyxl is required. Run pip install -r requirements.txt in services/climate_backend.")
        sys.exit(1)

    if not EXCEL_PATH.exists():
        print("Place 태양광_지원사업_정리.xlsx at data/policy/")
        sys.exit(1)

    workbook = load_workbook(EXCEL_PATH, read_only=True, data_only=True)
    rows: list[tuple[str, dict[str, Any]]] = []

    for worksheet in workbook.worksheets:
        iterator = worksheet.iter_rows(values_only=True)
        headers = next(iterator, None)

        if not headers:
            continue

        normalized_headers = [
            _text(header) or f"column_{index + 1}"
            for index, header in enumerate(headers)
        ]

        for raw_row in iterator:
            row = {
                normalized_headers[index]: raw_row[index] if index < len(raw_row) else None
                for index in range(len(normalized_headers))
            }

            if any(_text(value) for value in row.values()):
                rows.append((worksheet.title, row))

    return rows


def main() -> int:
    if not os.getenv("OPENAI_API_KEY", "").strip():
        print("OPENAI_API_KEY is required in the backend environment. The key value will not be printed.")
        return 1

    if os.getenv("ENABLE_SUBSIDY_RAG", "").strip().lower() != "true":
        print("ENABLE_SUBSIDY_RAG=true is required to seed embeddings.")
        return 1

    rows = _load_rows()
    documents_by_sheet: dict[str, str] = {}
    documents_inserted = 0
    chunks_inserted = 0
    failed_rows = 0

    for index, (sheet_name, row) in enumerate(rows):
        try:
            if sheet_name not in documents_by_sheet:
                document_result = upsert_subsidy_document(
                    {
                        "source_type": "xlsx",
                        "source_title": f"{SOURCE_TITLE} - {sheet_name}",
                        "source_url": None,
                        "source_year": _extract_year(row),
                        "region_sido": _normalize_region_sido(row) or "경기도",
                        "region_sigungu": _normalize_region_sigungu(row),
                        "program_name": _normalize_program_name(row),
                        "document_version": datetime.now().strftime("%Y%m%d"),
                        "raw_metadata": {
                            "sheetName": sheet_name,
                            "sourcePath": "data/policy/태양광_지원사업_정리.xlsx",
                        },
                        "is_active": True,
                        "is_test": False,
                    }
                )

                if document_result.get("ok") is not True or not isinstance(document_result.get("id"), str):
                    failed_rows += 1
                    continue

                documents_by_sheet[sheet_name] = document_result["id"]
                documents_inserted += 1

            chunk = _row_to_chunk(sheet_name, row, index)
            embedding_result = generate_embedding(chunk["chunk_text"])

            if embedding_result.get("ok") is not True:
                failed_rows += 1
                continue

            chunk["embedding"] = embedding_result["embedding"]
            chunk_result = insert_subsidy_chunk(documents_by_sheet[sheet_name], chunk)

            if chunk_result.get("ok") is True:
                chunks_inserted += 1
            else:
                failed_rows += 1
        except Exception:
            failed_rows += 1

    print(
        {
            "documentsInserted": documents_inserted,
            "chunksInserted": chunks_inserted,
            "failedRows": failed_rows,
        }
    )

    return 0 if chunks_inserted > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
