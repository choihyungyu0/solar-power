# 데이터 소스 목록

사용자가 제안한 데이터 링크를 MVP 기준으로 정리했습니다.

## 태양광/일사량/적지

- 경기기후플랫폼 태양광 도입 시뮬레이션: https://climate.gg.go.kr/ips/engy/solar-adoption
- 경기도 태양광 발전소 허가정보: https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=VI0D9IY634MNRGJITBI527985650
- AI Hub 태양광 적지 분석 데이터: https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&dataSetSn=71348
- 기상청 태양광 발전량 예측: https://bd.kma.go.kr/kma2020/fs/energySelect1.do
- 신재생에너지 데이터센터 표준기상년: https://www.kses.re.kr/staticdata/static/reference-room/weather-data/
- 환경 빅데이터 태양광·일조량 융합 데이터: https://www.bigdata-environment.kr/user/data_market/detail.do?id=27449c80-20ff-11ec-a070-ab81432fd4e1

## 건축물·부동산·규제

- 건축HUB 건축물대장 API: https://www.data.go.kr/data/15134735/openapi.do
- 경기부동산포털 건물 표제부: https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=ZGLF3ZTG8FN6AWAN96MR34191962
- 경기부동산포털 건물 총괄표제부: https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=SVTOOYGZR861O3HGNCET34183944
- 국토부 NSDI 용도지역지구·지구단위계획: http://www.nsdi.go.kr/lxportal/?menuno=4077

## 전력가격·수요

- 전력거래소 SMP 실시간 API: https://www.data.go.kr/data/15076302/openapi.do
- 한전 월별 신재생에너지 SMP: https://www.data.go.kr/data/3068370/fileData.do
- 한국중부발전 SMP REC 기준가격: https://www.data.go.kr/data/15119675/fileData.do
- 한전 가중평균 SMP: https://www.data.go.kr/data/15116815/fileData.do
- 전력거래소 EPSIS: https://epsis.kpx.or.kr/
- 시간별 전국 전력수요량: https://www.data.go.kr/data/15065266/fileData.do
- 한국남동발전 시간대별 태양광 발전실적: https://www.koenergy.kr/kosep/gv/nf/dt/nfdt21/main.do

## 건물 전력 사용량

- 국토부 건축HUB 건물에너지정보: https://www.data.go.kr/data/15135963/openapi.do
- 국토부 건물에너지 전기에너지: https://www.data.go.kr/data/15054214/fileData.do
- 한전 산업분류별 시군구 월별 사용량: https://www.data.go.kr/dataset/15031941/fileData.do
- 한전 EDS 전력사용량 수집 통계: https://www.data.go.kr/data/15131531/fileData.do

## 정책·보조금

- 경기도 주택태양광 지원시스템: https://ggre100home.or.kr/
- 경기환경에너지진흥원: https://www.ggenergy.or.kr/
- 한국에너지공단 신재생에너지센터 주택지원: https://www.knrec.or.kr/biz/introduce/new_engy/intro_home.do
- 경기환경에너지진흥원 베란다형 미니태양광: https://www.ggenergy.or.kr/energy/content/business/business02_01_03

## 구현 우선순위

1. 정책·보조금 후보 DB
2. 건축물대장/건물에너지정보
3. 기상·일사량/태양광 발전량 예측
4. 경기기후플랫폼 시뮬레이션 벤치마크
5. SMP/REC/전력가격
6. 규제지역/용도지역
