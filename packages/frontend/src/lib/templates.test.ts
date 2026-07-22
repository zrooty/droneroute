import { describe, it, expect } from "vitest";
import {
  clipSegmentToPolygon,
  generateGrid,
  DEFAULT_GRID_PARAMS,
  type GridParams,
} from "./templates";
import { haversineDistance } from "./geo";

const baseParams: GridParams = {
  ...DEFAULT_GRID_PARAMS,
  corner1: [0, 0],
  corner2: [0.001, 0.002], // small rectangle, ~111m x ~222m
  spacingMode: "manual",
};

describe("generateGrid — manual mode (unchanged behavior)", () => {
  it("attaches a takePhoto action to every waypoint when addPhotos is on", () => {
    const result = generateGrid({ ...baseParams, addPhotos: true });
    expect(result.waypoints.length).toBeGreaterThan(0);
    for (const wp of result.waypoints) {
      expect(wp.actions).toHaveLength(1);
      expect(wp.actions[0].actionType).toBe("takePhoto");
      expect(wp.actionTrigger).toBeUndefined();
    }
  });

  it("attaches no actions when addPhotos is off", () => {
    const result = generateGrid({ ...baseParams, addPhotos: false });
    for (const wp of result.waypoints) {
      expect(wp.actions).toHaveLength(0);
      expect(wp.actionTrigger).toBeUndefined();
    }
  });
});

describe("generateGrid — overlap mode (dense mapping waypoints)", () => {
  it("drops a photo waypoint every ~photoIntervalM along each pass, no triggers", () => {
    const result = generateGrid({
      ...baseParams,
      spacingMode: "overlap",
      addPhotos: true,
      photoIntervalM: 25,
    });
    expect(result.waypoints.length).toBeGreaterThan(0);

    // Every dense waypoint takes one photo; none uses a distance trigger.
    for (const wp of result.waypoints) {
      expect(wp.actions).toHaveLength(1);
      expect(wp.actions[0].actionType).toBe("takePhoto");
      expect(wp.actionTrigger).toBeUndefined();
    }
  });

  it("spaces consecutive photo waypoints no farther apart than the interval", () => {
    const interval = 25;
    const result = generateGrid({
      ...baseParams,
      spacingMode: "overlap",
      addPhotos: true,
      photoIntervalM: interval,
    });
    // Along a pass, steps are rounded so spacing stays within the interval
    // (+ small rounding slack). Turn segments between passes are the only
    // larger gaps; assert most consecutive gaps stay within the interval.
    let withinInterval = 0;
    for (let i = 1; i < result.waypoints.length; i++) {
      const a = result.waypoints[i - 1];
      const b = result.waypoints[i];
      const d = haversineDistance(
        a.latitude,
        a.longitude,
        b.latitude,
        b.longitude,
      );
      if (d <= interval * 1.2) withinInterval++;
    }
    expect(withinInterval).toBeGreaterThan(result.waypoints.length / 2);
  });

  it("produces more waypoints than manual mode (densification)", () => {
    const manual = generateGrid({
      ...baseParams,
      spacingMode: "manual",
      spacingM: 50,
    });
    const overlap = generateGrid({
      ...baseParams,
      spacingMode: "overlap",
      spacingM: 50,
      addPhotos: true,
      photoIntervalM: 25,
    });
    expect(overlap.waypoints.length).toBeGreaterThan(manual.waypoints.length);
  });

  it("attaches no actions when addPhotos is off, even in overlap mode", () => {
    const result = generateGrid({
      ...baseParams,
      spacingMode: "overlap",
      addPhotos: false,
      photoIntervalM: 25,
    });
    for (const wp of result.waypoints) {
      expect(wp.actions).toHaveLength(0);
      expect(wp.actionTrigger).toBeUndefined();
    }
  });
});

// Plain rectangle, corners (Y=lat, X=lng) at (0,0)-(0,10)-(10,10)-(10,0).
const SQUARE: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

// Rectangle with a full-depth notch cut into the top edge between X=4 and
// X=6, reaching all the way down to Y=4. A horizontal scan line through the
// notch (e.g. Y=7) crosses the boundary 4 times: left edge, notch's left
// wall, notch's right wall, right edge.
const NOTCHED_RECTANGLE: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 6],
  [4, 6],
  [4, 4],
  [10, 4],
  [10, 0],
];

describe("clipSegmentToPolygon", () => {
  it("clips a row that overshoots a convex polygon down to its entry/exit points", () => {
    const clipped = clipSegmentToPolygon([5, -5], [5, 15], SQUARE);
    expect(clipped).toEqual([
      [5, 0],
      [5, 10],
    ]);
  });

  it("returns null for a row that never touches the polygon", () => {
    const clipped = clipSegmentToPolygon([15, -5], [15, 15], SQUARE);
    expect(clipped).toBeNull();
  });

  it("flies straight across an interior gap in a concave polygon instead of splitting the row", () => {
    const clipped = clipSegmentToPolygon([7, -5], [7, 15], NOTCHED_RECTANGLE);
    // 4 crossings at X=0, 4, 6, 10 — clip keeps only the outermost pair.
    expect(clipped).toEqual([
      [7, 0],
      [7, 10],
    ]);
  });
});

describe("generateGrid with a polygon", () => {
  const polygonBaseParams: GridParams = {
    ...DEFAULT_GRID_PARAMS,
    corner1: [41.25, 0.92],
    corner2: [41.252, 0.924],
    altitude: 50,
    spacingM: 60,
    addPhotos: false,
    rotationDeg: 0,
    reverse: false,
    spacingMode: "manual",
  };

  it("produces identical waypoints to the unclipped rectangle when the polygon fully encloses the bounding box", () => {
    const enclosingPolygon: [number, number][] = [
      [41.24, 0.91],
      [41.24, 0.936],
      [41.264, 0.936],
      [41.264, 0.91],
    ];

    const unclipped = generateGrid(polygonBaseParams);
    const clipped = generateGrid({
      ...polygonBaseParams,
      polygon: enclosingPolygon,
    });

    expect(clipped.waypoints).toEqual(unclipped.waypoints);
  });

  it("produces fewer waypoints than the unclipped rectangle for a sub-area triangle", () => {
    const triangle: [number, number][] = [
      [41.25, 0.92],
      [41.25, 0.924],
      [41.2508, 0.92],
    ];

    const unclipped = generateGrid(polygonBaseParams);
    const clipped = generateGrid({ ...polygonBaseParams, polygon: triangle });

    expect(clipped.waypoints.length).toBeGreaterThan(0);
    expect(clipped.waypoints.length).toBeLessThan(unclipped.waypoints.length);
  });
});
