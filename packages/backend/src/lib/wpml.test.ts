import { describe, it, expect } from "vitest";
import { DEFAULT_MISSION_CONFIG, DEFAULT_WAYPOINT } from "@droneroute/shared";
import type { Mission, Waypoint } from "@droneroute/shared";
import { buildWaylinesWpml } from "./wpml.js";

function makeMission(waypoints: Waypoint[]): Mission {
  return {
    id: "m1",
    name: "Test mission",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    config: DEFAULT_MISSION_CONFIG,
    waypoints,
    pois: [],
    obstacles: [],
  };
}

describe("buildActionGroupXml via buildWaylinesWpml — reachPoint (default)", () => {
  it("emits a single-index actionGroup with reachPoint when actionTrigger is absent", () => {
    const wp: Waypoint = {
      ...DEFAULT_WAYPOINT,
      index: 0,
      name: "Waypoint 1",
      latitude: 1,
      longitude: 2,
      actions: [
        {
          actionId: 0,
          actionType: "takePhoto",
          params: { payloadPositionIndex: 0 },
        },
      ],
    };
    const xml = buildWaylinesWpml(makeMission([wp]));

    expect(xml).toContain(
      "<wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>",
    );
    expect(xml).toContain(
      "<wpml:actionGroupEndIndex>0</wpml:actionGroupEndIndex>",
    );
    expect(xml).toContain(
      "<wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>",
    );
    expect(xml).not.toContain("multipleDistance");
  });

  it("emits no actionGroup when there are no actions", () => {
    const wp: Waypoint = {
      ...DEFAULT_WAYPOINT,
      index: 0,
      name: "Waypoint 1",
      latitude: 1,
      longitude: 2,
      actions: [],
    };
    const xml = buildWaylinesWpml(makeMission([wp]));
    expect(xml).not.toContain("<wpml:actionGroup>");
  });
});

describe("buildActionGroupXml via buildWaylinesWpml — multipleDistance (grid frontlap)", () => {
  it("emits a ranged actionGroup with multipleDistance and the interval param", () => {
    const lineStart: Waypoint = {
      ...DEFAULT_WAYPOINT,
      index: 5,
      name: "Waypoint 6",
      latitude: 1,
      longitude: 2,
      actions: [
        {
          actionId: 0,
          actionType: "takePhoto",
          params: { payloadPositionIndex: 0 },
        },
      ],
      actionTrigger: { type: "multipleDistance", distanceM: 25, endIndex: 6 },
    };
    const lineEnd: Waypoint = {
      ...DEFAULT_WAYPOINT,
      index: 6,
      name: "Waypoint 7",
      latitude: 1.001,
      longitude: 2,
      actions: [],
    };
    const xml = buildWaylinesWpml(makeMission([lineStart, lineEnd]));

    expect(xml).toContain(
      "<wpml:actionGroupStartIndex>5</wpml:actionGroupStartIndex>",
    );
    expect(xml).toContain(
      "<wpml:actionGroupEndIndex>6</wpml:actionGroupEndIndex>",
    );
    expect(xml).toContain(
      "<wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType>",
    );
    expect(xml).toContain(
      "<wpml:actionTriggerParam>25</wpml:actionTriggerParam>",
    );
  });
});
