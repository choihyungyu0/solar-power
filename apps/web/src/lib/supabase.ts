import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '');
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

function hasRealValue(value: string | undefined) {
  return Boolean(value && !value.includes('your-') && !value.includes('your_') && value.trim().length > 12);
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split('.');

  if (!payload) {
    return null;
  }

  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      '=',
    );

    return JSON.parse(window.atob(paddedPayload)) as { role?: string; ref?: string };
  } catch {
    return null;
  }
}

function getProjectRefFromUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const { hostname } = new URL(value);
    const [projectRef] = hostname.split('.');

    return hostname.endsWith('.supabase.co') && projectRef ? projectRef : null;
  } catch {
    return null;
  }
}

function validateSupabaseConfig() {
  if (!hasRealValue(supabaseUrl) || !hasRealValue(supabaseAnonKey)) {
    return {
      isValid: false,
      message: 'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하면 저장 기능이 켜집니다.',
    };
  }

  const projectRef = getProjectRefFromUrl(supabaseUrl);

  if (!projectRef) {
    return {
      isValid: false,
      message: 'VITE_SUPABASE_URL은 https://프로젝트-ref.supabase.co 형식이어야 합니다.',
    };
  }

  if (supabaseAnonKey?.startsWith('sb_publishable_')) {
    return {
      isValid: true,
      message: 'Supabase publishable key가 설정되었습니다.',
    };
  }

  const keyClaims = decodeJwtPayload(supabaseAnonKey as string);

  if (!keyClaims) {
    return {
      isValid: false,
      message: 'VITE_SUPABASE_ANON_KEY는 Supabase anon/public key여야 합니다.',
    };
  }

  if (keyClaims.role === 'service_role') {
    return {
      isValid: false,
      message: 'VITE_SUPABASE_ANON_KEY에 service_role 키가 들어 있습니다. Supabase anon/public key로 교체해 주세요.',
    };
  }

  if (keyClaims.role !== 'anon') {
    return {
      isValid: false,
      message: 'VITE_SUPABASE_ANON_KEY는 role이 anon인 공개 키여야 합니다.',
    };
  }

  if (keyClaims.ref && keyClaims.ref !== projectRef) {
    return {
      isValid: false,
      message: 'Supabase URL의 프로젝트 ref와 anon key의 프로젝트 ref가 다릅니다.',
    };
  }

  return {
    isValid: true,
    message: 'Supabase anon key가 설정되었습니다.',
  };
}

export const supabaseConfig = validateSupabaseConfig();
export const isSupabaseConfigured = supabaseConfig.isValid;
export const supabaseConfigMessage = supabaseConfig.message;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
