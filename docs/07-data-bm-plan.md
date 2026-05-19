# 07. 데이터·비즈니스 모델 계획

## 데이터 활용 방향

MVP에서는 모든 데이터를 실시간으로 완전 연동하지 않고, 다음 3단계로 나눈다.

### 1단계: 정적 데이터 + 목업 계산

- 정책자금 후보 JSON
- 데이터 출처 목록
- 단순 태양광 발전량 계산식
- 도심형 UI 시각화

목적: 공모전 시연과 서비스 흐름 검증.

### 2단계: 공공데이터 API 연동

- 경기기후플랫폼 태양광 도입 시뮬레이션 참고
- 경기도 태양광 발전소 허가정보
- 건축물대장 API
- 건물에너지정보
- 기상/일사량 데이터
- SMP/REC 가격 데이터
- 경기도/한국에너지공단 정책 공고

목적: 적합도·예상 발전량·경제성 산출의 신뢰도 향상.

### 3단계: 고도화 데이터/모델

- 항공사진/DSM/DEM 기반 음영 분석
- 옥상 자동 추출
- 패널 배치 최적화
- 세대별/공용부 전기사용 패턴 분석
- 보조금 예산 소진 예측
- 지자체 대상 설치 후보 우선순위화

## 주요 데이터 테이블 설계

### buildings

```csv
building_id,address,building_type,household_count,roof_area_m2,usable_roof_area_m2,latitude,longitude,admin_region
```

### solar_simulations

```csv
simulation_id,user_id,building_id,shade_score,capacity_kw,annual_generation_kwh,annual_savings_krw,payback_years,created_at
```

### policy_programs

```csv
policy_id,name,region,target,amount_type,amount_text,application_period,status,source_url,updated_at
```

### alert_subscriptions

```csv
subscription_id,user_id,building_id,channel,topic,status,created_at
```

### reports

```csv
report_id,user_id,building_id,title,summary_json,created_at
```

## 적합도 점수 초안

```txt
태양광 설치 적합도 =
음영/일조 점수 45%
+ 세대수 대비 옥상면적 점수 35%
+ 전기요금 절감 잠재력 20%
```

향후에는 다음 피처를 추가한다.

- 지붕 방향/경사
- 주변 고층건물 음영
- 규제지역 여부
- 건물 구조/방수 리스크
- 공용부 전기사용량
- 정책자금 신청 가능성
- 전력가격/SMP/REC 조건

## 비즈니스 모델

### B2G: 경기도·시군 대상 정책 예산 소진 솔루션

가치:

- 태양광 설치 적합 후보지 발굴
- 예산 소진 가능성이 높은 단지 우선순위화
- 신청 독려/알림 자동화
- 사업 성과 리포트 생성

수익:

- 지자체 SaaS 구독
- 설치 후보 분석 리포트 납품
- 정책사업 운영 대행/성과관리

### B2C/B2B: 공동주택·건물주 대상 설치 검토 리포트

가치:

- 예상 절감액과 비용 확인
- 보조금 후보 안내
- 필요서류 체크리스트
- 입주자대표회의 공유용 리포트

수익:

- 프리미엄 리포트
- 시공사 연결 수수료
- 금융/대출 연계 수수료

### 금융 연계: 태양광 발전 담보/절감액 기반 대출

아이디어:

- 소상공인 카드 결제 기반 대출처럼, 태양광 발전량/전기요금 절감액을 현금흐름 근거로 활용
- 발전설비 담보 또는 절감액 기반 상환 모델 검토

주의:

- 실제 금융상품은 인허가·심사·제휴가 필요하므로 MVP에서는 “금융 가능성 상담 신청”까지만 구현

## 수익성 메시지

사용자에게는 다음 순서로 설득한다.

1. 전기요금 부담이 커진다.
2. 자가발전으로 공용 전기요금 절감 가능성이 있다.
3. 정책자금/보조금 신청을 놓치지 않도록 돕는다.
4. 우리 서비스가 예상 혜택·비용·서류·알림까지 한 번에 제공한다.

## MVP 성공 기준

- 주소/건물 입력 후 1분 안에 결과 생성
- 예상 절감액/정책자금 후보/다음 액션 표시
- 알림 신청까지 연결
- 공모전 발표에서 “이 비즈니스가 어떻게 동작하는지” 설명 가능
