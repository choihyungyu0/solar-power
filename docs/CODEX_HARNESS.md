# Codex Harness Guide — Solar Power MVP

이 문서는 Codex를 쓰기 전에 프로젝트가 흔들리지 않도록 만드는 작업 규칙입니다.
여기서 말하는 harness는 테스트 코드만 뜻하는 게 아니라, 다음 4가지를 합친 안전장치입니다.

```txt
1. AGENTS.md: 에이전트가 반드시 지켜야 할 프로젝트 규칙
2. prompts: Codex에게 줄 작업별 프롬프트
3. scripts: 작업 후 실행할 검증 스크립트
4. supabase/migrations: DB 구조 기준점
```

---

## 1. 지금 나온 오류 정리

### 오류 1: `source .venv/bin/activate`

이 명령은 macOS/Linux용입니다.
지금 환경은 Windows PowerShell이므로 사용할 수 없습니다.

그리고 현재 MVP는 Supabase + React + TypeScript 중심으로 갈 예정이라, FastAPI 가상환경을 먼저 해결할 필요가 없습니다.

---

### 오류 2: `pydantic-core` 빌드 실패

FastAPI 쪽 의존성 설치 중 `pydantic-core`가 로컬에서 빌드되면서 MSVC 빌드 도구를 찾는 오류입니다.
하지만 현재 목표는 Supabase 기반 프론트 MVP이므로, 이 오류는 우선순위가 낮습니다.

지금은 `apps/api`가 아니라 `apps/web`을 실행하세요.

---

### 오류 3: `npm.ps1` 실행 정책 오류

PowerShell에서 `npm`을 입력하면 `npm.ps1` 스크립트가 실행되는데, Windows 실행 정책 때문에 막힐 수 있습니다.
이럴 때는 아래처럼 `npm.cmd`를 사용하면 됩니다.

```powershell
cd apps/web
npm.cmd install
npm.cmd run dev
```

또는 현재 터미널 세션에서만 실행 정책을 완화할 수 있습니다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
npm install
npm run dev
```

초보자 기준으로는 `npm.cmd` 방식이 덜 위험하고 간단합니다.

---

### 오류 4: `npm.cmd.install`

이건 명령어 오타입니다.

틀린 명령:

```powershell
npm.cmd.install
```

맞는 명령:

```powershell
npm.cmd install
```

`npm.cmd`와 `install` 사이에 공백이 있어야 합니다.

---

## 2. 현재 권장 실행 순서

루트 폴더에서 시작합니다.

```powershell
cd C:\Users\Administrator\desktop\solar-power-starter
```

프론트엔드 폴더로 이동합니다.

```powershell
cd apps\web
```

패키지를 설치합니다.

```powershell
npm.cmd install
```

개발 서버를 실행합니다.

```powershell
npm.cmd run dev
```

빌드 검증은 다음으로 합니다.

```powershell
npm.cmd run build
```

---

## 3. Codex 작업 전 준비

Codex에게 바로 “서비스 만들어줘”라고 던지면 범위가 커져서 실패할 가능성이 큽니다.
아래 순서대로 작게 시키세요.

```txt
1. 현재 프로젝트 구조 점검만 해줘. 파일 수정 금지.
2. Supabase 연결 파일과 env 예시만 추가해줘.
3. 로그인/회원가입 UI를 Supabase Auth에 연결해줘.
4. 아파트 태양광 신청 폼을 DB에 저장해줘.
5. 신청 결과를 기반으로 예상 발전량/절감액 카드를 보여줘.
6. 정책자금/후기 데이터를 Supabase 테이블에서 읽게 해줘.
7. 전체 빌드 오류를 수정하고 변경사항을 요약해줘.
```

---

## 4. Codex에게 항상 붙일 공통 지시문

아래 문장을 작업 프롬프트 앞에 붙이세요.

```txt
먼저 AGENTS.md와 docs/CODEX_HARNESS.md를 읽어라.
이 프로젝트는 React + TypeScript + Vite + Supabase 기반 MVP다.
FastAPI 폴더는 사용자가 별도로 요청하지 않는 한 수정하지 마라.
Windows PowerShell 환경이므로 검증 명령은 npm.cmd를 기준으로 작성하라.
작업 전에는 짧은 계획을 제시하고, 작업 후에는 수정한 파일과 실행한 검증 명령을 요약하라.
```

---

## 5. 권장 Codex 작업 순서

### 1단계: 프로젝트 점검

사용 프롬프트:

```txt
.codex/prompts/00-first-run-project-audit.md
```

결과 목표:

```txt
현재 구조 확인
문제점 목록화
수정 계획 수립
파일 수정 없음
```

### 2단계: Supabase 기본 연결

사용 프롬프트:

```txt
.codex/prompts/01-supabase-foundation.md
```

결과 목표:

```txt
@supabase/supabase-js 설치
src/lib/supabase.ts 생성
.env.example 정리
Supabase 마이그레이션 SQL 추가
```

### 3단계: Auth 연결

사용 프롬프트:

```txt
.codex/prompts/02-auth-flow.md
```

결과 목표:

```txt
회원가입
로그인
로그아웃
현재 사용자 표시
```

### 4단계: 아파트 태양광 신청 저장

사용 프롬프트:

```txt
.codex/prompts/03-apartment-solar-request.md
```

결과 목표:

```txt
신청 폼 입력값 검증
Supabase DB 저장
사용자별 신청 내역 표시
```

### 5단계: 시뮬레이션 결과 저장

사용 프롬프트:

```txt
.codex/prompts/04-solar-simulation-result.md
```

결과 목표:

```txt
예상 발전량 계산
예상 절감액 계산
예상 보조금 표시
결과 저장
```

### 6단계: 랜딩 페이지 디테일 강화

사용 프롬프트:

```txt
.codex/prompts/05-landing-service-detail.md
```

결과 목표:

```txt
서비스 소개 강화
도심 속 태양광 시각화 강화
가입후기 섹션 강화
정책자금 안내 강화
```

### 7단계: 최종 점검

사용 프롬프트:

```txt
.codex/prompts/99-final-review.md
```

결과 목표:

```txt
빌드 성공
타입 오류 없음
민감키 노출 없음
수정사항 요약
남은 작업 정리
```

---

## 6. 작업 후 보고 형식

Codex가 작업을 끝내면 아래 형식으로 답하게 하세요.

```txt
작업 요약:
- ...

수정한 파일:
- ...

실행한 검증:
- npm.cmd run build: 성공/실패

주의할 점:
- ...

다음 추천 작업:
- ...
```

---

## 7. 중요한 보안 기준

Supabase를 쓸 때 가장 중요한 것은 키 관리입니다.

프론트엔드에서 사용 가능한 키:

```txt
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

프론트엔드에 넣으면 안 되는 키:

```txt
service_role key
database password
JWT secret
```

`.env.local`은 개인 PC에만 둡니다.
GitHub에는 올리지 않습니다.

---

## 8. 초보자 기준 최종 목표

처음부터 완벽한 AI 예측 서비스를 만들려고 하지 마세요.
먼저 아래 5개가 되면 MVP입니다.

```txt
1. 사이트가 실행된다.
2. 회원가입/로그인이 된다.
3. 우리 아파트 태양광 설치하기 폼이 저장된다.
4. 예상 발전량/절감액/보조금 결과가 보인다.
5. 결과 리포트를 다시 조회할 수 있다.
```

이 5개 이후에 지도, 공공데이터 API, AI 예측, 카카오톡/SMS 실제 발송을 붙입니다.
