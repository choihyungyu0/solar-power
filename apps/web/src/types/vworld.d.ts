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
    setOption?: (options: VWorldMapOptions) => void;
    setMapId?: (mapId: string) => void;
    setInitPosition?: (position: VWorldCameraPosition) => void;
    setLogoVisible?: (visible: boolean) => void;
    setNavigationZoomVisible?: (visible: boolean) => void;
    start?: () => void;
    destroy?: () => void;
    onClick?: {
      addEventListener?: (handler: VWorldClickHandler) => void;
      removeEventListener?: (handler: VWorldClickHandler) => void;
    };
  };

  type VWorldSdk = {
    Map: new () => VWorldMapInstance;
    CameraPosition: new (coord: unknown, direction: unknown) => VWorldCameraPosition;
    CoordZ: new (longitude: number, latitude: number, height: number) => unknown;
    Direction: new (heading: number, pitch: number, roll: number) => unknown;
  };

  interface Window {
    vw?: VWorldSdk;
    Cesium?: unknown;
    ws3d?: unknown;
  }
}
