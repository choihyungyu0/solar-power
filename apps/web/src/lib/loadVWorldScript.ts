import jquery from 'jquery';

const VWORLD_SCRIPT_ID = 'vworld-3d-sdk-script';
const DEFAULT_VWORLD_3D_VERSION = '3.0';
const VWORLD_JQUERY_FAILURE_MESSAGE =
  'jQuery 전역 객체가 없어 브이월드 3D 초기화에 실패했습니다.';
const VWORLD_CONSTRUCTOR_FAILURE_MESSAGE =
  '브이월드 3D SDK는 로드되었지만 지도 생성자 연결이 필요합니다. 공식 샘플의 생성자명을 확인해주세요.';
const VWORLD_ENGINE_LOAD_FAILURE_MESSAGE =
  '브이월드 인증은 통과했지만 3D 엔진 스크립트 로드에 실패했습니다. WSViewerStartup, VWViewerStartup, vw.ol3WebGL 요청을 확인해주세요.';
const VWORLD_ENGINE_SCRIPT_DEFINITIONS = [
  {
    id: 'vworld-wsviewer-startup',
    path: '/js/ws3dmap/WS3DRelease3/WSViewerStartup.js',
    statusKey: 'wsViewerStartupLoaded',
  },
  {
    id: 'vworld-vwviewer-startup',
    path: '/js/ws3dmap/WS3DRelease3/VWViewerStartup.v30.min.js?ver=2024061902',
    statusKey: 'vwViewerStartupLoaded',
  },
  {
    id: 'vworld-ol3-webgl',
    path: '/js/ws3dmap/WS3DRelease3/vw.ol3WebGL.v30.js?ver=2024061902',
    statusKey: 'ol3WebglLoaded',
  },
] as const;

let vworldScriptPromise: Promise<void> | null = null;
const scriptLoadPromises = new Map<string, Promise<void>>();

export type VWorldSelection = {
  longitude?: number;
  latitude?: number;
  rawEvent?: unknown;
};

export type VWorldMapFocusResult = {
  moved: boolean;
  method: string;
  message: string;
};

export type VWorldLoadDiagnostics = {
  bootstrapLoaded: boolean;
  wsViewerStartupLoaded: boolean;
  vwViewerStartupLoaded: boolean;
  ol3WebglLoaded: boolean;
  jqueryLoaded: boolean;
  dollarLoaded: boolean;
  detectedGlobals: {
    dollar: boolean;
    jQuery: boolean;
    vw: boolean;
    vwOl3: boolean;
    vwOl3Map: boolean;
    ws3d: boolean;
    VW: boolean;
    vwKeys: string[];
    vwOl3Keys: string[];
    ws3dKeys: string[];
    vwRelatedWindowKeys: string[];
  };
};

export type VWorldMapController = {
  map: VWorldMapInstance;
  dispose: () => void;
};

type InitVWorld3DMapParams = {
  mapId: string;
  onSelect?: (selection: VWorldSelection) => void;
};

type VWorldLoadStatus = Omit<VWorldLoadDiagnostics, 'detectedGlobals' | 'jqueryLoaded' | 'dollarLoaded'>;

class VWorldScriptLoadError extends Error {
  diagnostics: VWorldLoadDiagnostics;

  constructor(message: string, diagnostics: VWorldLoadDiagnostics) {
    super(message);
    this.name = 'VWorldScriptLoadError';
    this.diagnostics = diagnostics;
  }
}

function getRequiredEnv(name: 'VITE_VWORLD_API_KEY' | 'VITE_VWORLD_3D_SDK_URL') {
  const value = import.meta.env[name]?.trim();

  if (!value) {
    if (name === 'VITE_VWORLD_API_KEY') {
      throw new Error(
        'VITE_VWORLD_API_KEY가 비어 있습니다. 브이월드 개발키를 apps/web/.env.local과 Vercel Environment Variables에 설정해주세요.',
      );
    }

    throw new Error(
      'VITE_VWORLD_3D_SDK_URL이 비어 있습니다. 예: https://map.vworld.kr/js/webglMapInit.js.do 처럼 쿼리 없는 SDK 기본 URL을 설정해주세요.',
    );
  }

  return value;
}

function getVWorld3DVersion() {
  return import.meta.env.VITE_VWORLD_3D_VERSION?.trim() || DEFAULT_VWORLD_3D_VERSION;
}

