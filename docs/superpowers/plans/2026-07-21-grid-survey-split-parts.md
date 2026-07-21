# Grid Survey Split-Into-Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user split a Grid survey mission's waypoints into N sequential, independently-flyable KMZ files, with a live per-part distance/time estimate (and a battery-time warning) shown while configuring the split count.

**Architecture:** A new `splitParts?: number` field on the already-persisted `MissionConfig`. A pure `splitWaypointsByDistance` helper in `packages/frontend/src/lib/geo.ts` slices a waypoint array into N parts of roughly equal cumulative distance (never splitting a grid-overlap-mode `multipleDistance` action pair), each part sharing one duplicated boundary waypoint with its neighbor, matching `reference/doc (converted) 1.kmz` / `2.kmz`. The Grid survey panel exposes a stepper for the count and calls the same split function purely for the live per-part preview. The existing single-mission `/kmz/generate` endpoint is called once per part at export time — no backend changes.

**Tech Stack:** React + TypeScript (frontend), Vitest (existing test runner, `packages/frontend` → `npm run test`), Zustand (`missionStore`).

## Global Constraints

- Sentence case for all user-visible strings (labels, buttons, tooltips) — per `AGENTS.md`.
- No new backend endpoint — reuse `POST /kmz/generate` per part (already validates ≥2 waypoints and mission geometry).
- `splitParts` defaults to `undefined`/1 — existing saved missions and non-split exports must be byte-for-byte unchanged.
- Frontend package pre-commit hook runs `prettier --check` and `oxlint` on staged files — run `npm run fmt` if a commit fails on formatting.
- Spec-sync rule (`AGENTS.md`): any user-facing feature change requires a `specs/` update in the same set of commits.

---

### Task 1: Add `splitParts` to `MissionConfig`

**Files:**

- Modify: `packages/shared/src/types.ts:408-424` (the `MissionConfig` interface)

**Interfaces:**

- Produces: `MissionConfig.splitParts?: number` — consumed by Task 3 (App.tsx export) and Task 4 (panel stepper/preview).

- [ ] **Step 1: Add the field**

In `packages/shared/src/types.ts`, inside `export interface MissionConfig { ... }` (currently ending at line 424 with `gimbalPitchMode: GimbalPitchMode;`), add:

```ts
export interface MissionConfig {
  droneEnumValue: number;
  droneSubEnumValue: number;
  payloadEnumValue: number;
  flyToWaylineMode: FlyToWaylineMode;
  finishAction: FinishAction;
  exitOnRCLost: "goContinue" | "executeLostAction";
  executeRCLostAction: RCLostAction;
  takeOffSecurityHeight: number;
  globalTransitionalSpeed: number;
  autoFlightSpeed: number;
  maxBatteryMinutes: number;
  heightMode: HeightMode;
  globalHeadingMode: HeadingMode;
  globalTurnMode: TurnMode;
  gimbalPitchMode: GimbalPitchMode;
  // Number of separate KMZ files to export a Grid survey mission as.
  // undefined/1 = no split (single file, today's behavior).
  splitParts?: number;
}
```

Do **not** add it to `DEFAULT_MISSION_CONFIG` (leaving it `undefined` is the intended default — matches every other optional field in this file).

