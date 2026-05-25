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
const HWASEONG_INITIAL_LONGITUDE = 127.07271472011158;
const HWASEONG_INITIAL_LATITUDE = 37.2059932805347;
const HWASEONG_INITIAL_HEIGHT = 340;
const HWASEONG_INITIAL_PITCH = -82;
const ENABLE_VWORLD_CAMERA_FALLBACK = import.meta.env.VITE_ENABLE_VWORLD_CAMERA_FALLBACK === 'true';
const MAP_LEFT_CLICK_SELECT_ONLY = import.meta.env.VITE_MAP_LEFT_CLICK_SELECT_ONLY !== 'false';
const MAP_CAMERA_CONTROL_MODE = MAP_LEFT_CLICK_SELECT_ONLY ? 'left-click-select-right-drag-map' : 'default';
const LEFT_CLICK_SELECT_MAX_MOVE_PX = 5;
const POINTER_DRAG_SUPPRESS_CLICK_MS = 700;

let vworldScriptPromise: Promise<void> | null = null;

type VWorldLoaderWindow = Window &
  typeof globalThis & {
    __solarMateScriptLoadPromises?: Map<string, Promise<void>>;
    __solarMateVWorldScriptPromise?: Promise<void> | null;
  };

export type VWorldSelection = {
  longitude?: number;
  latitude?: number;
  rawEvent?: unknown;
  source?: string;
  method?: string;
  clickPickMethod?: string;
  clickPickStatus?: 'success' | 'fallback' | 'failed';
  pickPositionSupported?: boolean;
  cameraHeightM?: number | null;
  pickAttempts?: string[];
  cameraControlMode?: string;
  leftDragNavigationDisabled?: boolean;
  rightDragNavigationEnabled?: boolean;
  lastPointerMovePx?: number;
  lastSelectionIgnoredBecauseDrag?: boolean;
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

type LonLatCoordinate = {
  longitude: number;
  latitude: number;
  method: string;
};

type ClickPickDiagnostics = {
  clickPickMethod: string;
  clickPickStatus: 'success' | 'fallback' | 'failed';
  pickPositionSupported: boolean;
  cameraHeightM: number | null;
  pickAttempts: string[];
};

type ClickPickResult = {
  coordinate: LonLatCoordinate | null;
  diagnostics: ClickPickDiagnostics;
};

type CameraControlDiagnostics = {
  cameraControlMode: string;
  leftDragNavigationDisabled: boolean;
  rightDragNavigationEnabled: boolean;
  lastPointerMovePx: number;
  lastSelectionIgnoredBecauseDrag: boolean;
};

type ScreenPoint = {
  x: number;
  y: number;
};

type CanvasLike = {
  clientWidth?: number;
  clientHeight?: number;
  width?: number;
  height?: number;
  isConnected?: boolean;
  getBoundingClientRect?: () => DOMRect;
};

type CesiumEntityCollectionLike = {
  add?: (entity: unknown) => unknown;
};

type CesiumViewerLike = {
  canvas?: CanvasLike;
  camera?: {
    setView?: (options: unknown) => void;
    flyTo?: (options: unknown) => void;
    getPickRay?: (point: unknown) => unknown;
    pickEllipsoid?: (point: unknown, ellipsoid?: unknown) => unknown;
    positionCartographic?: {
      height?: unknown;
    };
  };
  entities?: CesiumEntityCollectionLike;
  scene?: {
    canvas?: CanvasLike;
    screenSpaceCameraController?: Record<string, unknown>;
    camera?: {
      setView?: (options: unknown) => void;
      flyTo?: (options: unknown) => void;
      getPickRay?: (point: unknown) => unknown;
      pickEllipsoid?: (point: unknown, ellipsoid?: unknown) => unknown;
      positionCartographic?: {
        height?: unknown;
      };
    };
    globe?: {
      ellipsoid?: unknown;
      pick?: (ray: unknown, scene: unknown) => unknown;
    };
    pickPosition?: (point: unknown) => unknown;
    pickPositionSupported?: boolean;
  };
};

const KOREA_BOUNDS = {
  minLongitude: 124,
  maxLongitude: 132,
  minLatitude: 33,
  maxLatitude: 39.5,
};
const DUPLICATE_CLICK_WINDOW_MS = 350;
const TOUCH_TAP_MAX_MOVE_PX = 12;
const TOUCH_GESTURE_SUPPRESS_CLICK_MS = 700;

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
  window.__solarMateMapDiagnostics = {
    ...(window.__solarMateMapDiagnostics ?? {}),
    ...diagnostics,
  };

  return diagnostics;
}

function getLoaderWindow() {
  return window as VWorldLoaderWindow;
}

function getScriptLoadPromises() {
  const loaderWindow = getLoaderWindow();

  if (!loaderWindow.__solarMateScriptLoadPromises) {
    loaderWindow.__solarMateScriptLoadPromises = new Map<string, Promise<void>>();
  }

  return loaderWindow.__solarMateScriptLoadPromises;
}

