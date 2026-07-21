// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { parseKmlPolygon } from "./kmlImport";

const SIMPLE_SQUARE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Folder>
    <Placemark>
      <name>1</name>
      <MultiGeometry>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>0.9200,41.2500,0 0.9240,41.2500,0 0.9240,41.2520,0 0.9200,41.2520,0 0.9200,41.2500,0</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </MultiGeometry>
    </Placemark>
  </Folder>
</Document>
</kml>`;

const NO_POLYGON_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark>
    <name>Just a point</name>
    <Point>
      <coordinates>0.9200,41.2500,0</coordinates>
    </Point>
  </Placemark>
</Document>
</kml>`;

const MALFORMED_KML = `<kml><Document><Placemark><Polygon>`;

describe("parseKmlPolygon", () => {
  it("parses a closed square ring into [lat, lng] pairs, dropping the duplicate closing vertex", () => {
    const ring = parseKmlPolygon(SIMPLE_SQUARE_KML);

    expect(ring).toEqual([
      [41.25, 0.92],
      [41.25, 0.924],
      [41.252, 0.924],
      [41.252, 0.92],
    ]);
  });

  it("returns null when the KML has no Polygon element", () => {
    expect(parseKmlPolygon(NO_POLYGON_KML)).toBeNull();
  });

  it("returns null for malformed XML", () => {
    expect(parseKmlPolygon(MALFORMED_KML)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseKmlPolygon("")).toBeNull();
  });
});
