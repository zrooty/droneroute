import { describe, it, expect } from "vitest";
import {
  segmentDistances,
  estimateFlightStats,
  splitWaypointsByDistance,
  reindexFromZero,
} from "./geo";
import type { Waypoint } from "@droneroute/shared";

// ~111m per 0.001 deg latitude at the equator — small, easy-to-reason-about steps
function wp(
  lat: number,
  index = 0,
  overrides: Partial<Waypoint> = {},
): Waypoint {
  return {
    index,
    name: `Waypoint ${index + 1}`,
    latitude: lat,
    longitude: 0,
    height: 30,
    speed: 7,
    useGlobalSpeed: true,
    useGlobalHeight: false,
    useGlobalHeadingParam: true,
    useGlobalTurnParam: true,
    gimbalPitchAngle: -90,
    actions: [],
    ...overrides,
  };
}

describe("segmentDistances", () => {
  it("returns one distance per consecutive pair", () => {
    const waypoints = [wp(0), wp(0.001), wp(0.002)];
    const distances = segmentDistances(waypoints);
    expect(distances).toHaveLength(2);
    expect(distances[0]).toBeCloseTo(distances[1], 0);
    expect(distances[0]).toBeGreaterThan(100);
    expect(distances[0]).toBeLessThan(120);
  });
});

describe("estimateFlightStats", () => {
  it("uses global speed when useGlobalSpeed is true", () => {
    const waypoints = [wp(0), wp(0.001)];
    const { distance, time } = estimateFlightStats(waypoints, 10);
    expect(time).toBeCloseTo(distance / 10, 1);
  });

  it("uses per-waypoint speed when useGlobalSpeed is false", () => {
    const waypoints = [
      wp(0, 0, { useGlobalSpeed: false, speed: 5 }),
      wp(0.001, 1),
    ];
    const { distance, time } = estimateFlightStats(waypoints, 10);
    expect(time).toBeCloseTo(distance / 5, 1);
  });
});

describe("splitWaypointsByDistance", () => {
  it("returns the input unchanged for partCount <= 1", () => {
    const waypoints = [wp(0, 0), wp(0.001, 1), wp(0.002, 2)];
    expect(splitWaypointsByDistance(waypoints, 1)).toEqual([waypoints]);
  });

  it("splits an evenly-spaced path into two roughly equal parts sharing a boundary waypoint", () => {
    const waypoints = Array.from({ length: 11 }, (_, i) => wp(i * 0.001, i));
    const parts = splitWaypointsByDistance(waypoints, 2);
    expect(parts).toHaveLength(2);
    // last of part 1 === first of part 2 (the shared boundary waypoint)
    expect(parts[0][parts[0].length - 1]).toEqual(parts[1][0]);
    // every waypoint accounted for, minus one shared duplicate
    expect(parts[0].length + parts[1].length - 1).toBe(waypoints.length);
    // roughly balanced (within one waypoint's worth of distance)
    expect(Math.abs(parts[0].length - parts[1].length)).toBeLessThanOrEqual(2);
  });

  it("never cuts inside a multipleDistance actionTrigger pair", () => {
    const waypoints = Array.from({ length: 11 }, (_, i) => wp(i * 0.001, i));
    // Force the midpoint pair (indices 5,6) to be a continuous-photo action group
    waypoints[5] = {
      ...waypoints[5],
      actionTrigger: { type: "multipleDistance", distanceM: 5, endIndex: 6 },
    };
    const parts = splitWaypointsByDistance(waypoints, 2);
    // waypoint 5 (the trigger start) and waypoint 6 (its endIndex) must land in the same part
    const partOfIndex5 = parts.findIndex((p) => p.some((w) => w.index === 5));
    const partOfIndex6 = parts.findIndex((p) => p.some((w) => w.index === 6));
    expect(partOfIndex5).toBe(partOfIndex6);
  });

  it("clamps to a single part when there are too few waypoints for the requested count", () => {
    const waypoints = [wp(0, 0), wp(0.001, 1)];
    const parts = splitWaypointsByDistance(waypoints, 5);
    expect(parts.length).toBeLessThanOrEqual(2);
    for (const part of parts) expect(part.length).toBeGreaterThanOrEqual(2);
  });
});

describe("reindexFromZero", () => {
  it("rebases index and actionTrigger.endIndex to start at 0", () => {
    const waypoints = [
      wp(0, 10, {
        actionTrigger: { type: "multipleDistance", distanceM: 5, endIndex: 11 },
      }),
      wp(0.001, 11),
      wp(0.002, 12),
    ];
    const result = reindexFromZero(waypoints);
    expect(result.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(result[0].actionTrigger?.endIndex).toBe(1);
  });
});