function rememberVWorldScriptPromise(promise: Promise<void> | null) {
  vworldScriptPromise = promise;
  getLoaderWindow().__solarMateVWorldScriptPromise = promise;
}

function clearVWorldScriptPromise() {
  rememberVWorldScriptPromise(null);
}

function readCameraControlDiagnostics(): CameraControlDiagnostics {
  const diagnostics = window.__solarMateMapDiagnostics?.selectionInputControls ?? {};

  return {
    cameraControlMode:
      typeof diagnostics.cameraControlMode === 'string' ? diagnostics.cameraControlMode : MAP_CAMERA_CONTROL_MODE,
    leftDragNavigationDisabled: Boolean(diagnostics.leftDragNavigationDisabled),
    rightDragNavigationEnabled: Boolean(diagnostics.rightDragNavigationEnabled),
    lastPointerMovePx:
      typeof diagnostics.lastPointerMovePx === 'number' && Number.isFinite(diagnostics.lastPointerMovePx)
        ? diagnostics.lastPointerMovePx
        : 0,
    lastSelectionIgnoredBecauseDrag: Boolean(diagnostics.lastSelectionIgnoredBecauseDrag),
  };
}

function updateCameraControlDiagnostics(diagnostics: Partial<CameraControlDiagnostics>) {
  window.__solarMateMapDiagnostics = {
    ...(window.__solarMateMapDiagnostics ?? {}),
    selectionInputControls: {
      ...readCameraControlDiagnostics(),
      ...diagnostics,
    },
  };
}