- [ ] **Step 2: Verify the shared package still builds**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add splitParts field to MissionConfig"
```

---

### Task 2: Split algorithm + consolidated flight-stats helpers in `geo.ts`

**Files:**

- Modify: `packages/frontend/src/lib/geo.ts` (add exports; keep every existing export unchanged)
- Create: `packages/frontend/src/lib/geo.test.ts`

**Interfaces:**

- Consumes: `haversineDistance(lat1, lng1, lat2, lng2): number` (already exported in this file, line 9).
- Produces:
  - `segmentDistances(waypoints: {latitude:number; longitude:number}[]): number[]`
  - `estimateFlightStats(waypoints: {latitude:number; longitude:number; speed:number; useGlobalSpeed:boolean}[], globalSpeedMs: number): {distance:number; time:number}`
  - `splitWaypointsByDistance<T extends {latitude:number; longitude:number; actionTrigger?:{endIndex:number}}>(waypoints: T[], partCount: number): T[][]`
  - `reindexFromZero(waypoints: Waypoint[]): Waypoint[]`
    These four are consumed by Task 3 (`App.tsx`) and Task 4 (`TemplateConfigPanel.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/src/lib/geo.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/frontend && npx vitest run geo.test.ts`
Expected: FAIL — `segmentDistances`, `estimateFlightStats`, `splitWaypointsByDistance`, `reindexFromZero` are not exported from `./geo`.

- [ ] **Step 3: Implement the helpers**

Add to the end of `packages/frontend/src/lib/geo.ts` (after the existing `getAirspaceWarnings`, keeping all existing code above untouched):

```ts
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
    if (waypoints[bestIdx - 1]?.actionTrigger) {
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/frontend && npx vitest run geo.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/geo.ts packages/frontend/src/lib/geo.test.ts
git commit -m "feat: add splitWaypointsByDistance and flight-stats helpers to geo.ts"
```

---

### Task 3: Consolidate flight-stats helpers into `App.tsx` and add split export

**Files:**

- Modify: `packages/frontend/src/lib/units.ts` (add `formatDuration`)
- Modify: `packages/frontend/src/App.tsx:47` (import), `:157-176` (flightStats usage — field names unchanged), `:230-256` (`handleExport`), `:734` (`formatDuration` usage — unchanged call site), `:820-874` (delete local `haversine`/`estimateFlightStats`/`formatDuration`)

**Interfaces:**

- Consumes: `estimateFlightStats`, `splitWaypointsByDistance`, `reindexFromZero` from `@/lib/geo` (Task 2).
- Produces: `formatDuration(seconds: number): string` in `@/lib/units`, consumed by Task 4's per-part list.

- [ ] **Step 1: Move `formatDuration` into `units.ts`**

Add to `packages/frontend/src/lib/units.ts`, after the existing `formatArea` function:

```ts
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m${secs > 0 ? ` ${secs}s` : ""}`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h${remainMins > 0 ? ` ${remainMins}m` : ""}`;
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: no output (success) — `formatDuration` now exists in two places (units.ts and the still-present App.tsx copy) which is fine transiently; Step 4 removes the App.tsx copy.

- [ ] **Step 3: Update `App.tsx` imports and `handleExport`**

In `packages/frontend/src/App.tsx`, change line 47 from:

```ts
import { formatDistance } from "@/lib/units";
```

to:

```ts
import { formatDistance, formatDuration } from "@/lib/units";
```

Change line 50 from:

```ts
import { getObstacleWarnings, getAirspaceWarnings } from "@/lib/geo";
```

to:

```ts
import {
  getObstacleWarnings,
  getAirspaceWarnings,
  estimateFlightStats,
  splitWaypointsByDistance,
  reindexFromZero,
} from "@/lib/geo";
```

Replace the `handleExport` function (currently lines 230-256) with:

```ts
const handleExport = async () => {
  if (waypoints.length < 2) {
    toast.warning("Need at least 2 waypoints to export");
    return;
  }

  setExporting(true);
  try {
    const parts =
      config.splitParts && config.splitParts > 1
        ? splitWaypointsByDistance(waypoints, config.splitParts).map(
            reindexFromZero,
          )
        : [waypoints];

    const filenameBase = missionName.replace(/[^a-zA-Z0-9_-]/g, "_");

    for (let i = 0; i < parts.length; i++) {
      const blob = await api.post<Blob>("/kmz/generate", {
        name: missionName,
        config,
        waypoints: parts[i],
        pois,
      });

      const filename =
        parts.length > 1
          ? `${filenameBase}_part_${i + 1}.kmz`
          : `${filenameBase}.kmz`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err: any) {
    toast.error(`Export failed: ${err.message}`);
  } finally {
    setExporting(false);
  }
};
```

- [ ] **Step 4: Delete the now-duplicated local helpers**

In `packages/frontend/src/App.tsx`, delete the local `haversine` function (around line 820, the block ending `return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }`), the local `estimateFlightStats` function (around lines 838-863), and the local `formatDuration` function (around lines 866-874) — all three now live in `@/lib/geo` and `@/lib/units` respectively. Leave the `flightStats` `useMemo` at lines 154-160 and its usages at lines 172/176/734 exactly as they are; they now resolve to the imported `estimateFlightStats`/`formatDuration` with identical field names (`.distance`/`.time`) and behavior.

- [ ] **Step 5: Run frontend tests and build**

Run: `cd packages/frontend && npm run test && npx tsc --noEmit`
Expected: all tests PASS, no type errors. (No test exercises `handleExport` directly — this is a manual QA item in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/lib/units.ts
git commit -m "refactor: consolidate flight-stats helpers into geo.ts/units.ts, add split export to App.tsx"
```

---

### Task 4: "Split into parts" stepper + per-part estimate list in the Grid survey panel

**Files:**

- Modify: `packages/frontend/src/components/map/TemplateConfigPanel.tsx`

**Interfaces:**

- Consumes: `splitWaypointsByDistance`, `estimateFlightStats` (from `@/lib/geo`, Task 2), `formatDistance`, `formatDuration` (from `@/lib/units`, Task 2/3).
- Produces: new props `splitParts?: number`, `onSplitPartsChange?: (n: number) => void`, `previewWaypoints?: {...}[]`, `autoFlightSpeed?: number`, `maxBatteryMinutes?: number` on `TemplateConfigPanelProps` — consumed by Task 5 (`TemplateDrawHandler.tsx`).

- [ ] **Step 1: Add the new props**

In `packages/frontend/src/components/map/TemplateConfigPanel.tsx`, add to the `TemplateConfigPanelProps` interface (currently lines 42-57), right after `waypointCount: number;`:

```ts
  waypointCount: number;
  previewWaypoints?: {
    latitude: number;
    longitude: number;
    speed: number;
    useGlobalSpeed: boolean;
    actionTrigger?: { endIndex: number };
  }[];
  splitParts?: number;
  onSplitPartsChange?: (n: number) => void;
  autoFlightSpeed?: number;
  maxBatteryMinutes?: number;
```

And destructure them in the function signature (currently lines 59-74), adding after `waypointCount,`:

```ts
  waypointCount,
  previewWaypoints = [],
  splitParts = 1,
  onSplitPartsChange,
  autoFlightSpeed = 7,
  maxBatteryMinutes = 25,
```

(Optional/defaulted so Orbit/Facade/Pencil callers don't need to pass them — only the grid branch renders anything with them.)

- [ ] **Step 2: Add the imports**

Change:

```ts
import {
  heightLabel,
  speedLabel,
  distanceLabel,
  toDisplayHeight,
  fromDisplayHeight,
  toDisplaySpeed,
  fromDisplaySpeed,
  toDisplayDistance,
  fromDisplayDistance,
  speedRange,
} from "@/lib/units";
```

to:

```ts
import {
  heightLabel,
  speedLabel,
  distanceLabel,
  toDisplayHeight,
  fromDisplayHeight,
  toDisplaySpeed,
  fromDisplaySpeed,
  toDisplayDistance,
  fromDisplayDistance,
  speedRange,
  formatDistance,
  formatDuration,
} from "@/lib/units";
```

and add a new import line right after it:

```ts
import { splitWaypointsByDistance, estimateFlightStats } from "@/lib/geo";
```

- [ ] **Step 3: Compute the per-part preview**

Inside the component body, after the existing `title`/`description` computation (around line 91), add:

```ts
const gridPreviewParts =
  type === "grid" && splitParts > 1 && previewWaypoints.length > 0
    ? splitWaypointsByDistance(previewWaypoints, splitParts)
    : [];
```

- [ ] **Step 4: Add the stepper + per-part list**

In the grid branch (`{type === "grid" && gridParams && onGridChange && ( ... )}`, currently lines 221-476), find the existing block:

```tsx
          <div className="flex items-end gap-2 pb-1">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={gridParams.addPhotos}
                onChange={(e) =>
                  onGridChange({ ...gridParams, addPhotos: e.target.checked })
                }
                className="rounded"
              />
              Photos
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={gridParams.reverse}
                onChange={(e) =>
                  onGridChange({ ...gridParams, reverse: e.target.checked })
                }
                className="rounded"
              />
              Reverse
            </label>
          </div>
        </div>
      )}
