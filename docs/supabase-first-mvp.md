# Supabase-first React MVP

## 방향

현재 활성 MVP는 `apps/web`의 React + TypeScript + Vite 앱에서 동작한다. Supabase Auth, PostgreSQL, Row Level Security를 사용하고, Python/FastAPI는 과거 분석 스캐폴드로만 남긴다.

프론트엔드 환경 변수는 아래 두 개만 사용한다.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Supabase service-role key는 브라우저, Vercel, `apps/web/.env.local`, Git 커밋에 넣지 않는다.

## 연결된 흐름

1. 사용자는 Supabase 이메일/비밀번호로 회원가입 또는 로그인한다.
2. `우리 아파트 태양광 설치하기` 요청서에 아파트명, 주소, 세대수, 옥상 면적, 월 전기요금, 선호 연락 채널을 입력한다.
3. TypeScript 데모 산식이 예상 발전량, 절감액, 설치비, 보조금 후보 금액, 자부담, 정책융자 한도, 회수기간, 적합도 점수를 계산한다.
4. 로그인 상태이면 `apartment_solar_requests`, `solar_simulations`, `notification_preferences`에 사용자 소유 row로 저장한다.
5. `subsidy_programs`, `install_reviews`는 공개 읽기 테이블로 표시한다.

## 정책 및 사업 문맥

```text
경기도/지자체: 태양광 예산 소진과 정책 참여 확대가 필요함
아파트/건물주: 전기요금 절감과 설치 가능성 확인이 필요함
우리 서비스: 적합지 발굴, 혜택 추정, 신청 지원, 알림 제공
수익 모델: B2G 리포트/대시보드, 설치 중개 수수료, 정책지원 운영 대행
```

공공가치:

```text
도심 내 자가발전 확대
송전 손실 완화
공동주택 에너지 비용 부담 완화
정책자금 접근성 향상
경기도/지자체 탄소중립 정책 실행 지원
```

## 아직 데모인 부분

- 발전량, 절감액, 설치비, 보조금, 융자 한도는 모두 데모 산식 기반 추정값이다.
- 정책자금 후보는 실시간 정부 공고 API가 아니라 Supabase seed/fallback 데이터다.
- Kakao/SMS/email 발송은 구현하지 않고 선호 채널과 `mock_ready` 상태만 저장한다.
- 실제 설치 가능 여부는 구조 안전, 음영, 현장 조사, 해당 연도 공고 확인이 필요하다.