function getCurrentSelectionControlDiagnostics(): CameraControlDiagnostics {
  return readCameraControlDiagnostics();
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
  const scriptLoadPromises = getScriptLoadPromises();
  const existingPromise = scriptLoadPromises.get(id) ?? scriptLoadPromises.get(src);

  if (existingPromise) {
    return existingPromise;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existing = findExistingScript(id, src);

    if (existing) {
      const loadStatus = existing.dataset.solarMateLoadStatus;

      if (loadStatus === 'loaded' || (existing as HTMLScriptElement & { readyState?: string }).readyState === 'complete') {
        resolve();
        return;
      }

      if (loadStatus === 'error') {
        reject(new Error(`${id} failed to load`));
        return;
      }

      const handleLoad = () => {
        cleanup();
        existing.dataset.solarMateLoadStatus = 'loaded';
        resolve();
      };
      const handleError = () => {
        cleanup();
        existing.dataset.solarMateLoadStatus = 'error';
        reject(new Error(`${id} failed to load`));
      };
      const cleanup = () => {
        existing.removeEventListener('load', handleLoad);
        existing.removeEventListener('error', handleError);
      };

      existing.addEventListener('load', handleLoad);
      existing.addEventListener('error', handleError);
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    script.dataset.solarMateLoadStatus = 'loading';
    script.onload = () => {
      script.dataset.solarMateLoadStatus = 'loaded';
      resolve();
    };
    script.onerror = () => {
      script.dataset.solarMateLoadStatus = 'error';
      reject(new Error(`${id} failed to load`));
    };
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
    clearVWorldScriptPromise();
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
    clearVWorldScriptPromise();
    throw new VWorldScriptLoadError(VWORLD_ENGINE_LOAD_FAILURE_MESSAGE, updateVWorldDiagnostics(status));
  }

  if (!hasExpectedVWorldGlobal()) {
    clearVWorldScriptPromise();
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

  const rememberedPromise = vworldScriptPromise ?? getLoaderWindow().__solarMateVWorldScriptPromise ?? null;

  if (rememberedPromise) {
    vworldScriptPromise = rememberedPromise;
    return rememberedPromise;
  }

  const nextPromise = loadVWorldScriptInternal();
  rememberVWorldScriptPromise(nextPromise);

  return nextPromise;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function isValidLonLat(longitude: number, latitude: number) {
  return Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90;
}

function isLikelyKoreaLonLat(longitude: number, latitude: number) {
  return (
    longitude >= KOREA_BOUNDS.minLongitude &&
    longitude <= KOREA_BOUNDS.maxLongitude &&
    latitude >= KOREA_BOUNDS.minLatitude &&
    latitude <= KOREA_BOUNDS.maxLatitude
  );
}

function normalizeLonLat(longitude: unknown, latitude: unknown, method: string): LonLatCoordinate | null {
  if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
    return null;
  }

  if (isValidLonLat(longitude, latitude) && isLikelyKoreaLonLat(longitude, latitude)) {
    return { longitude, latitude, method };
  }

  const degreeLongitude = toDegrees(longitude);
  const degreeLatitude = toDegrees(latitude);

  if (isValidLonLat(degreeLongitude, degreeLatitude) && isLikelyKoreaLonLat(degreeLongitude, degreeLatitude)) {
    return {
      longitude: degreeLongitude,
      latitude: degreeLatitude,
      method: `${method}:radians`,
    };
  }

  return null;
}

function getRecordNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (isFiniteNumber(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function extractCoordinateFromValue(
  value: unknown,
  methodPrefix: string,
  visited = new WeakSet<object>(),
): LonLatCoordinate | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (visited.has(value)) {
    return null;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    if (methodPrefix !== 'vworld.args' && value.length >= 2) {
      const arrayCoordinate = normalizeLonLat(value[0], value[1], `${methodPrefix}:array`);

      if (arrayCoordinate) {
        return arrayCoordinate;
      }
    }

    for (const [index, item] of value.entries()) {
      const nested = extractCoordinateFromValue(item, `${methodPrefix}[${index}]`, visited);

      if (nested) {
        return nested;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;
  const isMouseLikeRecord = isFiniteNumber(record.clientX) && isFiniteNumber(record.clientY);
  const explicitCoordinate = normalizeLonLat(
    getRecordNumber(record, [
      'longitudeDD',
      'lonDD',
      'lngDD',
      'longitudeDeg',
      'lonDeg',
      'lngDeg',
      'longitude',
      'lon',
      'lng',
      ...(isMouseLikeRecord ? [] : ['x']),
    ]),
    getRecordNumber(record, [
      'latitudeDD',
      'latDD',
      'latitudeDeg',
      'latDeg',
      'latitude',
      'lat',
      ...(isMouseLikeRecord ? [] : ['y']),
    ]),
    `${methodPrefix}:fields`,
  );

  if (explicitCoordinate) {
    return explicitCoordinate;
  }

  for (const key of [
    'cartographic',
    'coordinate',
    'coord',
    'coords',
    'position',
    'mapPosition',
    'mapCoordinate',
    'point',
    'pickedPosition',
    'location',
    'data',
    'detail',
  ]) {
    const nested = extractCoordinateFromValue(record[key], `${methodPrefix}.${key}`, visited);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function findMouseEvent(value: unknown, visited = new WeakSet<object>()): MouseEvent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (visited.has(value)) {
    return null;
  }

  visited.add(value);

  if (value instanceof MouseEvent) {
    return value;
  }

  const record = value as Record<string, unknown>;

  if (isFiniteNumber(record.clientX) && isFiniteNumber(record.clientY)) {
    return value as MouseEvent;
  }

  for (const key of ['rawEvent', 'event', 'originalEvent', 'srcEvent', 'domEvent', 'nativeEvent']) {
    const nested = findMouseEvent(record[key], visited);

    if (nested) {
      return nested;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findMouseEvent(item, visited);

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function getCesiumSdk() {
  const cesium = window.Cesium;

  return cesium && typeof cesium === 'object' ? (cesium as Record<string, any>) : null;
}

function hasCesiumEntityCollection(value: unknown): value is CesiumViewerLike {
  try {
    return Boolean(value && typeof value === 'object' && ((value as CesiumViewerLike).entities?.add));
  } catch {
    return false;
  }
}

function pushUniqueViewerCandidate(candidates: CesiumViewerLike[], value: unknown) {
  if (!hasCesiumEntityCollection(value) || candidates.includes(value)) {
    return;
  }

  candidates.push(value);
}

function readObjectValue(record: Record<string, unknown>, key: string) {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function getCesiumViewerCandidates(value: unknown): CesiumViewerLike[] {
  const candidates: CesiumViewerLike[] = [];

  if (!value || typeof value !== 'object') {
    return candidates;
  }

  const record = value as Record<string, unknown>;

  pushUniqueViewerCandidate(candidates, value);

  for (const key of ['viewer', '_viewer', 'cesiumViewer', '_cesiumViewer', 'sceneViewer', 'mapViewer']) {
    pushUniqueViewerCandidate(candidates, readObjectValue(record, key));
  }

  for (const key of ['getViewer', 'getCesiumViewer', 'getCesium', 'getMap']) {
    const method = readObjectValue(record, key);

    if (typeof method !== 'function') {
      continue;
    }

    try {
      pushUniqueViewerCandidate(candidates, method.call(value));
    } catch {
      // VWorld builds expose different internals; keep looking for a safe viewer candidate.
    }
  }

  return candidates;
}

function getViewerCanvas(viewer: CesiumViewerLike): CanvasLike | null {
  try {
    return viewer.scene?.canvas ?? viewer.canvas ?? null;
  } catch {
    return null;
  }
}

function getViewerCanvasArea(viewer: CesiumViewerLike) {
  const canvas = getViewerCanvas(viewer);
  const rect = canvas?.getBoundingClientRect?.();
  const width = rect?.width || canvas?.clientWidth || canvas?.width || 0;
  const height = rect?.height || canvas?.clientHeight || canvas?.height || 0;

  return width * height;
}

function isViewerCanvasVisible(viewer: CesiumViewerLike) {
  const canvas = getViewerCanvas(viewer);

  if (!canvas || canvas.isConnected === false || getViewerCanvasArea(viewer) <= 0) {
    return false;
  }

  if (canvas instanceof HTMLElement) {
    const style = window.getComputedStyle(canvas);

    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }

  return true;
}

function findCesiumViewer(map: VWorldMapInstance | null): CesiumViewerLike | null {
  const candidates = [map, window.ws3d, window.VW, window.vw].flatMap(getCesiumViewerCandidates);
  const uniqueCandidates = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);

  if (uniqueCandidates.length === 0) {
    return null;
  }

  return uniqueCandidates.sort((left, right) => {
    const rightVisible = isViewerCanvasVisible(right) ? 1 : 0;
    const leftVisible = isViewerCanvasVisible(left) ? 1 : 0;

    return rightVisible - leftVisible || getViewerCanvasArea(right) - getViewerCanvasArea(left);
  })[0];
}

function assignCameraEventTypes(controller: Record<string, unknown>, key: string, value: unknown) {
  try {
    if (!(key in controller)) {
      return false;
    }

    controller[key] = value;
    return true;
  } catch {
    return false;
  }
}

function configureCesiumCameraControls(map: VWorldMapInstance | null) {
  if (!MAP_LEFT_CLICK_SELECT_ONLY) {
    updateCameraControlDiagnostics({
      cameraControlMode: MAP_CAMERA_CONTROL_MODE,
      leftDragNavigationDisabled: false,
      rightDragNavigationEnabled: false,
    });
    return { configured: false, viewerFound: false };
  }

  const cesium = getCesiumSdk();
  const viewer = findCesiumViewer(map);
  let controller: Record<string, unknown> | undefined;

  try {
    controller = viewer?.scene?.screenSpaceCameraController;
  } catch {
    controller = undefined;
  }

  const cameraEventType = cesium?.CameraEventType;
  const keyboardModifier = cesium?.KeyboardEventModifier;

  if (!viewer || !controller || !cameraEventType) {
    updateCameraControlDiagnostics({
      cameraControlMode: MAP_CAMERA_CONTROL_MODE,
      leftDragNavigationDisabled: false,
      rightDragNavigationEnabled: false,
    });
    return { configured: false, viewerFound: Boolean(viewer) };
  }

  const rightDrag = cameraEventType.RIGHT_DRAG;
  const middleDrag = cameraEventType.MIDDLE_DRAG;
  const leftDrag = cameraEventType.LEFT_DRAG;
  const wheel = cameraEventType.WHEEL;
  const pinch = cameraEventType.PINCH;
  const ctrl = keyboardModifier?.CTRL;
  const zoomEventTypes = [wheel, pinch].filter((eventType) => eventType !== undefined);
  const tiltEventTypes = [
    middleDrag,
    leftDrag !== undefined && ctrl !== undefined ? { eventType: leftDrag, modifier: ctrl } : null,
    rightDrag !== undefined && ctrl !== undefined ? { eventType: rightDrag, modifier: ctrl } : null,
  ].filter(Boolean);

  const rotateSet = rightDrag !== undefined && assignCameraEventTypes(controller, 'rotateEventTypes', rightDrag);
  const translateSet = rightDrag !== undefined && assignCameraEventTypes(controller, 'translateEventTypes', rightDrag);
  const zoomSet = zoomEventTypes.length > 0 && assignCameraEventTypes(controller, 'zoomEventTypes', zoomEventTypes);
  const tiltSet = tiltEventTypes.length > 0 && assignCameraEventTypes(controller, 'tiltEventTypes', tiltEventTypes);
  const configured = Boolean(rotateSet || translateSet || zoomSet || tiltSet);

  updateCameraControlDiagnostics({
    cameraControlMode: MAP_CAMERA_CONTROL_MODE,
    leftDragNavigationDisabled: Boolean(rotateSet),
    rightDragNavigationEnabled: Boolean(rotateSet || translateSet),
  });

  return { configured, viewerFound: true };
}

function scheduleCesiumCameraControlConfiguration(map: VWorldMapInstance | null) {
  let timeoutId: number | null = null;
  let attempts = 0;
  const maxAttempts = 12;

  const run = () => {
    attempts += 1;
    const result = configureCesiumCameraControls(map);

    if (result.configured || attempts >= maxAttempts || !MAP_LEFT_CLICK_SELECT_ONLY) {
      if (
        MAP_LEFT_CLICK_SELECT_ONLY &&
        !result.viewerFound &&
        attempts >= maxAttempts &&
        import.meta.env.DEV
      ) {
        console.warn(
          '[EcoHat] Cesium viewer was not available, so VWorld map mouse controls kept the existing behavior.',
        );
      }
      return;
    }

    timeoutId = window.setTimeout(run, 250);
  };

  run();

  return () => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
}

function getScreenPointFromMouseEvent(event: MouseEvent, viewer: CesiumViewerLike): ScreenPoint | null {
  const canvas = getViewerCanvas(viewer);
  const rect = canvas?.getBoundingClientRect?.();

  if (!rect) {
    return null;
  }

  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > rect.width || y > rect.height) {
    return null;
  }

  return { x, y };
}

function getLonLatFromCartesian(cartesian: unknown, method: string): LonLatCoordinate | null {
  const cesium = getCesiumSdk();

  if (!cartesian || !cesium?.Cartographic?.fromCartesian) {
    return null;
  }

  try {
    const cartographic = cesium.Cartographic.fromCartesian(cartesian);

    if (!cartographic) {
      return null;
    }

    return normalizeLonLat(cartographic.longitude, cartographic.latitude, method);
  } catch {
    return null;
  }
}

function getCameraHeightM(viewer: CesiumViewerLike | null) {
  const camera = viewer?.scene?.camera ?? viewer?.camera;
  const height = camera?.positionCartographic?.height;

  return typeof height === 'number' && Number.isFinite(height) ? height : null;
}

function createClickPickDiagnostics(
  overrides: Partial<ClickPickDiagnostics>,
  viewer: CesiumViewerLike | null,
): ClickPickDiagnostics {
  return {
    clickPickMethod: '-',
    clickPickStatus: 'failed',
    pickPositionSupported: Boolean(viewer?.scene?.pickPositionSupported),
    cameraHeightM: getCameraHeightM(viewer),
    pickAttempts: [],
    ...overrides,
  };
}

function createClickPickResult(
  coordinate: LonLatCoordinate | null,
  diagnostics: ClickPickDiagnostics,
): ClickPickResult {
  return {
    coordinate,
    diagnostics: {
      ...diagnostics,
      clickPickMethod: coordinate?.method ?? diagnostics.clickPickMethod,
      clickPickStatus: coordinate ? diagnostics.clickPickStatus : 'failed',
    },
  };
}

function createFallbackClickPickResult(
  fallbackCoordinate: LonLatCoordinate | null,
  viewer: CesiumViewerLike | null,
  pickAttempts: string[],
): ClickPickResult {
  return createClickPickResult(
    fallbackCoordinate,
    createClickPickDiagnostics(
      {
        clickPickMethod: fallbackCoordinate?.method ?? '-',
        clickPickStatus: fallbackCoordinate ? 'fallback' : 'failed',
        pickAttempts,
      },
      viewer,
    ),
  );
}

function pickCoordinateFromCesiumCanvas(
  map: VWorldMapInstance | null,
  event: MouseEvent | null,
  fallbackCoordinate: LonLatCoordinate | null = null,
): ClickPickResult {
  const cesium = getCesiumSdk();
  const viewer = findCesiumViewer(map);
  const pickAttempts: string[] = [];

  if (!event) {
    return createFallbackClickPickResult(fallbackCoordinate, viewer, ['mouse-event-missing']);
  }

  const screenPoint = viewer ? getScreenPointFromMouseEvent(event, viewer) : null;

  if (!cesium?.Cartesian2 || !viewer || !screenPoint) {
    return createFallbackClickPickResult(fallbackCoordinate, viewer, [
      !viewer ? 'cesium-viewer-missing' : 'cesium-screen-point-missing',
    ]);
  }

  const cesiumPoint = new cesium.Cartesian2(screenPoint.x, screenPoint.y);
  const pickPositionSupported = Boolean(viewer.scene?.pickPositionSupported && viewer.scene?.pickPosition);

  if (pickPositionSupported) {
    pickAttempts.push('cesium.scene.pickPosition');

    try {
      const pickedCartesian = viewer.scene?.pickPosition?.(cesiumPoint);
      const pickedCoordinate = getLonLatFromCartesian(pickedCartesian, 'cesium.scene.pickPosition');

      if (pickedCoordinate) {
        return createClickPickResult(
          pickedCoordinate,
          createClickPickDiagnostics(
            {
              clickPickMethod: pickedCoordinate.method,
              clickPickStatus: 'success',
              pickPositionSupported,
              pickAttempts,
            },
            viewer,
          ),
        );
      }
    } catch {
      // Try globe picking next.
    }
  } else {
    pickAttempts.push('cesium.scene.pickPosition:unsupported');
  }

  try {
    pickAttempts.push('cesium.globe.pick');
    const camera = viewer.scene?.camera ?? viewer.camera;
    const pickRay = camera?.getPickRay?.(cesiumPoint);
    const pickedCartesian = pickRay ? viewer.scene?.globe?.pick?.(pickRay, viewer.scene) : null;
    const pickedCoordinate = getLonLatFromCartesian(pickedCartesian, 'cesium.globe.pick');

    if (pickedCoordinate) {
      return createClickPickResult(
        pickedCoordinate,
        createClickPickDiagnostics(
          {
            clickPickMethod: pickedCoordinate.method,
            clickPickStatus: 'success',
            pickPositionSupported,
            pickAttempts,
          },
          viewer,
        ),
      );
    }
  } catch {
    // Fall back to ellipsoid picking below.
  }

  try {
    pickAttempts.push('cesium.camera.pickEllipsoid');
    const camera = viewer.scene?.camera ?? viewer.camera;
    const ellipsoid = viewer.scene?.globe?.ellipsoid;
    const pickedCartesian = camera?.pickEllipsoid?.(cesiumPoint, ellipsoid);
    const pickedCoordinate = getLonLatFromCartesian(pickedCartesian, 'cesium.camera.pickEllipsoid');

    if (pickedCoordinate) {
      return createClickPickResult(
        pickedCoordinate,
        createClickPickDiagnostics(
          {
            clickPickMethod: pickedCoordinate.method,
            clickPickStatus: 'success',
            pickPositionSupported,
            pickAttempts,
          },
          viewer,
        ),
      );
    }
  } catch {
    // Fall back to VWorld native coordinate payload below.
  }

  pickAttempts.push(fallbackCoordinate ? fallbackCoordinate.method : 'vworld-coordinate-missing');
  return createFallbackClickPickResult(fallbackCoordinate, viewer, pickAttempts);
}

function extractSelectionFromVWorldClick(
  args: unknown[],
  map: VWorldMapInstance | null,
  source: string,
): VWorldSelection {
  const coordinateFromArgs = extractCoordinateFromValue(args, 'vworld.args');
  const rawEvent = findMouseEvent(args) ?? args[4] ?? args[0];
  const pickResult = pickCoordinateFromCesiumCanvas(
    map,
    rawEvent instanceof MouseEvent ? rawEvent : null,
    coordinateFromArgs,
  );
  const coordinate = pickResult.coordinate;

  return {
    longitude: coordinate?.longitude,
    latitude: coordinate?.latitude,
    method: coordinate?.method,
    source,
    rawEvent,
    clickPickMethod: pickResult.diagnostics.clickPickMethod,
    clickPickStatus: pickResult.diagnostics.clickPickStatus,
    pickPositionSupported: pickResult.diagnostics.pickPositionSupported,
    cameraHeightM: pickResult.diagnostics.cameraHeightM,
    pickAttempts: pickResult.diagnostics.pickAttempts,
    ...getCurrentSelectionControlDiagnostics(),
  };
}

export function createVWorldSelectionFromMouseEvent(
  map: VWorldMapInstance | null,
  event: MouseEvent,
  source = 'dom.click',
): VWorldSelection {
  const pickResult = pickCoordinateFromCesiumCanvas(map, event);
  const coordinate = pickResult.coordinate;

  return {
    longitude: coordinate?.longitude,
    latitude: coordinate?.latitude,
    method: coordinate?.method,
    source,
    rawEvent: event,
    clickPickMethod: pickResult.diagnostics.clickPickMethod,
    clickPickStatus: pickResult.diagnostics.clickPickStatus,
    pickPositionSupported: pickResult.diagnostics.pickPositionSupported,
    cameraHeightM: pickResult.diagnostics.cameraHeightM,
    pickAttempts: pickResult.diagnostics.pickAttempts,
    ...getCurrentSelectionControlDiagnostics(),
  };
}

function createVWorldCameraPosition(
  longitude = HWASEONG_INITIAL_LONGITUDE,
  latitude = HWASEONG_INITIAL_LATITUDE,
  height = HWASEONG_INITIAL_HEIGHT,
  heading = 0,
  pitch = HWASEONG_INITIAL_PITCH,
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
  const method = readObjectValue(map as unknown as Record<string, unknown>, methodName);

  if (typeof method !== 'function') {
    return false;
  }

  method.call(map, argument);
  return true;
}

function focusCesiumViewerOnCoordinate(
  map: VWorldMapInstance | null,
  {
    longitude,
    latitude,
    height,
    heading,
    pitch,
    roll,
  }: {
    longitude: number;
    latitude: number;
    height: number;
    heading: number;
    pitch: number;
    roll: number;
  },
): VWorldMapFocusResult | null {
  const cesium = getCesiumSdk();
  const viewer = findCesiumViewer(map);
  let camera: CesiumViewerLike['camera'] | undefined;

  try {
    camera = viewer?.scene?.camera ?? viewer?.camera;
  } catch {
    camera = undefined;
  }

  if (!cesium?.Cartesian3?.fromDegrees || !camera) {
    return null;
  }

  const destination = cesium.Cartesian3.fromDegrees(longitude, latitude, height);
  const orientation =
    cesium.Math?.toRadians && (heading !== 0 || pitch !== 0 || roll !== 0)
      ? {
          heading: cesium.Math.toRadians(heading),
          pitch: cesium.Math.toRadians(pitch),
          roll: cesium.Math.toRadians(roll),
        }
      : undefined;
  const cameraOptions = orientation ? { destination, orientation } : { destination };

  try {
    if (typeof camera.setView === 'function') {
      camera.setView(cameraOptions);

      return {
        moved: true,
        method: 'cesium.camera.setView',
        message: '선택 건물 중심으로 Cesium 카메라를 이동했습니다.',
      };
    }
  } catch {
    // Try flyTo below.
  }

  try {
    if (typeof camera.flyTo === 'function') {
      camera.flyTo({ ...cameraOptions, duration: 0.4 });

      return {
        moved: true,
        method: 'cesium.camera.flyTo',
        message: '선택 건물 중심으로 Cesium 카메라 이동을 예약했습니다.',
      };
    }
  } catch {
    return null;
  }

  return null;
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

  const cesiumFocusResult = focusCesiumViewerOnCoordinate(map, {
    longitude,
    latitude,
    height,
    heading,
    pitch,
    roll,
  });

  if (cesiumFocusResult) {
    return cesiumFocusResult;
  }

  if (!ENABLE_VWORLD_CAMERA_FALLBACK) {
    return {
      moved: false,
      method: '',
      message: 'Cesium 카메라를 찾지 못해 VWorld wrapper 이동 호출을 건너뛰었습니다.',
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
  let lastSelection:
    | {
        longitude: number;
        latitude: number;
        selectedAt: number;
      }
    | null = null;
  let suppressClickUntil = 0;
  let wasMultiTouchGesture = false;
  let activeLeftPointer:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        startedAt: number;
        maxMovePx: number;
      }
    | null = null;
  const activeTouchPointers = new Map<number, { startX: number; startY: number; maxMovePx: number }>();

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
  focusVWorldMapOnCoordinate(map, {
    longitude: HWASEONG_INITIAL_LONGITUDE,
    latitude: HWASEONG_INITIAL_LATITUDE,
    height: HWASEONG_INITIAL_HEIGHT,
    pitch: HWASEONG_INITIAL_PITCH,
  });
  const cleanupCameraControlConfiguration = scheduleCesiumCameraControlConfiguration(map);

  function updateClickDiagnostics(selection: VWorldSelection, status: 'selected' | 'ignored') {
    const selectionInputControls = getCurrentSelectionControlDiagnostics();

    window.__solarMateMapDiagnostics = {
      ...(window.__solarMateMapDiagnostics ?? {}),
      selectionInputControls,
      lastClickSelection: {
        status,
        source: selection.source ?? '-',
        method: selection.method ?? '-',
        clickPickMethod: selection.clickPickMethod ?? selection.method ?? '-',
        clickPickStatus: selection.clickPickStatus ?? 'failed',
        pickPositionSupported: selection.pickPositionSupported ?? false,
        cameraHeightM: selection.cameraHeightM ?? null,
        longitude: selection.longitude ?? null,
        latitude: selection.latitude ?? null,
        cameraControlMode: selectionInputControls.cameraControlMode,
        leftDragNavigationDisabled: selectionInputControls.leftDragNavigationDisabled,
        rightDragNavigationEnabled: selectionInputControls.rightDragNavigationEnabled,
        lastPointerMovePx: selectionInputControls.lastPointerMovePx,
        lastSelectionIgnoredBecauseDrag: selectionInputControls.lastSelectionIgnoredBecauseDrag,
        selectedAt: new Date().toISOString(),
      },
    };
  }

  function isDuplicateSelection(selection: VWorldSelection) {
    if (
      !lastSelection ||
      !isFiniteNumber(selection.longitude) ||
      !isFiniteNumber(selection.latitude) ||
      Date.now() - lastSelection.selectedAt > DUPLICATE_CLICK_WINDOW_MS
    ) {
      return false;
    }

    return (
      Math.abs(lastSelection.longitude - selection.longitude) < 0.00005 &&
      Math.abs(lastSelection.latitude - selection.latitude) < 0.00005
    );
  }

  function emitSelection(selection: VWorldSelection) {
    if (Date.now() < suppressClickUntil) {
      updateClickDiagnostics(selection, 'ignored');
      return;
    }

    if (!isFiniteNumber(selection.longitude) || !isFiniteNumber(selection.latitude)) {
      updateClickDiagnostics(selection, 'ignored');
      return;
    }

    if (isDuplicateSelection(selection)) {
      updateClickDiagnostics(selection, 'ignored');
      return;
    }

    lastSelection = {
      longitude: selection.longitude,
      latitude: selection.latitude,
      selectedAt: Date.now(),
    };
    updateCameraControlDiagnostics({
      lastPointerMovePx: selection.lastPointerMovePx ?? readCameraControlDiagnostics().lastPointerMovePx,
      lastSelectionIgnoredBecauseDrag: false,
    });
    updateClickDiagnostics(selection, 'selected');
    onSelect?.(selection);
  }

  // VWorld native click usually provides the most stable map-coordinate payload.
  // React shell click capture remains as a delayed fallback from RiskMapPage.
  const clickHandler = (...args: unknown[]) => {
    emitSelection(extractSelectionFromVWorldClick(args, map, 'vworld.onClick'));
  };
  map.onClick?.addEventListener?.(clickHandler);

  const mapElement = document.getElementById(mapId);

  const markTouchGestureForSuppression = () => {
    suppressClickUntil = Date.now() + TOUCH_GESTURE_SUPPRESS_CLICK_MS;
  };

  const markLeftDragForSuppression = (movePx: number) => {
    if (!MAP_LEFT_CLICK_SELECT_ONLY) {
      return;
    }

    suppressClickUntil = Date.now() + POINTER_DRAG_SUPPRESS_CLICK_MS;
    updateCameraControlDiagnostics({
      lastPointerMovePx: Math.round(movePx * 10) / 10,
      lastSelectionIgnoredBecauseDrag: true,
    });
  };

  const pointerDownHandler = (event: PointerEvent) => {
    if (MAP_LEFT_CLICK_SELECT_ONLY && event.pointerType === 'mouse' && event.button === 0) {
      activeLeftPointer = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        maxMovePx: 0,
      };
      updateCameraControlDiagnostics({
        lastPointerMovePx: 0,
        lastSelectionIgnoredBecauseDrag: false,
      });
      return;
    }

    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      return;
    }

    activeTouchPointers.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      maxMovePx: 0,
    });
    wasMultiTouchGesture = wasMultiTouchGesture || activeTouchPointers.size > 1;
  };

  const pointerMoveHandler = (event: PointerEvent) => {
    if (activeLeftPointer?.pointerId === event.pointerId) {
      const movePx = Math.hypot(event.clientX - activeLeftPointer.startX, event.clientY - activeLeftPointer.startY);
      activeLeftPointer.maxMovePx = Math.max(activeLeftPointer.maxMovePx, movePx);

      if (activeLeftPointer.maxMovePx > LEFT_CLICK_SELECT_MAX_MOVE_PX) {
        markLeftDragForSuppression(activeLeftPointer.maxMovePx);
      }
      return;
    }

    const pointer = activeTouchPointers.get(event.pointerId);

    if (!pointer) {
      return;
    }

    const movePx = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
    pointer.maxMovePx = Math.max(pointer.maxMovePx, movePx);

    if (pointer.maxMovePx > TOUCH_TAP_MAX_MOVE_PX || activeTouchPointers.size > 1) {
      markTouchGestureForSuppression();
    }
  };

  const pointerUpHandler = (event: PointerEvent) => {
    if (activeLeftPointer?.pointerId === event.pointerId) {
      const movePx = Math.hypot(event.clientX - activeLeftPointer.startX, event.clientY - activeLeftPointer.startY);
      activeLeftPointer.maxMovePx = Math.max(activeLeftPointer.maxMovePx, movePx);

      if (activeLeftPointer.maxMovePx > LEFT_CLICK_SELECT_MAX_MOVE_PX) {
        markLeftDragForSuppression(activeLeftPointer.maxMovePx);
      } else {
        updateCameraControlDiagnostics({
          lastPointerMovePx: Math.round(activeLeftPointer.maxMovePx * 10) / 10,
          lastSelectionIgnoredBecauseDrag: false,
        });
      }

      activeLeftPointer = null;
      return;
    }

    const pointer = activeTouchPointers.get(event.pointerId);

    if (pointer && (pointer.maxMovePx > TOUCH_TAP_MAX_MOVE_PX || wasMultiTouchGesture)) {
      markTouchGestureForSuppression();
    }

    activeTouchPointers.delete(event.pointerId);

    if (activeTouchPointers.size === 0) {
      wasMultiTouchGesture = false;
    }
  };

  const touchMoveHandler = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      markTouchGestureForSuppression();
    }
  };

  const contextMenuHandler = (event: MouseEvent) => {
    if (MAP_LEFT_CLICK_SELECT_ONLY) {
      event.preventDefault();
    }
  };

  mapElement?.addEventListener('pointerdown', pointerDownHandler, { passive: true });
  mapElement?.addEventListener('pointermove', pointerMoveHandler, { passive: true });
  mapElement?.addEventListener('pointerup', pointerUpHandler, { passive: true });
  mapElement?.addEventListener('pointercancel', pointerUpHandler, { passive: true });
  mapElement?.addEventListener('touchmove', touchMoveHandler, { passive: true });
  mapElement?.addEventListener('contextmenu', contextMenuHandler);

  return {
    map,
    dispose: () => {
      cleanupCameraControlConfiguration();
      map?.onClick?.removeEventListener?.(clickHandler);
      mapElement?.removeEventListener('pointerdown', pointerDownHandler);
      mapElement?.removeEventListener('pointermove', pointerMoveHandler);
      mapElement?.removeEventListener('pointerup', pointerUpHandler);
      mapElement?.removeEventListener('pointercancel', pointerUpHandler);
      mapElement?.removeEventListener('touchmove', touchMoveHandler);
      mapElement?.removeEventListener('contextmenu', contextMenuHandler);
      map?.destroy?.();
      document.getElementById(mapId)?.replaceChildren();
    },
  };
}