```

and insert a new block right after the Photos/Reverse `</div>` (still inside the grid branch's outer `<div className="mb-3">`, before its closing `</div>`):

```tsx
          <div className="flex items-end gap-2 pb-1">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={gridParams.addPhotos}
                onChange={(e) =>
                  onGridChange({ ...gridParams, addPhotos: e.target.checked })
                }
                className="rounded"
              />
              Photos
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={gridParams.reverse}
                onChange={(e) =>
                  onGridChange({ ...gridParams, reverse: e.target.checked })
                }
                className="rounded"
              />
              Reverse
            </label>
          </div>

          {onSplitPartsChange && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <Label className="text-[10px]">Split into parts</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 w-6 p-0 text-xs"
                  onClick={() =>
                    onSplitPartsChange(Math.max(1, splitParts - 1))
                  }
                >
                  −
                </Button>
                <span className="text-xs w-6 text-center">{splitParts}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 w-6 p-0 text-xs"
                  onClick={() => {
                    const maxParts = Math.max(
                      1,
                      Math.floor((waypointCount + splitParts - 1) / 2),
                    );
                    onSplitPartsChange(Math.min(maxParts, splitParts + 1));
                  }}
                >
                  +
                </Button>
              </div>
              {gridPreviewParts.length > 1 && (
                <div className="mt-1 space-y-0.5">
                  {gridPreviewParts.map((part, i) => {
                    const stats = estimateFlightStats(part, autoFlightSpeed);
                    const overBattery = stats.time > maxBatteryMinutes * 60;
                    return (
                      <div
                        key={i}
                        className={`text-[10px] ${overBattery ? "text-red-400" : "text-muted-foreground"}`}
                      >
                        Part {i + 1} {formatDistance(stats.distance, unitSystem)} ·{" "}
                        {formatDuration(stats.time)}
                        {overBattery ? " (exceeds max battery)" : ""}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
```

(Only the new `{onSplitPartsChange && ( ... )}` block and its preceding blank line are additions — the surrounding Photos/Reverse block and closing tags are shown for placement context, not duplicated in the file.)

- [ ] **Step 5: Run the build**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/map/TemplateConfigPanel.tsx
git commit -m "feat: add split-into-parts stepper and per-part estimate to Grid survey panel"
```

---

### Task 5: Wire `splitParts` from `missionStore` through `TemplateDrawHandler`

**Files:**

- Modify: `packages/frontend/src/components/map/TemplateDrawHandler.tsx:64-434`

**Interfaces:**

- Consumes: `TemplateConfigPanelProps.splitParts`, `.onSplitPartsChange`, `.previewWaypoints`, `.autoFlightSpeed`, `.maxBatteryMinutes` (Task 4). `useMissionStore().config.splitParts`, `useMissionStore().setConfig` (existing store action, signature `(updates: Partial<MissionConfig>) => void`).

- [ ] **Step 1: Read `setConfig` from the store**

In `packages/frontend/src/components/map/TemplateDrawHandler.tsx`, change line 68 from:

```ts
const missionConfig = useMissionStore((s) => s.config);
```

to:

```ts
const missionConfig = useMissionStore((s) => s.config);
const setMissionConfig = useMissionStore((s) => s.setConfig);
```

- [ ] **Step 2: Pass the new props to `TemplateConfigPanel`**

Change the `<TemplateConfigPanel ... />` call (currently lines 418-431) from:

```tsx
<TemplateConfigPanel
  type={templateMode}
  orbitParams={orbitParams}
  gridParams={gridParams}
  facadeParams={facadeParams}
  camera={camera}
  onOrbitChange={setOrbitParams}
  onGridChange={setGridParams}
  onFacadeChange={setFacadeParams}
  onApply={handleApply}
  onCancel={handleCancel}
  waypointCount={activePreview?.waypoints.length ?? 0}
/>
```

to:

```tsx
<TemplateConfigPanel
  type={templateMode}
  orbitParams={orbitParams}
  gridParams={gridParams}
  facadeParams={facadeParams}
  camera={camera}
  onOrbitChange={setOrbitParams}
  onGridChange={setGridParams}
  onFacadeChange={setFacadeParams}
  onApply={handleApply}
  onCancel={handleCancel}
  waypointCount={activePreview?.waypoints.length ?? 0}
  previewWaypoints={templateMode === "grid" ? preview?.waypoints : undefined}
  splitParts={missionConfig.splitParts}
  onSplitPartsChange={(n) => setMissionConfig({ splitParts: n })}
  autoFlightSpeed={missionConfig.autoFlightSpeed}
  maxBatteryMinutes={missionConfig.maxBatteryMinutes}
/>
```

- [ ] **Step 3: Run the build**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 4: Manual QA in browser**

Run: `npm run dev` (from the repo root — this runs `concurrently` over both `packages/backend` and `packages/frontend` dev servers, per the root `package.json`).

1. Import `reference/doc.kml` as a Grid survey area (or draw any rectangle) and apply default Grid survey settings so `waypointCount` is large (50+).
2. Set "Split into parts" to 2 — confirm a two-line "Part 1 / Part 2" distance+time readout appears below the stepper, roughly half the total distance each.
3. Click Apply — confirm the full combined waypoint path loads into the sidebar/map exactly as before (no change to editing behavior).
4. Click the main export/download button — confirm **two** `.kmz` files download (`<mission name>_part_1.kmz`, `<mission name>_part_2.kmz`).
5. Unzip both and confirm each `wpmz/waylines.wpml` has `<wpml:index>` starting at 0, and the last waypoint of part 1 has the same coordinates as the first waypoint of part 2 (matching `reference/doc (converted) 1.kmz` / `2.kmz`).
6. Set "Split into parts" back to 1 and export — confirm exactly one file downloads, named `<mission name>.kmz` (unchanged from today).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/map/TemplateDrawHandler.tsx
git commit -m "feat: wire splitParts from missionStore into the Grid survey panel"
```

---

### Task 6: Spec and changelog sync

**Files:**

- Modify: `specs/templates.md`
- Create: `changelog/2026-07-21-grid-survey-split-parts.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update `specs/templates.md`**

In the `## Good to know` section (currently lines 19-25), add a new bullet after the existing Grid survey overlap-mode bullet (line 23):

```markdown
- Grid survey can split its waypoints into multiple separate KMZ files (set "Split into parts" in the Grid survey panel) — useful when a survey area generates more waypoints than one battery can fly. Each part is a complete, independently-flyable mission; consecutive parts share one waypoint where they connect. A live distance/time estimate per part is shown while choosing the split count, with a warning if a part would exceed the mission's max battery time.
```

- [ ] **Step 2: Add the changelog entry**

Create `changelog/2026-07-21-grid-survey-split-parts.md`:

```markdown
## Summary

Let Grid survey missions be exported as multiple sequential KMZ files instead
of one, for surveys with more waypoints than a single battery can fly.

## Changes

- Add a "Split into parts" stepper to the Grid survey config panel, with a
  live per-part distance/flight-time estimate (warns if a part would exceed
  the mission's max battery time).
- Exporting a mission with `splitParts > 1` now downloads that many separate
  `.kmz` files, each a complete standalone mission (own waypoint indexing),
  with consecutive parts sharing one connecting waypoint.
```

- [ ] **Step 3: Format check**

Run: `npm run fmt`
Expected: no changes needed, or auto-fixes applied cleanly.

- [ ] **Step 4: Commit**

```bash
git add specs/templates.md changelog/2026-07-21-grid-survey-split-parts.md
git commit -m "docs: document grid survey split-into-parts feature"
```

---

### Task 7: Full build and final verification

**Files:** None (verification only).

- [ ] **Step 1: Run the full test suite**

There is no root-level `test` script (only `packages/frontend` has one; the change in this plan doesn't touch `packages/backend`). Run:

`cd packages/frontend && npm run test`
Expected: all tests PASS, including the new `geo.test.ts` cases.

- [ ] **Step 2: Run the full build**

Run: `npm run build` (from the repo root — builds `packages/shared` → `packages/backend` → `packages/frontend` → `packages/cli` in order, per the root `package.json`).
Expected: builds successfully with no type errors, per `AGENTS.md`'s "run `npm run build` locally before pushing" rule.

- [ ] **Step 3: Push**

```bash
git push
```
