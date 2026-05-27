import type { SupabaseClient, User } from '@supabase/supabase-js';

export const PRIVACY_CONSENT_VERSION = 'privacy-v1-mvp';

export type MemberProfileValues = {
  name: string;
  birthDate: string;
  phone: string;
  email: string;
};

export type MemberPrivacyConsent = {
  privacyAgreed: boolean;
  privacyAgreedAt: string | null;
  privacyConsentVersion: string | null;
};

export type MemberProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  birth_date: string | null;
  privacy_agreed: boolean | null;
  privacy_agreed_at: string | null;
  privacy_consent_version: string | null;
};

export type SaveMemberProfileOptions = {
  privacyAgreed: boolean;
  privacyAgreedAt: string | null;
  privacyConsentVersion: string;
};

export const emptyPrivacyConsent: MemberPrivacyConsent = {
  privacyAgreed: false,
  privacyAgreedAt: null,
  privacyConsentVersion: null,
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDate(value: string) {
  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue : null;
}

function normalizeProfileText(value: string) {
  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue : null;
}

export function toProfileValues(row: MemberProfileRow | null, user: User | null, fallback: MemberProfileValues): MemberProfileValues {
  return {
    name: row?.name?.trim() || fallback.name,
    birthDate: row?.birth_date || fallback.birthDate,
    phone: row?.phone?.trim() || fallback.phone,
    email: row?.email?.trim() || user?.email || fallback.email,
  };
}

export function toPrivacyConsent(row: MemberProfileRow | null): MemberPrivacyConsent {
  return {
    privacyAgreed: row?.privacy_agreed === true,
    privacyAgreedAt: row?.privacy_agreed_at ?? null,
    privacyConsentVersion: row?.privacy_consent_version ?? null,
  };
}

export function createPrivacyConsentMetadata(name: string, birthDate = '', phone = '') {
  return {
    name: name.trim(),
    birth_date: birthDate.trim(),
    phone: phone.trim(),
    privacy_agreed: true,
    privacy_agreed_at: new Date().toISOString(),
    privacy_consent_version: PRIVACY_CONSENT_VERSION,
  };
}

export async function loadMemberProfile(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('id,email,name,phone,birth_date,privacy_agreed,privacy_agreed_at,privacy_consent_version')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`회원정보 불러오기 실패: ${getErrorMessage(error)}`);
  }

  return (data ?? null) as MemberProfileRow | null;
}

export async function saveMemberProfile(
  client: SupabaseClient,
  userId: string,
  values: MemberProfileValues,
  options: SaveMemberProfileOptions,
) {
  const privacyAgreedAt = options.privacyAgreed
    ? options.privacyAgreedAt ?? new Date().toISOString()
    : null;

  const { data, error } = await client
    .from('profiles')
    .upsert(
      {
        id: userId,
        email: normalizeProfileText(values.email),
        name: normalizeProfileText(values.name),
        phone: normalizeProfileText(values.phone),
        birth_date: normalizeDate(values.birthDate),
        privacy_agreed: options.privacyAgreed,
        privacy_agreed_at: privacyAgreedAt,
        privacy_consent_version: options.privacyAgreed ? options.privacyConsentVersion : null,
      },
      { onConflict: 'id' },
    )
    .select('id,email,name,phone,birth_date,privacy_agreed,privacy_agreed_at,privacy_consent_version')
    .single();

  if (error) {
    throw new Error(`회원정보 저장 실패: ${getErrorMessage(error)}`);
  }

  return data as MemberProfileRow;
}
