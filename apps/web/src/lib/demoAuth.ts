export const DEMO_AUTH_STORAGE_KEY = 'solarmate:demoAuth';

export type DemoAuthState = {
  isLoggedIn: true;
  userId: string;
  loginAt: string;
};

function isDemoAuthState(value: unknown): value is DemoAuthState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<DemoAuthState>;

  return candidate.isLoggedIn === true && typeof candidate.userId === 'string' && typeof candidate.loginAt === 'string';
}

export function readDemoAuthState() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(DEMO_AUTH_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    return isDemoAuthState(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

export function saveDemoAuthState(userId: string) {
  const authState: DemoAuthState = {
    isLoggedIn: true,
    userId,
    loginAt: new Date().toISOString(),
  };

  window.sessionStorage.setItem(DEMO_AUTH_STORAGE_KEY, JSON.stringify(authState));

  return authState;
}

export function clearDemoAuthState() {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
}
