from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services.solar_calculator import SolarInput, calculate_solar_plan

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT_DIR / "data" / "seed"

app = FastAPI(
    title="Solar Power MVP API",
    version="0.1.0",
    description="우리 아파트 태양광 설치하기 MVP API",
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegisterRequest(BaseModel):
    name: str = Field(..., examples=["최현규"])
    email: str = Field(..., examples=["user@example.com"])
    password: str = Field(..., min_length=6)
    userType: Literal["resident", "building_owner", "public_officer", "installer"] = "resident"


class LoginRequest(BaseModel):
    email: str
    password: str


class AlertRequest(BaseModel):
    name: str
    phoneOrEmail: str
    channel: Literal["kakao", "sms", "email", "web"] = "kakao"
    address: str
    topic: Literal["policy", "simulation", "document", "all"] = "all"


class SavedReportRequest(BaseModel):
    userId: str
    title: str
    simulation: dict


def load_seed_json(filename: str):
    path = SEED_DIR / filename
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "solar-power-api", "version": "0.1.0"}


@app.get("/api/policies")
def list_policies():
    """정책자금 후보 목록. 실제 금액은 연도별 공고/관리자 DB로 갱신한다."""
    return {"items": load_seed_json("policy_sources.json")}


@app.get("/api/reviews")
def list_reviews():
    return {"items": load_seed_json("reviews.json")}


@app.get("/api/datasets")
def list_datasets():
    return {"items": load_seed_json("data_sources.json")}


@app.post("/api/solar/simulate")
def simulate_solar_installation(payload: SolarInput):
    """우리 아파트 태양광 설치하기 핵심 계산 API."""
    return calculate_solar_plan(payload)


@app.post("/api/auth/register")
def register(payload: RegisterRequest):
    # MVP: 실제 인증 전까지 목업 토큰 반환. 이후 Supabase/Auth.js/JWT 등으로 교체.
    return {
        "userId": "mock-user-001",
        "name": payload.name,
        "email": payload.email,
        "userType": payload.userType,
        "token": "mock-token-register",
        "message": "회원가입 목업 완료: 실제 DB 연동 전입니다.",
    }


@app.post("/api/auth/login")
def login(payload: LoginRequest):
    return {
        "userId": "mock-user-001",
        "email": payload.email,
        "token": "mock-token-login",
        "message": "로그인 목업 완료: 실제 인증 연동 전입니다.",
    }


@app.post("/api/alerts/subscribe")
def subscribe_alert(payload: AlertRequest):
    return {
        "subscriptionId": "alert-mock-001",
        "channel": payload.channel,
        "topic": payload.topic,
        "status": "subscribed",
        "message": "알림 신청이 저장되었습니다. 실제 카카오/SMS 발송은 API 키 연동 후 활성화합니다.",
    }


@app.post("/api/reports")
def save_report(payload: SavedReportRequest):
    return {
        "reportId": "report-mock-001",
        "userId": payload.userId,
        "title": payload.title,
        "status": "saved",
        "message": "리포트 저장 목업 완료: 실제 DB 연동 전입니다.",
    }
