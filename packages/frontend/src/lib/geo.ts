import type {
  Waypoint,
  PointOfInterest,
  Obstacle,
  UnitSystem,
} from "@droneroute/shared";
import { formatArea as formatAreaUnit } from "@/lib/units";

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate the ideal gimbal pitch angle for a waypoint pointing at a POI.
 * Uses trigonometry: pitch = -atan2(heightDiff, horizontalDist)
 * Returns degrees where 0 = horizon, -90 = straight down, plus the 3D slant distance.
 */
export function calculateIdealGimbalPitch(
  wp: Waypoint,
  poi: PointOfInterest,
): { pitch: number; distance: number } {
  const horizontalDist = haversineDistance(
    wp.latitude,
    wp.longitude,
    poi.latitude,
    poi.longitude,
  );
  const heightDiff = wp.height - poi.height; // positive = drone is above POI
  if (horizontalDist < 0.01) return { pitch: -90, distance: 0 }; // directly above → straight down
  const angleRad = Math.atan2(heightDiff, horizontalDist);
  const pitch = Math.round(-angleRad * (180 / Math.PI));
  const distance = Math.sqrt(horizontalDist ** 2 + heightDiff ** 2);
  return { pitch, distance };
}

// ── Obstacle geometry utilities ──────────────────────────

/**
 * Ray-casting point-in-polygon test.
 * Returns true if the point [lat, lng] is inside the polygon.
 */
