from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, box, shape
from shapely.ops import transform

to_5186 = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
to_4326 = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)


def _polygon_candidates(geom):
    if geom.is_empty:
        return []

    if isinstance(geom, Polygon):
        return [geom]

    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)

    if isinstance(geom, GeometryCollection):
        candidates = []

        for item in geom.geoms:
            candidates.extend(_polygon_candidates(item))

        return candidates

    return []


def pick_largest_polygon(geom):
    repaired = make_valid(geom) if not geom.is_valid else geom
    candidates = [polygon for polygon in _polygon_candidates(repaired) if not polygon.is_empty and polygon.area > 0]

    if not candidates:
        raise ValueError("No usable polygon found from selectedBuildingFeature geometry.")

    return max(candidates, key=lambda polygon: polygon.area)


def normalize_geojson_polygon_4326(geojson_geometry: dict):
    geom = shape(geojson_geometry)
    return pick_largest_polygon(geom)


def geom_4326_to_5186(geojson_geometry: dict):
    geom = normalize_geojson_polygon_4326(geojson_geometry)
    projected = transform(lambda x, y, z=None: to_5186.transform(x, y), geom)
    return pick_largest_polygon(projected)


def geom_5186_to_4326(geom):
    return transform(lambda x, y, z=None: to_4326.transform(x, y), geom)


def lonlat_to_5186(longitude: float, latitude: float):
    return to_5186.transform(longitude, latitude)


def make_cells_in_polygon(polygon_5186, cell_w=1.0, cell_h=3.5, max_cells=300):
    minx, miny, maxx, maxy = polygon_5186.bounds

    cells = []
    cell_id = 0

    y = miny
    while y + cell_h <= maxy:
        x = minx
        while x + cell_w <= maxx:
            cell = box(x, y, x + cell_w, y + cell_h)
            if polygon_5186.contains(cell.centroid):
                cells.append((cell_id, x, y, x + cell_w, y + cell_h))
            cell_id += 1
            x += cell_w
        y += cell_h

    original_count = len(cells)

    if len(cells) > max_cells:
        step = max(1, len(cells) // max_cells)
        cells = cells[::step][:max_cells]

    return cells, original_count


def cell_to_geojson_polygon_4326(cell):
    _cell_id, x1, y1, x2, y2 = cell
    ring_5186 = [
        (x1, y1),
        (x2, y1),
        (x2, y2),
        (x1, y2),
        (x1, y1),
    ]

    ring_4326 = [list(to_4326.transform(x, y)) for x, y in ring_5186]

    return {
        "type": "Polygon",
        "coordinates": [ring_4326],
    }


def cells_to_geojson_4326(cells, shading: dict[int, float]):
    features = []

    for cell_id, x1, y1, x2, y2 in cells:
        if cell_id not in shading:
            continue

        features.append(
            {
                "type": "Feature",
                "geometry": cell_to_geojson_polygon_4326((cell_id, x1, y1, x2, y2)),
                "properties": {
                    "cell_id": cell_id,
                    "shading_score": shading[cell_id],
                    "cell_5186_bbox": [x1, y1, x2, y2],
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
    }
