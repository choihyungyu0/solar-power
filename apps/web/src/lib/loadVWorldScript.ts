const VWORLD_SCRIPT_ID = 'vworld-3d-sdk-script';

let vworldScriptPromise: Promise<void> | null = null;

export type VWorldSelection = {
  longitude?: number;
  latitude?: number;
  rawEvent?: unknown;
};

export type VWorldMapController = {
  map: VWorldMapInstance;
  dispose: () => void;
};

type InitVWorld3DMapParams = {
  mapId: string;
  onSelect?: (selection: VWorldSelection) => void;
};

function getRequiredEnv(name: 'VITE_VWORLD_API_KEY' | 'VITE_VWORLD_3D_SDK_URL') {
  const value = import.meta.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }

  return value;
}

function buildVWorldSdkUrl(sdkUrl: string, apiKey: string) {
  const encodedApiKey = encodeURIComponent(apiKey);
  const placeholderPattern = /\{apiKey\}|\{apikey\}|\[apiKey\]|\[apikey\]|\[인증키\]/i;

  if (placeholderPattern.test(sdkUrl)) {
    return sdkUrl.replace(/\{apiKey\}|\{apikey\}|\[apiKey\]|\[apikey\]|\[인증키\]/gi, encodedApiKey);
  }

  const url = new URL(sdkUrl, window.location.origin);

  if (!url.searchParams.has('apiKey')) {
    url.searchParams.set('apiKey', apiKey);
  }

  return url.toString();
}

function assertVWorldReady() {
  if (!window.vw?.Map) {
    throw new Error('브이월드 SDK가 로드되었지만 window.vw.Map을 찾을 수 없습니다.');
  }
}

export function loadVWorldScript() {
  if (window.vw?.Map) {
    return Promise.resolve();
  }

  if (vworldScriptPromise) {
    return vworldScriptPromise;
  }

  vworldScriptPromise = new Promise<void>((resolve, reject) => {
    let script = document.getElementById(VWORLD_SCRIPT_ID) as HTMLScriptElement | null;

    const handleLoad = () => {
      try {
        assertVWorldReady();
        resolve();
      } catch (error) {
        vworldScriptPromise = null;
        reject(error);
      }
    };

    const handleError = () => {
      vworldScriptPromise = null;
      reject(new Error('브이월드 3D 지도 스크립트를 불러오지 못했습니다.'));
    };

    if (!script) {
      const apiKey = getRequiredEnv('VITE_VWORLD_API_KEY');
      const sdkUrl = getRequiredEnv('VITE_VWORLD_3D_SDK_URL');

      script = document.createElement('script');
      script.id = VWORLD_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = buildVWorldSdkUrl(sdkUrl, apiKey);
    }

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!script.parentElement) {
      document.head.appendChild(script);
    }
  });

  return vworldScriptPromise;
}

function extractSelectionFromVWorldClick(args: unknown[]): VWorldSelection {
  const cartographic = args[2] as { longitudeDD?: number; latitudeDD?: number } | undefined;

  return {
    longitude: cartographic?.longitudeDD,
    latitude: cartographic?.latitudeDD,
    rawEvent: args[4] ?? args[0],
  };
}

export function initVWorld3DMap({ mapId, onSelect }: InitVWorld3DMapParams): VWorldMapController {
  const vw = window.vw;

  if (!vw?.Map || !vw.CameraPosition || !vw.CoordZ || !vw.Direction) {
    throw new Error('브이월드 3D 지도 생성자를 찾을 수 없습니다.');
  }

  const initialPosition = new vw.CameraPosition(
    new vw.CoordZ(127.1086, 37.3825, 2400),
    new vw.Direction(0, -70, 0),
  );

  // TODO: 사용하는 VWorld SDK 버전의 공식 샘플 생성자 시그니처가 다르면 이 블록만 조정합니다.
  const map = new vw.Map();
  const options = {
    mapId,
    initPosition: initialPosition,
    logo: true,
    navigation: true,
  };

  map.setOption?.(options);
  map.setMapId?.(mapId);
  map.setInitPosition?.(initialPosition);
  map.setLogoVisible?.(true);
  map.setNavigationZoomVisible?.(true);
  map.start?.();

  // 건물 피처 선택 API 연결 전까지는 클릭 좌표 기반의 1차 선택 흐름을 사용합니다.
  const clickHandler = (...args: unknown[]) => {
    onSelect?.(extractSelectionFromVWorldClick(args));
  };

  map.onClick?.addEventListener?.(clickHandler);

  return {
    map,
    dispose: () => {
      map.onClick?.removeEventListener?.(clickHandler);
      map.destroy?.();
      document.getElementById(mapId)?.replaceChildren();
    },
  };
}