function createUrlFromSdkUrl(sdkUrl: string) {
  try {
    return new URL(sdkUrl);
  } catch {
    throw new Error(
      'VITE_VWORLD_3D_SDK_URL은 절대 URL이어야 합니다. 예: https://map.vworld.kr/js/webglMapInit.js.do 처럼 설정하고 ?version=3.0은 넣지 마세요.',
    );
  }
}

function buildVWorldSdkUrl(sdkUrl: string, apiKey: string, version: string) {
  const url = createUrlFromSdkUrl(sdkUrl);
  url.searchParams.set('version', version);
  url.searchParams.set('apiKey', apiKey);

  return url.toString();
}

function getVWorldBaseUrl(sdkUrl: string) {
  return createUrlFromSdkUrl(sdkUrl).origin;
}

function hasExpectedVWorldGlobal() {
  return Boolean(window.vw?.ol3?.Map || window.vw || window.ws3d || window.VW);
}

function getSortedObjectKeys(value: unknown) {
  return value && typeof value === 'object' ? Object.keys(value).sort() : [];
}

function createVWorldDiagnostics(status: VWorldLoadStatus): VWorldLoadDiagnostics {
  return {
    ...status,
    jqueryLoaded: Boolean(window.jQuery),
    dollarLoaded: Boolean(window.$),
    detectedGlobals: {
      dollar: Boolean(window.$),
      jQuery: Boolean(window.jQuery),
      vw: Boolean(window.vw),
      vwOl3: Boolean(window.vw?.ol3),
      vwOl3Map: Boolean(window.vw?.ol3?.Map),
      ws3d: Boolean(window.ws3d),
      VW: Boolean(window.VW),
      vwKeys: getSortedObjectKeys(window.vw),
      vwOl3Keys: getSortedObjectKeys(window.vw?.ol3),
      ws3dKeys: getSortedObjectKeys(window.ws3d),
      vwRelatedWindowKeys: Object.keys(window)
        .filter((key) => key.toLowerCase().includes('vw'))
        .sort(),
    },
  };
}

function updateVWorldDiagnostics(status: VWorldLoadStatus) {
  const diagnostics = createVWorldDiagnostics(status);
  window.__solarMateMapDiagnostics = diagnostics;

  return diagnostics;
}

function findExistingScript(id: string, src: string) {
  const normalizedSrc = new URL(src).toString();
  const byId = document.getElementById(id) as HTMLScriptElement | null;

  if (byId) {
    return byId;
  }

  return Array.from(document.scripts).find((script) => script.src === normalizedSrc) ?? null;
}

function loadScriptOnce(id: string, src: string): Promise<void> {
  const existingPromise = scriptLoadPromises.get(id) ?? scriptLoadPromises.get(src);

  if (existingPromise) {
    return existingPromise;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existing = findExistingScript(id, src);

    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`${id} failed to load`));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    scriptLoadPromises.delete(id);
    scriptLoadPromises.delete(src);
    throw error;
  });

  scriptLoadPromises.set(id, promise);
  scriptLoadPromises.set(src, promise);

  return promise;
}

function loadBootstrapScript(src: string) {
  const originalWrite = document.write;
  const originalWriteln = document.writeln;

  document.write = ((..._text: string[]) => undefined) as typeof document.write;
  document.writeln = ((..._text: string[]) => undefined) as typeof document.writeln;

  return loadScriptOnce(VWORLD_SCRIPT_ID, src).finally(() => {
    document.write = originalWrite;
    document.writeln = originalWriteln;
  });
}

function createEngineScriptUrl(baseUrl: string, path: string) {
  return new URL(path, baseUrl).toString();
}

function ensureJQueryGlobal() {
  if (!window.$) {
    window.$ = jquery;
  }

  if (!window.jQuery) {
    window.jQuery = jquery;
  }

  return Boolean(window.$ && window.jQuery);
}

