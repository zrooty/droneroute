import { describe, it, expect, beforeEach } from "vitest";
import { useMissionStore } from "./missionStore";
import { DEFAULT_WAYPOINT } from "@droneroute/shared";

describe("appendWaypoints — actionTrigger.endIndex shifting", () => {
  beforeEach(() => {
    useMissionStore.setState({ waypoints: [], pois: [] });
  });

  it("shifts a local actionTrigger.endIndex by the batch's start index", () => {
    // Pre-existing waypoint so the new batch doesn't start at 0.
    useMissionStore
      .getState()
      .appendWaypoints([
        { ...DEFAULT_WAYPOINT, latitude: 0, longitude: 0, actions: [] },
      ]);
    expect(useMissionStore.getState().waypoints).toHaveLength(1);

    useMissionStore.getState().appendWaypoints([
      {
        ...DEFAULT_WAYPOINT,
        latitude: 1,
        longitude: 1,
        actions: [],
        actionTrigger: { type: "multipleDistance", distanceM: 25, endIndex: 1 },
      },
      { ...DEFAULT_WAYPOINT, latitude: 2, longitude: 2, actions: [] },
    ]);

    const waypoints = useMissionStore.getState().waypoints;
    expect(waypoints).toHaveLength(3);
    // batch started at index 1, local endIndex 1 -> absolute 1 + 1 = 2
    expect(waypoints[1].actionTrigger).toEqual({
      type: "multipleDistance",
      distanceM: 25,
      endIndex: 2,
    });
  });

  it("leaves waypoints without actionTrigger untouched", () => {
    useMissionStore
      .getState()
      .appendWaypoints([
        { ...DEFAULT_WAYPOINT, latitude: 0, longitude: 0, actions: [] },
      ]);
    expect(
      useMissionStore.getState().waypoints[0].actionTrigger,
    ).toBeUndefined();
  });
});
