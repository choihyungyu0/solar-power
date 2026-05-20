# Solar Power — 우리아파트 태양광 설치하기 MVP

경기도 도심/공동주택 태양광 도입을 돕는 **가상설치·정책자금·예상절감·알림형 리포트 서비스** 초기 개발 레포입니다.

핵심 데모는 사용자가 아파트/공동주택 정보를 입력하면 다음을 보여주는 것입니다.

- 태양광 설치 적합도
- 예상 설치용량, 발전량, 전기요금 절감액
- 받을 수 있는 정책지원 후보
- 카카오톡/SMS/웹 알림 신청
- 가입/로그인 후 리포트 저장
- 도심 속 태양광 시각화 UI

> 현재 정책자금 금액은 연도/지자체 공고에 따라 바뀌므로, MVP에서는 “정책 DB 연동 전 후보 안내” 형태로 제공합니다. 실제 공고 금액은 API/관리자 DB로 업데이트하는 구조입니다.

---

## 1. 프로젝트 구조

```txt
solar-power/
├── apps/
│   ├── api/                    # FastAPI 백엔드
│   │   ├── main.py
│   │   ├── services/
│   │   └── pyproject.toml
│   └── web/                    # Vite + React 프론트엔드
│       ├── src/
│       ├── package.json
│       └── index.html
├── data/
│   ├── raw/.gitkeep
│   ├── processed/.gitkeep
│   └── seed/                   # 데모용 정책/후기/데이터소스
├── docs/
│   ├── 01-service-overview.md
│   ├── 07-data-bm-plan.md
│   ├── api-contract.md
│   └── data-sources.md
├── scripts/
│   └── bootstrap_repo.sh
├── .env.example
├── .gitignore
└── package.json
```

---

## 2. 로컬 실행

### 백엔드

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e .
uvicorn main:app --reload --port 8000
```

확인:

```bash
curl http://localhost:8000/api/health
```

### 프론트엔드

```bash
cd apps/web
npm install
npm run dev
```

기본 접속:

```txt
http://localhost:5173
```

프론트는 기본적으로 `http://localhost:8000`의 API를 호출합니다. 필요하면 `.env`에 아래 값을 넣으세요.

```bash
VITE_API_BASE_URL=http://localhost:8000
```

### VWorld 지도/공간정보 프록시 로컬 테스트

`npm.cmd run dev`는 Vite 개발 서버만 5173 포트에서 실행하므로 `apps/web/api/*` Vercel Function은 함께 뜨지 않습니다.
`/api/vworld-feature`까지 로컬에서 확인하려면 아래처럼 Vercel dev 서버로 실행하세요.

```powershell
cd apps\web
npx vercel dev
```

그 다음 아래 주소로 접속합니다.

```txt
http://localhost:3000/risk-map
```

로컬 테스트 시 `apps/web/.env.local` 또는 Vercel 로컬 환경에 아래 값을 설정합니다.

```env
VITE_VWORLD_BUILDING_DATA_ID=LP_PA_CBND_BUBUN
VWORLD_API_KEY=your_server_side_vworld_key
VWORLD_DOMAIN=http://localhost:5173
```

---

## 3. GitHub 레포 연결/초기 커밋

빈 레포에 이 스타터를 넣는 흐름입니다.

```bash
git clone https://github.com/choihyungyu0/solar-power.git
cd solar-power

# 다운로드한 starter 파일 전체를 현재 폴더로 복사
# 예: macOS/Linux
rsync -av /path/to/solar-power-starter/ ./

# Git 초기 커밋
git add .
git commit -m "chore: initialize solar power MVP scaffold"
git push -u origin main
```

압축 파일을 풀어서 복사하는 경우, `solar-power-starter` 폴더 안의 내용물만 레포 루트에 넣으면 됩니다.

---

## 4. MVP 기능 우선순위

1. **서비스 소개/랜딩**: 도심 속 태양광, 전기요금 상승, 보조금 지원, 자가발전 이득 메시지
2. **우리 아파트 태양광 설치하기**: 주소/건물유형/옥상면적/세대수/월 전기요금 입력 → 예상 결과
3. **정책자금 안내**: 후보 정책, 신청 가능성, 필요서류, 업데이트 필요 여부
4. **알림 신청**: 실시간이 아니어도 카카오톡/SMS/이메일/웹 알림 신청
5. **회원가입/로그인 목업**: 리포트 저장, 알림 설정 기반
6. **가입후기**: 도입 후 절감/공공성/관리 편의성 스토리
7. **데이터·BM 문서화**: 서류 1번/7번 작성에 바로 활용

---

## 5. 다음 개발 단위

- `apps/api/services/solar_calculator.py`의 단순 계산식을 실제 일사량·건물에너지·정책 DB와 연결
- `data/seed/policy_sources.json`를 관리자 입력/크롤링/공공데이터 API 기반 DB로 교체
- 카카오 알림톡/SMS는 실제 발송 전까지 `/api/alerts/subscribe` 저장형 API로 대체
- 지도/3D는 MVP에서 카드형 시각화 → 이후 지도 SDK/3D Tiles/DSM 기반으로 확장