async function loadVWorldScriptInternal() {
  const status: VWorldLoadStatus = {
    bootstrapLoaded: false,
    wsViewerStartupLoaded: false,
    vwViewerStartupLoaded: false,
    ol3WebglLoaded: false,
  };

  updateVWorldDiagnostics(status);

  if (!ensureJQueryGlobal()) {
    throw new VWorldScriptLoadError(VWORLD_JQUERY_FAILURE_MESSAGE, updateVWorldDiagnostics(status));
  }

  updateVWorldDiagnostics(status);

  const apiKey = getRequiredEnv('VITE_VWORLD_API_KEY');
  const sdkUrl = getRequiredEnv('VITE_VWORLD_3D_SDK_URL');
  const version = getVWorld3DVersion();
  const bootstrapUrl = buildVWorldSdkUrl(sdkUrl, apiKey, version);
  const baseUrl = getVWorldBaseUrl(sdkUrl);

  try {
    await loadBootstrapScript(bootstrapUrl);
    status.bootstrapLoaded = true;
    updateVWorldDiagnostics(status);
  } catch {
    vworldScriptPromise = null;
    throw new VWorldScriptLoadError(
      '브이월드 3D SDK 부트스트랩 스크립트 로드에 실패했습니다. API 키, SDK URL, Vercel 허용 도메인을 확인해주세요.',
      updateVWorldDiagnostics(status),
    );
  }

  try {
    for (const scriptDefinition of VWORLD_ENGINE_SCRIPT_DEFINITIONS) {
      await loadScriptOnce(
        scriptDefinition.id,
        createEngineScriptUrl(baseUrl, scriptDefinition.path),
      );
      status[scriptDefinition.statusKey] = true;
      updateVWorldDiagnostics(status);
    }
  } catch {
    vworldScriptPromise = null;
    throw new VWorldScriptLoadError(VWORLD_ENGINE_LOAD_FAILURE_MESSAGE, updateVWorldDiagnostics(status));
  }

  if (!hasExpectedVWorldGlobal()) {
    vworldScriptPromise = null;
    throw new VWorldScriptLoadError(VWORLD_ENGINE_LOAD_FAILURE_MESSAGE, updateVWorldDiagnostics(status));
  }

  updateVWorldDiagnostics(status);
}

