import type { BuildingFootprintDiagnostics } from '../lib/buildingFootprints';

export type BuildingPolygonSource = 'api' | 'geojson' | 'admdong_index';

export type BuildingPolygonSourceMode = BuildingPolygonSource | 'none';

export type LngLatCoordinate = [longitude: number, latitude: number];

export type BuildingPolygonGeometry =
  | {
      type: 'Polygon';
      coordinates: LngLatCoordinate[][];
    }
  | {
      type: 'MultiPolygon';
      coordinates: LngLatCoordinate[][][];
    };

export type BuildingPolygonProperties = Record<string, unknown>;

export type BuildingPolygonFeature = {
  type: 'Feature';
  id?: string | number;
  properties?: BuildingPolygonProperties | null;
  geometry: BuildingPolygonGeometry;
};

export type BuildingPolygonFeatureCollection = {
  type: 'FeatureCollection';
  features: BuildingPolygonFeature[];
};

export type BuildingPolygonRecord = {
  id: string;
  address: string;
  name: string;
  geometryType: BuildingPolygonGeometry['type'];
  source: BuildingPolygonSource;
  sourceLabel: string;
  feature: BuildingPolygonFeature;
  footprintPolygon: LngLatCoordinate[];
};

export type BuildingPolygonProxySuccessResponse = {
  ok: true;
  source: 'api';
  building: Omit<BuildingPolygonRecord, 'source' | 'sourceLabel' | 'footprintPolygon'> & {
    source: 'api';
    sourceLabel: string;
  };
};

export type BuildingPolygonProxyErrorResponse = {
  ok: false;
  message: string;
};

export type BuildingPolygonProxyResponse =
  | BuildingPolygonProxySuccessResponse
  | BuildingPolygonProxyErrorResponse;

export type BuildingPolygonSelectionResult =
  | {
      status: 'found';
      building: BuildingPolygonRecord;
      diagnostics?: BuildingFootprintDiagnostics;
      candidateFeatures?: BuildingPolygonFeature[];
    }
  | {
      status: 'unconfigured' | 'not_found' | 'error';
      source: BuildingPolygonSourceMode;
      sourceLabel: string;
      message: string;
      diagnostics?: BuildingFootprintDiagnostics;
      candidateFeatures?: BuildingPolygonFeature[];
    };

