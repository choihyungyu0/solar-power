export const LANDING_ADDRESS_DRAFT_STORAGE_KEY = 'solarmate:landingAddressDraft';

export type AddressDraftSource = 'landing-hero' | 'risk-map-search';

export type LandingAddressDraft = {
  address: string;
  source: AddressDraftSource;
  createdAt: string;
};

export function normalizeAddressInput(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function readLandingAddressDraft(): LandingAddressDraft | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(LANDING_ADDRESS_DRAFT_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<LandingAddressDraft>;
    const address = typeof parsedValue.address === 'string' ? normalizeAddressInput(parsedValue.address) : '';

    if (!address) {
      return null;
    }

    return {
      address,
      source: parsedValue.source === 'risk-map-search' ? 'risk-map-search' : 'landing-hero',
      createdAt: typeof parsedValue.createdAt === 'string' ? parsedValue.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function readLandingAddressText() {
  return readLandingAddressDraft()?.address ?? '';
}

export function saveLandingAddressDraft(address: string, source: AddressDraftSource = 'landing-hero') {
  if (typeof window === 'undefined') {
    return null;
  }

  const normalizedAddress = normalizeAddressInput(address);

  if (!normalizedAddress) {
    return null;
  }

  const draft: LandingAddressDraft = {
    address: normalizedAddress,
    source,
    createdAt: new Date().toISOString(),
  };

  try {
    window.sessionStorage.setItem(LANDING_ADDRESS_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}
