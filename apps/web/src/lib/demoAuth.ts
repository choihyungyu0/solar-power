export const DEMO_AUTH_STORAGE_KEY = 'solarmate:demoAuth';

export type DemoUserRole = 'installed' | 'uninstalled';

export type DemoAuthState = {
  isLoggedIn: true;
  userId: string;
  role: DemoUserRole;
  loginAt: string;
};

function isDemoAuthState(value: unknown): value is DemoAuthState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<DemoAuthState>;

  return (
    candidate.isLoggedIn === true &&
    typeof candidate.userId === 'string' &&
    typeof candidate.loginAt === 'string' &&
    (candidate.role === 'installed' || candidate.role === 'uninstalled')
  );
}

function inferDemoRole(userId: string): DemoUserRole {
  const normalizedUserId = userId.toLowerCase();

  if (normalizedUserId.includes('no') || normalizedUserId.includes('guest') || userId.includes('미설치')) {
    return 'uninstalled';
  }

  return 'installed';
}

export function getDemoAuth() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(DEMO_AUTH_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    if (isDemoAuthState(parsedValue)) {
      return parsedValue;
    }

    if (parsedValue && typeof parsedValue === 'object') {
      const legacyValue = parsedValue as Partial<DemoAuthState>;

      if (legacyValue.isLoggedIn === true && typeof legacyValue.userId === 'string' && typeof legacyValue.loginAt === 'string') {
        return {
          isLoggedIn: true,
          userId: legacyValue.userId,
          role: inferDemoRole(legacyValue.userId),
          loginAt: legacyValue.loginAt,
        } satisfies DemoAuthState;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function setDemoAuth(userId: string, role: DemoUserRole = inferDemoRole(userId)) {
  const authState: DemoAuthState = {
    isLoggedIn: true,
    userId,
    role,
    loginAt: new Date().toISOString(),
  };

  window.sessionStorage.setItem(DEMO_AUTH_STORAGE_KEY, JSON.stringify(authState));

  return authState;
}

export function clearDemoAuth() {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
}

export function isDemoLoggedIn() {
  return getDemoAuth()?.isLoggedIn === true;
}

export function getDemoUserRole() {
  return getDemoAuth()?.role ?? null;
}

export function readDemoAuthState() {
  return getDemoAuth();
}

export function saveDemoAuthState(userId: string, role?: DemoUserRole) {
  return setDemoAuth(userId, role);
}

export function clearDemoAuthState() {
  clearDemoAuth();
}