export function pointInPolygon(
  point: [number, number],
  polygon: [number, number][],
): boolean {
  const [py, px] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [iy, ix] = polygon[i];
    const [jy, jx] = polygon[j];
    if (iy > py !== jy > py && px < ((jx - ix) * (py - iy)) / (jy - iy) + ix) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Test if two line segments (p1→p2) and (p3→p4) intersect.
 */
function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

function direction(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): number {
  return (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
}

function onSegment(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): boolean {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  );
}

/**
 * Test if a line segment (p1→p2) intersects any edge of a polygon.
 */
export function segmentIntersectsPolygon(
  p1: [number, number],
  p2: [number, number],
  polygon: [number, number][],
): boolean {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (segmentsIntersect(p1, p2, polygon[j], polygon[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Obstacle warning describing a flight path conflict.
 */
export interface ObstacleWarning {
  obstacleId: string;
  obstacleName: string;
  waypointIndex: number;
  type: "crosses" | "inside";
}

/**
 * Check all waypoints and flight path segments against all obstacles.
 * Returns a list of warnings for any conflicts found.
 */
export function getObstacleWarnings(
  waypoints: { latitude: number; longitude: number; index: number }[],
  obstacles: Obstacle[],
): ObstacleWarning[] {
  if (obstacles.length === 0 || waypoints.length === 0) return [];

  const warnings: ObstacleWarning[] = [];

  for (const obstacle of obstacles) {
    if (obstacle.vertices.length < 3) continue;

    // Check waypoints inside polygon
    for (const wp of waypoints) {
      if (pointInPolygon([wp.latitude, wp.longitude], obstacle.vertices)) {
        warnings.push({
          obstacleId: obstacle.id,
          obstacleName: obstacle.name,
          waypointIndex: wp.index,
          type: "inside",
        });
      }
    }

    // Check segments crossing polygon
    for (let i = 0; i < waypoints.length - 1; i++) {
      const wp1 = waypoints[i];
      const wp2 = waypoints[i + 1];
      const p1: [number, number] = [wp1.latitude, wp1.longitude];
      const p2: [number, number] = [wp2.latitude, wp2.longitude];

      if (segmentIntersectsPolygon(p1, p2, obstacle.vertices)) {
        warnings.push({
          obstacleId: obstacle.id,
          obstacleName: obstacle.name,
          waypointIndex: wp1.index,
          type: "crosses",
        });
      }
    }
  }

  return warnings;
}

/**
 * Compute the approximate area of a polygon on the Earth's surface.
 * Uses the Shoelace formula on projected coordinates (equirectangular).
 * Returns area in square meters.
 */
export function polygonArea(vertices: [number, number][]): number {
  if (vertices.length < 3) return 0;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Use centroid latitude for equirectangular projection scale
  const avgLat = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
  const cosLat = Math.cos(toRad(avgLat));
  const R = 6371000; // Earth radius in meters

  // Convert to local meters using equirectangular projection
  const refLat = vertices[0][0];
  const refLng = vertices[0][1];
  const projected = vertices.map((v) => [
    (v[1] - refLng) * toRad(1) * R * cosLat, // x (east)
    (v[0] - refLat) * toRad(1) * R, // y (north)
  ]);

  // Shoelace formula
  let area = 0;
  for (let i = 0, j = projected.length - 1; i < projected.length; j = i++) {
    area += projected[j][0] * projected[i][1];
    area -= projected[i][0] * projected[j][1];
  }

  return Math.abs(area / 2);
}

/**
 * Format an area value as a human-readable string.
 */
export function formatArea(
  areaM2: number,
  unitSystem: UnitSystem = "metric",
): string {
  return formatAreaUnit(areaM2, unitSystem);
}

// ── Airspace zone intersection utilities ─────────────────

export interface AirspaceWarning {
  zoneId: string;
  zoneName: string;
  severity: "prohibited" | "restricted";
  type: "crosses" | "inside";
}

/**
 * Extract [lat, lng] polygon rings from a GeoJSON geometry.
 * Handles Polygon and MultiPolygon. GeoJSON coordinates are [lng, lat],
 * so we swap them to [lat, lng] to match our convention.
 */
function extractPolygons(geometry: GeoJSON.Geometry): [number, number][][] {
  const rings: [number, number][][] = [];
  if (geometry.type === "Polygon") {
    rings.push(
      geometry.coordinates[0].map(
        ([lng, lat]) => [lat, lng] as [number, number],
      ),
    );
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) {
      rings.push(poly[0].map(([lng, lat]) => [lat, lng] as [number, number]));
    }
  }
  return rings;
}

/**
 * Check all waypoints and flight path segments against airspace zones.
 * Returns deduplicated warnings (one per zone).
 */
export function getAirspaceWarnings(
  waypoints: { latitude: number; longitude: number }[],
  zones: {
    id: string;
    name: string;
    severity: "prohibited" | "restricted";
    geometry: GeoJSON.Geometry;
  }[],
): AirspaceWarning[] {
  if (zones.length === 0 || waypoints.length === 0) return [];

  const warnings = new Map<string, AirspaceWarning>();

  for (const zone of zones) {
    const polygons = extractPolygons(zone.geometry);
    if (polygons.length === 0) continue;

    for (const ring of polygons) {
      if (ring.length < 3) continue;

      // Check if any waypoint is inside
      for (const wp of waypoints) {
        if (pointInPolygon([wp.latitude, wp.longitude], ring)) {
          warnings.set(zone.id, {
            zoneId: zone.id,
            zoneName: zone.name,
            severity: zone.severity,
            type: "inside",
          });
          break;
        }
      }

      if (warnings.has(zone.id)) break;

      // Check if any segment crosses the polygon
      for (let i = 0; i < waypoints.length - 1; i++) {
        const p1: [number, number] = [
          waypoints[i].latitude,
          waypoints[i].longitude,
        ];
        const p2: [number, number] = [
          waypoints[i + 1].latitude,
          waypoints[i + 1].longitude,
        ];
        if (segmentIntersectsPolygon(p1, p2, ring)) {
          warnings.set(zone.id, {
            zoneId: zone.id,
            zoneName: zone.name,
            severity: zone.severity,
            type: "crosses",
          });
          break;
        }
      }

      if (warnings.has(zone.id)) break;
    }
  }

  return Array.from(warnings.values());
}

// ── Flight stats & mission splitting ─────────────────────

/** Per-segment great-circle distance (meters), one entry per consecutive pair. */
export function segmentDistances(
  waypoints: { latitude: number; longitude: number }[],
): number[] {
  const distances: number[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    distances.push(
      haversineDistance(
        waypoints[i - 1].latitude,
        waypoints[i - 1].longitude,
        waypoints[i].latitude,
        waypoints[i].longitude,
      ),
    );
  }
  return distances;
}

/** Total distance (m) and flight time (s) using per-segment speeds. */
export function estimateFlightStats(
  waypoints: {
    latitude: number;
    longitude: number;
    speed: number;
    useGlobalSpeed: boolean;
  }[],
  globalSpeedMs: number,
): { distance: number; time: number } {
  const distances = segmentDistances(waypoints);
  let distance = 0;
  let time = 0;
  for (let i = 0; i < distances.length; i++) {
    const speed = waypoints[i].useGlobalSpeed
      ? globalSpeedMs
      : waypoints[i].speed;
    distance += distances[i];
    time += speed > 0 ? distances[i] / speed : 0;
  }
  return { distance, time };
}

/**
 * Split a waypoint path into `partCount` sequential parts of roughly equal
 * cumulative distance. Each part after the first is prefixed with a
 * duplicate of the previous part's last waypoint, so consecutive parts
 * share one coincident waypoint (matches how DJI Pilot itself splits a
 * flown mission into multiple KMZ files).
 *
 * Never cuts between a grid-overlap-mode waypoint and its
 * `actionTrigger.endIndex` pair — nudges that cut forward by one waypoint
 * instead, since a `multipleDistance` action group can't span two files.
 */
export function splitWaypointsByDistance<
  T extends {
    latitude: number;
    longitude: number;
    actionTrigger?: { endIndex: number };
  },
>(waypoints: T[], partCount: number): T[][] {
  if (partCount <= 1 || waypoints.length < 2) return [waypoints];

  const distances = segmentDistances(waypoints);
  const cumulative = [0];
  for (const d of distances)
    cumulative.push(cumulative[cumulative.length - 1] + d);
  const total = cumulative[cumulative.length - 1];

  const cuts: number[] = [];
  for (let k = 1; k < partCount; k++) {
    const target = (total * k) / partCount;
    let bestIdx = 1;
    let bestDiff = Infinity;
    for (let idx = 1; idx < waypoints.length; idx++) {
      const diff = Math.abs(cumulative[idx] - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = idx;
      }
    }
    if (
      waypoints[bestIdx]?.actionTrigger &&
      waypoints[bestIdx].actionTrigger.endIndex > bestIdx
    ) {
      bestIdx = Math.min(bestIdx + 1, waypoints.length - 1);
    }
    const prev = cuts[cuts.length - 1] ?? 0;
    const nextCut = Math.max(bestIdx, prev + 1);
    if (nextCut >= waypoints.length - 1) break; // no room for another part
    cuts.push(nextCut);
  }

  const parts: T[][] = [];
  let start = 0;
  for (const cut of cuts) {
    parts.push(waypoints.slice(start, cut + 1));
    start = cut;
  }
  parts.push(waypoints.slice(start));
  return parts.every((p) => p.length >= 2) ? parts : [waypoints];
}

/**
 * Rebase a waypoint slice's `.index` (and any `.actionTrigger.endIndex`) so
 * the first waypoint is index 0 — required before exporting a split part as
 * its own standalone WPML mission (`buildTemplateKml`/`buildWaylinesWpml`
 * emit `<wpml:index>` from `.index`, not array position).
 */
export function reindexFromZero(waypoints: Waypoint[]): Waypoint[] {
  const base = waypoints[0]?.index ?? 0;
  return waypoints.map((wp) => ({
    ...wp,
    index: wp.index - base,
    actionTrigger: wp.actionTrigger
      ? { ...wp.actionTrigger, endIndex: wp.actionTrigger.endIndex - base }
      : undefined,
  }));
}
