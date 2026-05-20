export {};

declare global {
  type VWorldCameraPosition = unknown;

  type VWorldMapOptions = {
    mapId: string;
    initPosition: VWorldCameraPosition;
    logo: boolean;
    navigation: boolean;
  };

  type VWorldClickHandler = (...args: unknown[]) => void;

  type VWorldMapInstance = {
    addElement?: (object: unknown) => void;
    createMarker?: (id: string, position: unknown, title: string) => unknown;
    flyTo?: (position: unknown) => void;
    getCurrentPosition?: () => unknown;
    lookat?: {
      moveTo?: (position: unknown) => void;
    };
    moveCamera?: (position: unknown) => void;
    moveTo?: (position: unknown) => void;
    setCameraPosition?: (position: unknown) => void;
    setOption?: (options: VWorldMapOptions) => void;
    setPosition?: (position: unknown) => void;
    setMapId?: (mapId: string) => void;
    setInitPosition?: (position: VWorldCameraPosition) => void;
    setLogoVisible?: (visible: boolean) => void;
    setNavigationZoomVisible?: (visible: boolean) => void;
    start?: () => void;
    destroy?: () => void;
    removeLayerElement?: (id: string) => void;
    removeObject?: (object: unknown) => void;
    removeObjectById?: (id: string) => void;
    onClick?: {
      addEventListener?: (handler: VWorldClickHandler) => void;
      removeEventListener?: (handler: VWorldClickHandler) => void;
    };
  };

  type VWorldMapConstructor = new (...args: unknown[]) => VWorldMapInstance;

  type VWorldSdk = {
    Map?: VWorldMapConstructor;
    MapOptions?: new (
      basemapType: unknown,
      layersArr: string,
      controlDensity: unknown,
      interactionDensity: unknown,
      controlsAutoArrange: boolean,
      homePosition: VWorldCameraPosition,
      initPosition: VWorldCameraPosition,
    ) => VWorldMapOptions;
    CameraPosition: new (coord: unknown, direction: unknown) => VWorldCameraPosition;
    Coord: new (longitude: number, latitude: number) => unknown;
    CoordZ: new (longitude: number, latitude: number, height: number) => unknown;
    Direction: new (heading: number, pitch: number, roll: number) => unknown;
    BasemapType?: {
      GRAPHIC?: unknown;
    };
    DensityType?: {
      FULL?: unknown;
      BASIC?: unknown;
      EMPTY?: unknown;
    };
    ol3?: {
      Map?: VWorldMapConstructor;
      BasemapType?: {
        GRAPHIC?: unknown;
      };
      DensityType?: {
        FULL?: unknown;
        BASIC?: unknown;
        EMPTY?: unknown;
      };
    };
    geom?: any;
    layer?: any;
    style?: any;
    Feature?: any;
  };

  interface Window {
    $?: any;
    jQuery?: any;
    vw?: any;
    Cesium?: unknown;
    ws3d?: any;
    VW?: any;
    __solarMateMapDiagnostics?: any;
  }
}
