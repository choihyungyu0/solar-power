# API Contract

## GET /api/health

백엔드 상태 확인.

## POST /api/solar/simulate

### Request

```json
{
  "address": "경기도 성남시 분당구 샘플아파트",
  "buildingType": "apartment",
  "householdCount": 420,
  "roofAreaM2": 2400,
  "monthlyElectricBillKrw": 7200000,
  "shadeScore": 82,
  "roofUsableRatio": 0.42,
  "averageDailySunHours": 3.7,
  "electricityPriceKrwPerKwh": 165
}
```

### Response

```json
{
  "input": {},
  "result": {
    "suitabilityScore": 78.3,
    "suitabilityGrade": "검토 적합",
    "usableRoofAreaM2": 826.6,
    "recommendedCapacityKw": 121.6,
    "annualGenerationKwh": 134000,
    "annualSavingsKrw": 22100000,
    "estimatedInstallCostKrw": 206000000,
    "estimatedPolicySupportKrw": 58000000,
    "ownerPaymentKrw": 148000000,
    "simplePaybackYears": 6.7,
    "co2ReductionKg": 56800,
    "policyNotice": "정책지원 금액은 MVP 추정치입니다...",
    "nextActions": []
  }
}
```

## GET /api/policies

정책자금 후보 목록.

## GET /api/reviews

가입후기/도입후기 목록.

## POST /api/alerts/subscribe

카카오톡/SMS/이메일/웹 알림 신청.

## POST /api/auth/register

회원가입 목업.

## POST /api/auth/login

로그인 목업.

## POST /api/reports

리포트 저장 목업.
