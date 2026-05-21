import {
  getBuildingFootprintGeoJsonUrl,
  getBuildingPolygonSourceLabel,
  getBuildingPolygonUnconfiguredMessage,
  getConfiguredBuildingPolygonSource,
  loadBuildingFootprints,
} from './buildingFootprints';
import { createBuildingPolygonRecord, selectBuildingByPoint } from './spatialSelect';
import type {
  BuildingPolygonFeature,
  BuildingPolygonProxyResponse,
  BuildingPolygonSelectionResult,
} from '../types/buildingPolygon';

type BuildingPolygonRequestInput = {
  longitude: number;
  latitude: number;
};

async function requestBuildingPolygonFromApi({
  longitude,
  latitude,
}: BuildingPolygonRequestInput): Promise<BuildingPolygonSelectionResult> {
  const response = await fetch('/api/building-polygon', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ longitude, latitude }),
  });
  const payload = (await response.json().catch(() => null)) as BuildingPolygonProxyResponse | null;

  if (!response.ok || !payload?.ok) {
    const message = payload && !payload.ok ? payload.message : '건물 polygon API 조회에 실패했습니다.';

    return {
      status:
        message === getBuildingPolygonUnconfiguredMessage()
          ? 'unconfigured'
          : response.status === 404
            ? 'not_found'
            : 'error',
      source: 'api',
      sourceLabel: getBuildingPolygonSourceLabel('api'),
      message,
    };
  }

  const building = createBuildingPolygonRecord({
    feature: payload.building.feature,
    source: 'api',
    sourceLabel: payload.building.sourceLabel,
  });

  if (!building) {
    return {
      status: 'error',
      source: 'api',
      sourceLabel: getBuildingPolygonSourceLabel('api'),
      message: '건물 polygon API 응답에서 사용할 수 있는 footprint polygon을 찾지 못했습니다.',
    };
  }

  return {
    status: 'found',
    building,
  };
}

async function requestBuildingPolygonFromGeoJson({
  longitude,
  latitude,
}: BuildingPolygonRequestInput): Promise<BuildingPolygonSelectionResult> {
  const geoJsonUrl = getBuildingFootprintGeoJsonUrl();
  const sourceLabel = getBuildingPolygonSourceLabel('geojson');

  if (!geoJsonUrl) {
    return {
      status: 'unconfigured',
      source: 'geojson',
      sourceLabel,
      message: getBuildingPolygonUnconfiguredMessage(),
    };
  }

  try {
    const collection = await loadBuildingFootprints(geoJsonUrl);
    const building = selectBuildingByPoint({
      features: collection.features as BuildingPolygonFeature[],
      longitude,
      latitude,
      source: 'geojson',
      sourceLabel: `${sourceLabel} (${geoJsonUrl})`,
    });

    if (!building) {
      return {
        status: 'not_found',
        source: 'geojson',
        sourceLabel: `${sourceLabel} (${geoJsonUrl})`,
        message: '선택 좌표와 일치하는 화성시 건물 polygon을 찾지 못했습니다.',
      };
    }

    return {
      status: 'found',
      building,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : getBuildingPolygonUnconfiguredMessage();

    return {
      status: message === getBuildingPolygonUnconfiguredMessage() ? 'unconfigured' : 'error',
      source: 'geojson',
      sourceLabel: `${sourceLabel} (${geoJsonUrl})`,
      message,
    };
  }
}

export async function requestSelectedBuildingPolygon(
  input: BuildingPolygonRequestInput,
): Promise<BuildingPolygonSelectionResult> {
  const source = getConfiguredBuildingPolygonSource();

  if (source === 'api') {
    return requestBuildingPolygonFromApi(input);
  }

  if (source === 'geojson') {
    return requestBuildingPolygonFromGeoJson(input);
  }

  return {
    status: 'unconfigured',
    source: 'none',
    sourceLabel: getBuildingPolygonSourceLabel('none'),
    message: getBuildingPolygonUnconfiguredMessage(),
  };
}