export function loadVWorldScript() {
  if (hasExpectedVWorldGlobal()) {
    if (!ensureJQueryGlobal()) {
      return Promise.reject(new Error(VWORLD_JQUERY_FAILURE_MESSAGE));
    }

    return Promise.resolve();
  }

  if (vworldScriptPromise) {
    return vworldScriptPromise;
  }

  vworldScriptPromise = loadVWorldScriptInternal();

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

function createVWorldCameraPosition(
  longitude = 127.1086,
  latitude = 37.3825,
  height = 2400,
  heading = 0,
  pitch = -70,
  roll = 0,
) {
  const vw = window.vw;

  if (!vw?.CameraPosition || !vw.CoordZ || !vw.Direction) {
    return undefined;
  }

  return new vw.CameraPosition(
    new vw.CoordZ(longitude, latitude, height),
    new vw.Direction(heading, pitch, roll),
  );
}

function createVWorldCoordZ(longitude: number, latitude: number, height: number) {
  const vw = window.vw;

  if (!vw?.CoordZ) {
    return undefined;
  }

  return new vw.CoordZ(longitude, latitude, height);
}

function invokeMapMethod(map: VWorldMapInstance, methodName: string, argument: unknown) {
  const method = (map as unknown as Record<string, unknown>)[methodName];

  if (typeof method !== 'function') {
    return false;
  }

  method.call(map, argument);
  return true;
}

export function focusVWorldMapOnCoordinate(
  map: VWorldMapInstance | null,
  {
    longitude,
    latitude,
    height = 180,
    heading = 0,
    pitch = -82,
    roll = 0,
  }: {
    longitude: number;
    latitude: number;
    height?: number;
    heading?: number;
    pitch?: number;
    roll?: number;
  },
): VWorldMapFocusResult {
  if (!map) {
    return {
      moved: false,
      method: '',
      message: '지도 객체가 아직 준비되지 않아 선택 위치로 이동하지 못했습니다.',
    };
  }

  const cameraPosition = createVWorldCameraPosition(longitude, latitude, height, heading, pitch, roll);
  const coordZ = createVWorldCoordZ(longitude, latitude, height);
  const candidates = [
    { method: 'moveTo', run: () => Boolean(cameraPosition) && invokeMapMethod(map, 'moveTo', cameraPosition) },
    { method: 'setPosition', run: () => Boolean(coordZ) && invokeMapMethod(map, 'setPosition', coordZ) },
    {
      method: 'setCameraPosition',
      run: () => Boolean(cameraPosition) && invokeMapMethod(map, 'setCameraPosition', cameraPosition),
    },
    { method: 'moveCamera', run: () => Boolean(cameraPosition) && invokeMapMethod(map, 'moveCamera', cameraPosition) },
    { method: 'flyTo', run: () => Boolean(cameraPosition) && invokeMapMethod(map, 'flyTo', cameraPosition) },
    { method: 'moveTo(coord)', run: () => Boolean(coordZ) && invokeMapMethod(map, 'moveTo', coordZ) },
  ];

  for (const candidate of candidates) {
    try {
      if (candidate.run()) {
        return {
          moved: true,
          method: candidate.method,
          message: '선택한 지도 좌표로 시점 이동을 시도했습니다.',
        };
      }
    } catch {
      // VWorld camera signatures differ by SDK sample/version. Try the next known path.
    }
  }

  try {
    if (cameraPosition) {
      map.setInitPosition?.(cameraPosition);

      return {
        moved: true,
        method: 'setInitPosition',
        message: '선택한 지도 좌표를 초기 위치로 설정했습니다.',
      };
    }
  } catch {
    // Keep the selection state even if camera control is unavailable.
  }

  return {
    moved: false,
    method: '',
    message: '클릭 좌표는 받았지만 브이월드 카메라 이동 메서드 연결이 필요합니다.',
  };
}

export function markVWorldMapSelection(
  map: VWorldMapInstance | null,
  { longitude, latitude, label = '선택 건물' }: { longitude: number; latitude: number; label?: string },
) {
  if (!map || !window.vw?.CoordZ) {
    return false;
  }

  try {
    map.removeObjectById?.('solarmate-selected-building-marker');
    map.createMarker?.('solarmate-selected-building-marker', new window.vw.CoordZ(longitude, latitude, 80), label);
    return true;
  } catch {
    return false;
  }
}

function createVWorldMapOptions(mapId: string, initialPosition: VWorldCameraPosition | undefined) {
  const vw = window.vw;

  if (vw?.MapOptions && vw.BasemapType && vw.DensityType && initialPosition) {
    return new vw.MapOptions(
      vw.BasemapType.GRAPHIC,
      '',
      vw.DensityType.FULL,
      vw.DensityType.BASIC,
      false,
      initialPosition,
      initialPosition,
    );
  }

  return {
    mapId,
    initPosition: initialPosition,
    logo: true,
    navigation: true,
  };
}

function createVWorldOl3Map(mapId: string, initialPosition: VWorldCameraPosition | undefined) {
  const ol3 = window.vw?.ol3;

  if (!ol3?.Map) {
    return null;
  }

  const mapOptions = {
    basemapType: ol3.BasemapType?.GRAPHIC,
    controlDensity: ol3.DensityType?.FULL,
    interactionDensity: ol3.DensityType?.BASIC,
    controlsAutoArrange: true,
    homePosition: initialPosition,
    initPosition: initialPosition,
  };

  return new ol3.Map(mapId, mapOptions);
}

function createVWorldMap(mapId: string) {
  const vw = window.vw;
  const initialPosition = createVWorldCameraPosition();

  if (vw?.ol3?.Map) {
    return createVWorldOl3Map(mapId, initialPosition);
  }

  if (vw?.Map) {
    return new vw.Map(mapId, createVWorldMapOptions(mapId, initialPosition));
  }

  throw new Error('브이월드 지도 생성자를 찾을 수 없습니다. window.vw.ol3.Map 또는 window.vw.Map 전역을 확인해주세요.');
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '알 수 없는 오류';
}

export function initVWorld3DMap({ mapId, onSelect }: InitVWorld3DMapParams): VWorldMapController {
  let map: VWorldMapInstance | null = null;

  if (!ensureJQueryGlobal()) {
    throw new Error(VWORLD_JQUERY_FAILURE_MESSAGE);
  }

  try {
    map = createVWorldMap(mapId);
  } catch (error) {
    if (!window.vw?.Map) {
      throw new Error(`${VWORLD_CONSTRUCTOR_FAILURE_MESSAGE} ${getErrorMessage(error)}`);
    }

    try {
      const initialPosition = createVWorldCameraPosition();
      map = new window.vw.Map(mapId, createVWorldMapOptions(mapId, initialPosition));
    } catch (fallbackError) {
      throw new Error(`${VWORLD_CONSTRUCTOR_FAILURE_MESSAGE} ${getErrorMessage(fallbackError)}`);
    }
  }

  if (!map) {
    throw new Error(VWORLD_CONSTRUCTOR_FAILURE_MESSAGE);
  }

  const initialPosition = createVWorldCameraPosition();

  map.setOption?.(createVWorldMapOptions(mapId, initialPosition) as VWorldMapOptions);
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
      map?.onClick?.removeEventListener?.(clickHandler);
      map?.destroy?.();
      document.getElementById(mapId)?.replaceChildren();
    },
  };
}
