import os
from functools import lru_cache
from typing import Any


ANALYSIS_RESULTS_TABLE = "analysis_results"
CONSULTATION_REQUESTS_TABLE = "consultation_requests"
SIMULATION_TRAINING_SAMPLES_TABLE = "simulation_training_samples"


def is_supabase_enabled() -> bool:
    return os.getenv("ENABLE_SUPABASE_WRITE", "").strip().lower() == "true"


def _safe_disabled_result(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "enabled": False,
        "reason": reason,
        "errorType": "SupabaseDisabled",
    }


def _safe_failure_result(error: Exception) -> dict[str, Any]:
    return {
        "ok": False,
        "enabled": True,
        "reason": "Supabase request failed.",
        "errorType": type(error).__name__,
        "error": str(error),
    }


@lru_cache(maxsize=1)
def get_supabase_client() -> Any | None:
    if not is_supabase_enabled():
        return None

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not supabase_url or not service_role_key:
        return None

    from supabase import create_client

    return create_client(supabase_url, service_role_key)


def _get_enabled_client() -> tuple[Any | None, dict[str, Any] | None]:
    if not is_supabase_enabled():
        return None, _safe_disabled_result("ENABLE_SUPABASE_WRITE is not true.")

    if not os.getenv("SUPABASE_URL", "").strip():
        return None, _safe_disabled_result("SUPABASE_URL is missing.")

    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip():
        return None, _safe_disabled_result("SUPABASE_SERVICE_ROLE_KEY is missing.")

    try:
        client = get_supabase_client()
    except Exception as error:
        return None, _safe_failure_result(error)

    if client is None:
        return None, _safe_disabled_result("Supabase client is not configured.")

    return client, None


def _insert_row(table_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    client, disabled_or_failed = _get_enabled_client()

    if disabled_or_failed:
        return disabled_or_failed

    try:
        response = client.table(table_name).insert(payload).execute()
        data = response.data if isinstance(response.data, list) else []
        row = data[0] if data and isinstance(data[0], dict) else {}
        row_id = row.get("id") if isinstance(row.get("id"), str) else None

        return {
            "ok": True,
            "enabled": True,
            "id": row_id,
        }
    except Exception as error:
        return _safe_failure_result(error)


def save_analysis_result(row: dict[str, Any]) -> dict[str, Any]:
    return _insert_row(ANALYSIS_RESULTS_TABLE, row)


def save_training_sample(row: dict[str, Any]) -> dict[str, Any]:
    return _insert_row(SIMULATION_TRAINING_SAMPLES_TABLE, row)


def save_consultation_request(row: dict[str, Any]) -> dict[str, Any]:
    return _insert_row(CONSULTATION_REQUESTS_TABLE, row)


def _check_table_readable(table_name: str) -> bool:
    client, disabled_or_failed = _get_enabled_client()

    if disabled_or_failed or client is None:
        return False

    try:
        client.table(table_name).select("id").limit(1).execute()
        return True
    except Exception:
        return False


def check_supabase_health() -> dict[str, Any]:
    enabled = (
        is_supabase_enabled()
        and bool(os.getenv("SUPABASE_URL", "").strip())
        and bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip())
    )
    tables = {
        ANALYSIS_RESULTS_TABLE: False,
        CONSULTATION_REQUESTS_TABLE: False,
        SIMULATION_TRAINING_SAMPLES_TABLE: False,
    }

    if enabled:
        tables = {table_name: _check_table_readable(table_name) for table_name in tables}

    return {
        "ok": True,
        "supabaseEnabled": enabled,
        "canConnect": enabled and any(tables.values()) and all(tables.values()),
        "tables": tables,
    }


create_db_health_status = check_supabase_health
