/**
 * Parse the first polygon found in a KML document (e.g. an ArcGIS export)
 * into a [lat, lng][] ring. Only the outer boundary of the first
 * Placemark/Polygon found is used — inner boundaries (holes) and any
 * additional polygons in the file are ignored.
 */
export function parseKmlPolygon(kmlText: string): [number, number][] | null {
  const doc = new DOMParser().parseFromString(kmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;

  const placemarks = doc.getElementsByTagName("Placemark");
  for (let i = 0; i < placemarks.length; i++) {
    const polygon = placemarks[i].getElementsByTagName("Polygon")[0];
    if (!polygon) continue;

    const ring = extractOuterRing(polygon);
    if (ring && ring.length >= 3) return ring;
  }

  return null;
}

function extractOuterRing(polygon: Element): [number, number][] | null {
  const outerBoundary = polygon.getElementsByTagName("outerBoundaryIs")[0];
  const coordsEl = outerBoundary?.getElementsByTagName("coordinates")[0];
  if (!coordsEl?.textContent) return null;

  return parseCoordinates(coordsEl.textContent);
}

function parseCoordinates(text: string): [number, number][] {
  const points: [number, number][] = text
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const [lng, lat] = tuple.split(",").map(Number);
      return [lat, lng] as [number, number];
    })
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }

  return points;
}
