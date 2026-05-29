import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import type { ContactMethod, SolarRequestFormValues } from '../lib/solarTypes';

const initialValues: SolarRequestFormValues = {
  apartmentName: '동탄 햇살마을 아파트',
  address: '경기도 화성시 동탄대로 100',
  householdCount: 620,
  roofAreaM2: 1850,
  monthlyElectricBillKrw: 4200000,
  contactMethod: 'kakao',
  contactValue: '010-1234-5678',
};

type RequestFormProps = {
  onSubmit: (values: SolarRequestFormValues) => void;
  isSaving: boolean;
};

function toNumber(value: string) {
  return Number(value.replace(/,/g, ''));
}

function RequestForm({ onSubmit, isSaving }: RequestFormProps) {
  const [values, setValues] = useState<SolarRequestFormValues>(initialValues);
  const [errorMessage, setErrorMessage] = useState('');

  function updateTextField(field: keyof Pick<SolarRequestFormValues, 'apartmentName' | 'address' | 'contactValue'>) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({ ...current, [field]: event.target.value }));
    };
  }

  function updateNumberField(field: keyof Pick<SolarRequestFormValues, 'householdCount' | 'roofAreaM2' | 'monthlyElectricBillKrw'>) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({ ...current, [field]: toNumber(event.target.value) }));
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!values.apartmentName || !values.address || !values.contactValue) {
      setErrorMessage('아파트명, 주소, 연락처를 입력해 주세요.');
      return;
    }

    if (values.householdCount <= 0 || values.roofAreaM2 <= 0 || values.monthlyElectricBillKrw <= 0) {
      setErrorMessage('세대수, 옥상 면적, 월 전기요금은 0보다 큰 값이어야 합니다.');
      return;
    }

    setErrorMessage('');
    onSubmit(values);
  }

  return (
    <section className="mvpPanel requestPanel" id="solar-request" aria-labelledby="request-title">
      <span className="panelKicker">Apartment Solar Request</span>
      <h2 id="request-title">우리 집 태양광 설치하기</h2>
      <p>입력값으로 예상 발전량, 절감액, 보조금 후보, 다음 액션을 한 번에 확인합니다.</p>

      <form className="requestForm" onSubmit={handleSubmit}>
        <label>
          아파트명
          <input value={values.apartmentName} onChange={updateTextField('apartmentName')} />
        </label>
        <label>
          주소
          <input value={values.address} onChange={updateTextField('address')} />
        </label>
        <label>
          세대수
          <input value={values.householdCount} onChange={updateNumberField('householdCount')} inputMode="numeric" />
        </label>
        <label>
          옥상 면적(㎡)
          <input value={values.roofAreaM2} onChange={updateNumberField('roofAreaM2')} inputMode="decimal" />
        </label>
        <label>
          월 공용/전기요금(원)
          <input value={values.monthlyElectricBillKrw} onChange={updateNumberField('monthlyElectricBillKrw')} inputMode="numeric" />
        </label>
        <fieldset className="contactFieldset">
          <legend>선호 알림 채널</legend>
          {(['kakao', 'sms', 'email'] as ContactMethod[]).map((method) => (
            <label key={method}>
              <input
                type="radio"
                name="contactMethod"
                value={method}
                checked={values.contactMethod === method}
                onChange={() => setValues((current) => ({ ...current, contactMethod: method }))}
              />
              {method === 'kakao' ? '카카오' : method === 'sms' ? 'SMS' : '이메일'}
            </label>
          ))}
        </fieldset>
        <label>
          연락처 또는 이메일
          <input value={values.contactValue} onChange={updateTextField('contactValue')} />
        </label>
        <button className="primaryButton mvpPrimaryButton" type="submit" disabled={isSaving}>
          {isSaving ? '저장 중' : '예상 결과 계산 및 저장'}
        </button>
        {errorMessage && <p className="formMessage isError">{errorMessage}</p>}
      </form>
    </section>
  );
}

export default RequestForm;
