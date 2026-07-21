import { describe, it, expect } from "vitest";
import {
  generateGrid,
  DEFAULT_GRID_PARAMS,
  type GridParams,
} from "./templates";

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

describe("generateGrid — overlap mode", () => {
  it("attaches actionTrigger only to the first waypoint of each line-pass", () => {
    const result = generateGrid({
      ...baseParams,
      spacingMode: "overlap",
      addPhotos: true,
      photoIntervalM: 25,
    });
    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(result.waypoints.length % 2).toBe(0); // pairs: start + end per line

    for (let i = 0; i < result.waypoints.length; i += 2) {
      const lineStart = result.waypoints[i];
      const lineEnd = result.waypoints[i + 1];

      expect(lineStart.actions).toHaveLength(1);
      expect(lineStart.actions[0].actionType).toBe("takePhoto");
      expect(lineStart.actionTrigger).toEqual({
        type: "multipleDistance",
        distanceM: 25,
        endIndex: i + 1, // local offset within this batch — Task 4 shifts it later
      });

      expect(lineEnd.actions).toHaveLength(0);
      expect(lineEnd.actionTrigger).toBeUndefined();
    }
  });

  it("attaches no actions or triggers when addPhotos is off, even in overlap mode", () => {
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

  it("still lays out lines using spacingM regardless of mode", () => {
    const manual = generateGrid({
      ...baseParams,
      spacingMode: "manual",
      spacingM: 50,
    });
    const overlap = generateGrid({
      ...baseParams,
      spacingMode: "overlap",
      spacingM: 50,
      photoIntervalM: 25,
    });
    expect(overlap.waypoints.length).toBe(manual.waypoints.length);
  });

  it("keeps actionTrigger.endIndex pointing forward within each pair when reverse is true", () => {
    const result = generateGrid({
      ...baseParams,
      spacingMode: "overlap",
      addPhotos: true,
      photoIntervalM: 25,
      reverse: true,
    });
    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(result.waypoints.length % 2).toBe(0);

    for (let i = 0; i < result.waypoints.length; i += 2) {
      const pairFirst = result.waypoints[i];
      const pairSecond = result.waypoints[i + 1];

      expect(pairFirst.actions).toHaveLength(1);
      expect(pairFirst.actions[0].actionType).toBe("takePhoto");
      expect(pairFirst.actionTrigger).toEqual({
        type: "multipleDistance",
        distanceM: 25,
        endIndex: i + 1, // must point at this pair's own second waypoint
      });

      expect(pairSecond.actions).toHaveLength(0);
      expect(pairSecond.actionTrigger).toBeUndefined();
    }
  });
});
