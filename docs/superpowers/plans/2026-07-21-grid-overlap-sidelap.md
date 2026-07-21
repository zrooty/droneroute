# Grid overlap/sidelap-based spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure the Grid survey template by sidelap %/frontlap % (computed from the selected drone's camera specs + altitude) instead of only a manual line-spacing number, and make the exported WPML mission actually fire photos at the computed frontlap interval along each line.

**Architecture:** A new pure-math module (`gsd.ts`) converts camera specs + altitude + overlap % into a line spacing (m) and a photo-capture interval (m). `GridParams` gains a `spacingMode` toggle; in `"overlap"` mode `generateGrid` tags the first waypoint of each line-pass with a `multipleDistance` action trigger spanning to the line's last waypoint, instead of firing `takePhoto` at both ends. The backend WPML exporter grows a branch to emit that trigger type. Camera specs live as a new optional field on `PayloadModel` in shared types, sourced from DJI's published specs.

**Tech Stack:** TypeScript, React, Zustand (frontend state), Express (backend), Vitest (testing — being added to the frontend package as part of this plan, since it doesn't have a test runner yet).

## Global Constraints

- Sentence case for all user-visible strings (labels, tooltips, dropdown options) — per `AGENTS.md`.
- No `Co-Authored-By` trailer on commits — per user's stored preference.
- `npm run build` must pass locally before pushing — per `AGENTS.md`.
- Prettier/oxlint run via lefthook pre-commit hook — run `npm run fmt` if a commit is rejected for formatting.
- A changelog entry (`changelog/*.md`) and a `specs/templates.md` update are mandatory for this PR (Task 8) — per `AGENTS.md`'s spec-sync rule.
- Camera specs (sensor width/height mm, focal length mm) are sourced from DJI's public specifications (see Task 2 for citations). They only feed line-spacing/photo-interval math, which is the flight-critical path — get these numbers right; image resolution (px) only feeds the informational GSD readout, which is lower stakes if slightly off.

---

## File structure

| File                                                           | Responsibility                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/types.ts`                                 | Modify: add optional `camera` spec to `PayloadModel`; add optional `actionTrigger` field to `Waypoint`.                                     |
| `packages/frontend/src/lib/gsd.ts`                             | Create: pure overlap-math functions (`CameraSpec`, `groundFootprint`, `spacingFromSidelap`, `intervalFromFrontlap`, `gsdCm`).               |
| `packages/frontend/src/lib/gsd.test.ts`                        | Create: unit tests for the above.                                                                                                           |
| `packages/frontend/vitest.config.ts`                           | Create: minimal Vitest config (frontend has no test runner yet).                                                                            |
| `packages/frontend/package.json`                               | Modify: add `vitest` devDependency + `test` script.                                                                                         |
| `packages/frontend/src/lib/templates.ts`                       | Modify: `GridParams` gains `spacingMode`/`sidelapPct`/`frontlapPct`/`photoIntervalM`; `generateGrid` emits `actionTrigger` in overlap mode. |
| `packages/frontend/src/lib/templates.test.ts`                  | Create: tests for the new `generateGrid` behavior.                                                                                          |
| `packages/frontend/src/store/missionStore.ts`                  | Modify: `appendWaypoints` shifts `actionTrigger.endIndex` by `startIndex`.                                                                  |
| `packages/backend/src/lib/wpml.ts`                             | Modify: `buildActionGroupXml` emits `multipleDistance` trigger when `wp.actionTrigger` is present.                                          |
| `packages/backend/src/lib/wpml.test.ts`                        | Create: tests for both the existing `reachPoint` shape and the new `multipleDistance` shape.                                                |
| `packages/frontend/src/components/map/TemplateConfigPanel.tsx` | Modify: mode toggle + sidelap%/frontlap% inputs + computed readout for the grid panel.                                                      |
| `packages/frontend/src/components/map/TemplateDrawHandler.tsx` | Modify: resolve `camera` from the mission's selected drone/payload and pass it to `TemplateConfigPanel`.                                    |
| `changelog/2026-07-21-grid-overlap-sidelap.md`                 | Create: changelog entry.                                                                                                                    |
| `specs/templates.md`                                           | Modify: document the new grid survey overlap-mode behavior.                                                                                 |

---

## Task 1: Overlap math module + frontend test runner

**Files:**

- Create: `packages/frontend/src/lib/gsd.ts`
- Create: `packages/frontend/src/lib/gsd.test.ts`
- Create: `packages/frontend/vitest.config.ts`
- Modify: `packages/frontend/package.json`

**Interfaces:**

- Produces: `CameraSpec { sensorWidthMm, sensorHeightMm, focalLengthMm, imageWidthPx, imageHeightPx }`, `groundFootprint(camera, altitudeM): { widthM, heightM }`, `spacingFromSidelap(camera, altitudeM, sidelapPct): number`, `intervalFromFrontlap(camera, altitudeM, frontlapPct): number`, `gsdCm(camera, altitudeM): number` — all consumed by Task 3 (`templates.ts`) and Task 6 (`TemplateConfigPanel.tsx`).

The frontend package currently has no test runner at all (no `vitest.config.ts`, no `test` script, no `*.test.ts` files) — the backend's Vitest setup can't be reused directly since it's scoped to `packages/backend`. This task adds a minimal one, matching the backend's Vitest version.

- [ ] **Step 1: Add Vitest to the frontend package**

Edit `packages/frontend/package.json`:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

Add to `devDependencies` (alongside the existing entries): `"vitest": "^4.1.9"` (matches `packages/backend/package.json`).

Run: `npm install` (repo root)
Expected: lockfile updates, no errors.

- [ ] **Step 2: Add the Vitest config**

Create `packages/frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

(`environment: "node"` is enough — `gsd.ts` and the `templates.ts` tests in Task 3 are pure functions with no DOM dependency.)

- [ ] **Step 3: Write the failing tests**

Create `packages/frontend/src/lib/gsd.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  groundFootprint,
  spacingFromSidelap,
  intervalFromFrontlap,
  gsdCm,
  type CameraSpec,
} from "./gsd";

// DJI Mavic 3 Enterprise (M3E) wide camera: 4/3" CMOS, 20MP, 5280x3956,
// true focal length 12.29mm. Source: enterprise.dji.com/mavic-3-enterprise/specs
const M3E: CameraSpec = {
  sensorWidthMm: 17.3,
  sensorHeightMm: 13.0,
  focalLengthMm: 12.29,
  imageWidthPx: 5280,
  imageHeightPx: 3956,
};

describe("groundFootprint", () => {
  it("computes the ground footprint width/height at a given altitude", () => {
    const { widthM, heightM } = groundFootprint(M3E, 100);
    // width = 100 * 17.3 / 12.29 ≈ 140.76
    expect(widthM).toBeCloseTo(140.76, 1);
    // height = 100 * 13.0 / 12.29 ≈ 105.78
    expect(heightM).toBeCloseTo(105.78, 1);
  });

  it("scales linearly with altitude", () => {
    const at100 = groundFootprint(M3E, 100);
    const at200 = groundFootprint(M3E, 200);
    expect(at200.widthM).toBeCloseTo(at100.widthM * 2, 5);
    expect(at200.heightM).toBeCloseTo(at100.heightM * 2, 5);
  });
});

describe("spacingFromSidelap", () => {
  it("returns the full footprint width at 0% sidelap", () => {
    const spacing = spacingFromSidelap(M3E, 100, 0);
    expect(spacing).toBeCloseTo(groundFootprint(M3E, 100).widthM, 5);
  });

  it("returns 30% of footprint width at 70% sidelap", () => {
    const spacing = spacingFromSidelap(M3E, 100, 70);
    expect(spacing).toBeCloseTo(groundFootprint(M3E, 100).widthM * 0.3, 5);
  });

  it("returns 0 at 100% sidelap", () => {
    expect(spacingFromSidelap(M3E, 100, 100)).toBeCloseTo(0, 5);
  });
});

describe("intervalFromFrontlap", () => {
  it("returns 20% of footprint height at 80% frontlap", () => {
    const interval = intervalFromFrontlap(M3E, 100, 80);
    expect(interval).toBeCloseTo(groundFootprint(M3E, 100).heightM * 0.2, 5);
  });
});

describe("gsdCm", () => {
  it("computes ground sample distance in cm/px", () => {
    // gsd = altitude * sensorWidthMm * 100 / (focalLengthMm * imageWidthPx)
    // = 100 * 17.3 * 100 / (12.29 * 5280) ≈ 2.665
    expect(gsdCm(M3E, 100)).toBeCloseTo(2.665, 2);
  });

  it("scales linearly with altitude", () => {
    expect(gsdCm(M3E, 200)).toBeCloseTo(gsdCm(M3E, 100) * 2, 5);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test -w packages/frontend`
Expected: FAIL — `Cannot find module './gsd'` (the module doesn't exist yet).

- [ ] **Step 5: Implement `gsd.ts`**

Create `packages/frontend/src/lib/gsd.ts`:

```ts
// Standard nadir-camera photogrammetry formulas. Sensor width is assumed
// across-track (drives sidelap/line spacing); sensor height is along-track
// (drives frontlap/photo interval) — the standard mount orientation for
// mapping missions.

export interface CameraSpec {
  sensorWidthMm: number;
  sensorHeightMm: number;
  focalLengthMm: number;
  imageWidthPx: number;
  imageHeightPx: number;
}

export function groundFootprint(
  camera: CameraSpec,
  altitudeM: number,
): { widthM: number; heightM: number } {
  return {
    widthM: (altitudeM * camera.sensorWidthMm) / camera.focalLengthMm,
    heightM: (altitudeM * camera.sensorHeightMm) / camera.focalLengthMm,
  };
}

export function spacingFromSidelap(
  camera: CameraSpec,
  altitudeM: number,
  sidelapPct: number,
): number {
  return groundFootprint(camera, altitudeM).widthM * (1 - sidelapPct / 100);
}

export function intervalFromFrontlap(
  camera: CameraSpec,
  altitudeM: number,
  frontlapPct: number,
): number {
  return groundFootprint(camera, altitudeM).heightM * (1 - frontlapPct / 100);
}

/** Ground sample distance in cm/px — informational readout only, not used in spacing/interval math. */
export function gsdCm(camera: CameraSpec, altitudeM: number): number {
  return (
    (altitudeM * camera.sensorWidthMm * 100) /
    (camera.focalLengthMm * camera.imageWidthPx)
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w packages/frontend`
Expected: PASS (all `gsd.test.ts` tests green).

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/package.json packages/frontend/vitest.config.ts packages/frontend/src/lib/gsd.ts packages/frontend/src/lib/gsd.test.ts package-lock.json
git commit -m "feat: add overlap/sidelap ground-footprint math"
```

---

## Task 2: Camera specs on `PayloadModel` + `actionTrigger` on `Waypoint`

**Files:**

- Modify: `packages/shared/src/types.ts:116-119` (`PayloadModel`), `:121-204` (`DRONE_MODELS`), `:227-245` (`Waypoint`)

**Interfaces:**

- Consumes: nothing new.
- Produces: `PayloadModel.camera?: { sensorWidthMm, sensorHeightMm, focalLengthMm, imageWidthPx, imageHeightPx }` — consumed by Task 6 (`TemplateConfigPanel`) and Task 7 (`TemplateDrawHandler`) via `DRONE_MODELS` lookup. `Waypoint.actionTrigger?: { type: "multipleDistance"; distanceM: number; endIndex: number }` — consumed by Task 3 (`generateGrid`), Task 4 (`missionStore.appendWaypoints`), and Task 5 (`wpml.ts`).

Camera specs, sourced from DJI's published specifications:

| Payload                                                | Sensor format | Sensor W×H (mm) | True focal length (mm) | Resolution (px) | Source                                                                                                 |
| ------------------------------------------------------ | ------------- | --------------- | ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| M3E Camera (66), M3T Camera (67), M3M Camera (68, RGB) | 4/3"          | 17.3 × 13.0     | 12.29                  | 5280 × 3956     | [DJI Mavic 3 Enterprise specs](https://enterprise.dji.com/mavic-3-enterprise/specs)                    |
| M30 Camera (52), M30T Camera (53)                      | 1/2"          | 6.4 × 4.8       | 4.5                    | 4000 × 3000     | [DJI SDK forum — M30 series camera params](https://sdk-forum.dji.net/hc/en-us/articles/12325990796697) |
| H20 (42), H20T (43)                                    | 1/2.3"        | 6.3 × 4.7       | 4.5                    | 4000 × 3000     | [DJI Zenmuse H20 series specs](https://enterprise.dji.com/zenmuse-h20-series/specs)                    |
| M3D Camera (80), M3TD Camera (81)                      | 4/3"          | 17.3 × 13.0     | 12.29                  | 5280 × 3956     | Same wide-camera module as M3E/M3T (Dock variants)                                                     |

`Mini 4 Pro Camera` (100) is intentionally **left without `camera` specs** — DJI only publishes its 24mm-equivalent focal length, not a physical mm value with matching confidence to the others in this table; deriving one via crop-factor math would be a guess on the flight-critical path. `H20N` (61), `H30` (82), `H30T` (83, thermal), and `PSDK` (65534, generic third-party) also stay without `camera` specs — no fixed optical RGB sensor. All of these simply keep the "Overlap %" toggle disabled for that payload (Task 6); they're unaffected otherwise.

- [ ] **Step 1: Add `camera` to `PayloadModel`**

In `packages/shared/src/types.ts`, replace lines 116-119:

```ts
export interface PayloadModel {
  label: string;
  payloadEnumValue: number;
}
```

with:

```ts
export interface PayloadModel {
  label: string;
  payloadEnumValue: number;
  camera?: {
    sensorWidthMm: number;
    sensorHeightMm: number;
    focalLengthMm: number;
    imageWidthPx: number;
    imageHeightPx: number;
  };
}
```

- [ ] **Step 2: Populate camera specs in `DRONE_MODELS`**

In the same file, update the payload entries (keep every other field as-is, only adding `camera`):

`DJI M300 RTK` (line ~127-128, H20/H20T):

```ts
      { label: "H20", payloadEnumValue: 42, camera: { sensorWidthMm: 6.3, sensorHeightMm: 4.7, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 } },
      { label: "H20T", payloadEnumValue: 43, camera: { sensorWidthMm: 6.3, sensorHeightMm: 4.7, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 } },
```

`DJI M30` (line ~137):

```ts
    payloads: [{ label: "M30 Camera", payloadEnumValue: 52, camera: { sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 } }],
```

`DJI M30T` (line ~143):

```ts
    payloads: [{ label: "M30T Camera", payloadEnumValue: 53, camera: { sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 } }],
```

`DJI M30 (Dock)` (line ~150-152, both payloads get the same camera specs as above):

```ts
    payloads: [
      { label: "M30 Camera", payloadEnumValue: 52, camera: { sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 } },
      { label: "M30T Camera", payloadEnumValue: 53, camera: { sensorWidthMm: 6.4, sensorHeightMm: 4.8, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 } },
    ],
```

`DJI Mavic 3E` (line ~159):

```ts
    payloads: [{ label: "M3E Camera", payloadEnumValue: 66, camera: { sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 12.29, imageWidthPx: 5280, imageHeightPx: 3956 } }],
```

`DJI Mavic 3T` (line ~165):

```ts
    payloads: [{ label: "M3T Camera", payloadEnumValue: 67, camera: { sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 12.29, imageWidthPx: 5280, imageHeightPx: 3956 } }],
```

`DJI Mavic 3M` (line ~171, RGB camera specs — M3M's 4 multispectral single-band sensors are a separate payload concept not modeled here):

```ts
    payloads: [{ label: "M3M Camera", payloadEnumValue: 68, camera: { sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 12.29, imageWidthPx: 5280, imageHeightPx: 3956 } }],
```

`DJI M350 RTK` (line ~178-179, H20/H20T — same specs as M300 RTK's; leave H30/H30T/PSDK as-is with no `camera`):

```ts
      { label: "H20", payloadEnumValue: 42, camera: { sensorWidthMm: 6.3, sensorHeightMm: 4.7, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 } },
      { label: "H20T", payloadEnumValue: 43, camera: { sensorWidthMm: 6.3, sensorHeightMm: 4.7, focalLengthMm: 4.5, imageWidthPx: 4000, imageHeightPx: 3000 } },
```

`DJI Mavic 3D` (line ~190):

```ts
    payloads: [{ label: "M3D Camera", payloadEnumValue: 80, camera: { sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 12.29, imageWidthPx: 5280, imageHeightPx: 3956 } }],
```

`DJI Mavic 3TD` (line ~196):

```ts
    payloads: [{ label: "M3TD Camera", payloadEnumValue: 81, camera: { sensorWidthMm: 17.3, sensorHeightMm: 13.0, focalLengthMm: 12.29, imageWidthPx: 5280, imageHeightPx: 3956 } }],
```

`DJI Mini 4 Pro` (line ~202) — leave unchanged, no `camera` field.

- [ ] **Step 3: Add `actionTrigger` to `Waypoint`**

In `packages/shared/src/types.ts`, replace lines 227-245:

```ts
export interface Waypoint {
  index: number;
  name: string;
  latitude: number;
  longitude: number;
  height: number;
  speed: number;
  useGlobalSpeed: boolean;
  useGlobalHeight: boolean;
  useGlobalHeadingParam: boolean;
  useGlobalTurnParam: boolean;
  headingMode?: HeadingMode;
  headingAngle?: number;
  poiId?: string; // Reference to PointOfInterest when headingMode = "towardPOI"
  turnMode?: TurnMode;
  turnDampingDist?: number;
  gimbalPitchAngle: number;
  actions: WaypointAction[];
}
```

with:

```ts
export interface Waypoint {
  index: number;
  name: string;
  latitude: number;
  longitude: number;
  height: number;
  speed: number;
  useGlobalSpeed: boolean;
  useGlobalHeight: boolean;
  useGlobalHeadingParam: boolean;
  useGlobalTurnParam: boolean;
  headingMode?: HeadingMode;
  headingAngle?: number;
  poiId?: string; // Reference to PointOfInterest when headingMode = "towardPOI"
  turnMode?: TurnMode;
  turnDampingDist?: number;
  gimbalPitchAngle: number;
  actions: WaypointAction[];
  // When present, this waypoint's action group spans to `endIndex` and fires
  // continuously every `distanceM` meters (grid survey frontlap), instead of
  // the default single-point "reachPoint" trigger.
  actionTrigger?: {
    type: "multipleDistance";
    distanceM: number;
    endIndex: number;
  };
}
```

- [ ] **Step 4: Verify the shared package still builds**

Run: `npm run build -w packages/shared`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add camera specs to PayloadModel and actionTrigger to Waypoint"
```

---

## Task 3: `GridParams` overlap mode + `generateGrid` trigger emission

**Files:**

- Modify: `packages/frontend/src/lib/templates.ts:86-94` (`GridParams`), `:137-143` (`DEFAULT_GRID_PARAMS`), `:216-338` (`generateGrid`)
- Create: `packages/frontend/src/lib/templates.test.ts`

**Interfaces:**

- Consumes: `CameraSpec`, `groundFootprint`/`spacingFromSidelap`/`intervalFromFrontlap` from `./gsd` (Task 1) — note: `generateGrid` itself doesn't call these; it only carries `spacingM`/`photoIntervalM` that the _panel_ (Task 6) already computed. `Waypoint.actionTrigger` shape (Task 2).
- Produces: `GridParams.spacingMode: "manual" | "overlap"`, `sidelapPct?: number`, `frontlapPct?: number`, `photoIntervalM?: number` — consumed by Task 6 (`TemplateConfigPanel`) and Task 7 (`TemplateDrawHandler`). `generateGrid` output waypoints carrying `actionTrigger` with a **local batch-relative** `endIndex` — consumed by Task 4 (`missionStore.appendWaypoints`), which shifts it to an absolute index.

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/src/lib/templates.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w packages/frontend`
Expected: FAIL — `GridParams` has no `spacingMode` property (type error) and/or `actionTrigger` is never set.

- [ ] **Step 3: Update `GridParams` and `DEFAULT_GRID_PARAMS`**

Replace lines 86-94:

```ts
export interface GridParams {
  corner1: [number, number]; // [lat, lng]
  corner2: [number, number]; // [lat, lng]
  altitude: number;
  spacingM: number;
  addPhotos: boolean;
  rotationDeg: number; // rotation of the grid in degrees (0-360)
  reverse: boolean; // fly the grid in reverse order
}
```

with:

```ts
export interface GridParams {
  corner1: [number, number]; // [lat, lng]
  corner2: [number, number]; // [lat, lng]
  altitude: number;
  spacingM: number;
  addPhotos: boolean;
  rotationDeg: number; // rotation of the grid in degrees (0-360)
  reverse: boolean; // fly the grid in reverse order
  spacingMode: "manual" | "overlap";
  sidelapPct?: number; // used when spacingMode === "overlap"
  frontlapPct?: number; // used when spacingMode === "overlap"
  photoIntervalM?: number; // computed by the panel from frontlapPct, used when spacingMode === "overlap"
}
```

Replace lines 137-143 (`DEFAULT_GRID_PARAMS`):

```ts
export const DEFAULT_GRID_PARAMS: Omit<GridParams, "corner1" | "corner2"> = {
  altitude: 80,
  spacingM: 30,
  addPhotos: true,
  rotationDeg: 0,
  reverse: false,
};
```

with:

```ts
export const DEFAULT_GRID_PARAMS: Omit<GridParams, "corner1" | "corner2"> = {
  altitude: 80,
  spacingM: 30,
  addPhotos: true,
  rotationDeg: 0,
  reverse: false,
  spacingMode: "manual",
  sidelapPct: 70,
  frontlapPct: 80,
};
```

- [ ] **Step 4: Update `generateGrid` to emit `actionTrigger` in overlap mode**

In `generateGrid` (starts at line 216), destructure the two new fields alongside the existing ones — replace:

```ts
const {
  corner1,
  corner2,
  altitude,
  spacingM,
  addPhotos,
  rotationDeg,
  reverse,
} = params;
```

with:

```ts
const {
  corner1,
  corner2,
  altitude,
  spacingM,
  addPhotos,
  rotationDeg,
  reverse,
  spacingMode,
  photoIntervalM,
} = params;
```

Then replace the two-waypoint push block inside the `for (let pass = 0; ...)` loop:

```ts
waypoints.push({
  ...DEFAULT_WAYPOINT,
  latitude: rLat1,
  longitude: rLng1,
  height: altitude,
  gimbalPitchAngle: -90,
  useGlobalHeadingParam: false,
  headingMode: "followWayline",
  turnMode: "toPointAndStopWithContinuityCurvature",
  useGlobalTurnParam: false,
  actions: addPhotos ? [{ ...takePhotoAction, actionId: 0 }] : [],
});
waypoints.push({
  ...DEFAULT_WAYPOINT,
  latitude: rLat2,
  longitude: rLng2,
  height: altitude,
  gimbalPitchAngle: -90,
  useGlobalHeadingParam: false,
  headingMode: "followWayline",
  turnMode: "toPointAndStopWithContinuityCurvature",
  useGlobalTurnParam: false,
  actions: addPhotos ? [{ ...takePhotoAction, actionId: 0 }] : [],
});
```

with:

```ts
const lineStartOffset = waypoints.length;
const useOverlapTrigger =
  spacingMode === "overlap" && addPhotos && photoIntervalM !== undefined;

waypoints.push({
  ...DEFAULT_WAYPOINT,
  latitude: rLat1,
  longitude: rLng1,
  height: altitude,
  gimbalPitchAngle: -90,
  useGlobalHeadingParam: false,
  headingMode: "followWayline",
  turnMode: "toPointAndStopWithContinuityCurvature",
  useGlobalTurnParam: false,
  actions: addPhotos ? [{ ...takePhotoAction, actionId: 0 }] : [],
  ...(useOverlapTrigger
    ? {
        actionTrigger: {
          type: "multipleDistance" as const,
          distanceM: photoIntervalM,
          endIndex: lineStartOffset + 1, // local offset — shifted to absolute in appendWaypoints
        },
      }
    : {}),
});
waypoints.push({
  ...DEFAULT_WAYPOINT,
  latitude: rLat2,
  longitude: rLng2,
  height: altitude,
  gimbalPitchAngle: -90,
  useGlobalHeadingParam: false,
  headingMode: "followWayline",
  turnMode: "toPointAndStopWithContinuityCurvature",
  useGlobalTurnParam: false,
  actions:
    addPhotos && !useOverlapTrigger
      ? [{ ...takePhotoAction, actionId: 0 }]
      : [],
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w packages/frontend`
Expected: PASS (all `templates.test.ts` tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/lib/templates.ts packages/frontend/src/lib/templates.test.ts
git commit -m "feat: add overlap-mode spacing fields and frontlap trigger to grid survey"
```

---

## Task 4: Shift `actionTrigger.endIndex` in `missionStore.appendWaypoints`

**Files:**

- Modify: `packages/frontend/src/store/missionStore.ts:507-544`

**Interfaces:**

- Consumes: `Waypoint.actionTrigger` (Task 2), local-offset `endIndex` from `generateGrid` (Task 3).
- Produces: waypoints appended to the mission store carry an **absolute** `actionTrigger.endIndex` — consumed by Task 5 (`wpml.ts` export).

There's no existing test file for `missionStore.ts`; this task adds targeted coverage for just the new shifting behavior rather than a full store test suite (out of scope here).

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/store/missionStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/frontend`
Expected: FAIL — `endIndex` stays `1` instead of being shifted to `2`.

- [ ] **Step 3: Implement the shift**

In `packages/frontend/src/store/missionStore.ts`, replace lines 510-514:

```ts
const fullWaypoints: Waypoint[] = newWps.map((wp, i) => ({
  ...wp,
  index: startIndex + i,
  name: `Waypoint ${startIndex + i + 1}`,
}));
```

with:

```ts
const fullWaypoints: Waypoint[] = newWps.map((wp, i) => ({
  ...wp,
  index: startIndex + i,
  name: `Waypoint ${startIndex + i + 1}`,
  actionTrigger: wp.actionTrigger
    ? { ...wp.actionTrigger, endIndex: wp.actionTrigger.endIndex + startIndex }
    : undefined,
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w packages/frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/store/missionStore.ts packages/frontend/src/store/missionStore.test.ts
git commit -m "fix: shift actionTrigger.endIndex to an absolute index in appendWaypoints"
```

---

## Task 5: Backend WPML export — `multipleDistance` action trigger

**Files:**

- Modify: `packages/backend/src/lib/wpml.ts:122-137` (`buildActionGroupXml`)
- Create: `packages/backend/src/lib/wpml.test.ts`

**Interfaces:**

- Consumes: `Waypoint.actionTrigger` (Task 2).
- Produces: no new exports — `buildActionGroupXml`'s output XML shape changes conditionally; consumed transitively by `buildTemplateKml`/`buildWaylinesWpml` (unchanged signatures).

There's no existing test file for `wpml.ts`. This task adds one from scratch, covering both the pre-existing `reachPoint` behavior (regression coverage) and the new `multipleDistance` behavior.

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/src/lib/wpml.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w packages/backend`
Expected: FAIL — `multipleDistance`/`actionTriggerParam` never appear (the function doesn't know about `actionTrigger` yet).

- [ ] **Step 3: Implement the branch in `buildActionGroupXml`**

Replace lines 122-137:

```ts
function buildActionGroupXml(wp: Waypoint, groupIdOffset: number): string {
  if (wp.actions.length === 0) return "";

  const actionsXml = wp.actions.map(buildActionXml).join("");

  return `
        <wpml:actionGroup>
          <wpml:actionGroupId>${groupIdOffset}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${wp.index}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${wp.index}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>${actionsXml}
        </wpml:actionGroup>`;
}
```

with:

```ts
function buildActionGroupXml(wp: Waypoint, groupIdOffset: number): string {
  if (wp.actions.length === 0) return "";

  const actionsXml = wp.actions.map(buildActionXml).join("");

  const triggerXml =
    wp.actionTrigger?.type === "multipleDistance"
      ? `
            <wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType>
            <wpml:actionTriggerParam>${wp.actionTrigger.distanceM}</wpml:actionTriggerParam>`
      : `
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>`;

  const endIndex = wp.actionTrigger?.endIndex ?? wp.index;

  return `
        <wpml:actionGroup>
          <wpml:actionGroupId>${groupIdOffset}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${wp.index}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${endIndex}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>${triggerXml}
          </wpml:actionTrigger>${actionsXml}
        </wpml:actionGroup>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w packages/backend`
Expected: PASS (all `wpml.test.ts` tests green, including the pre-existing `reachPoint` regression tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/lib/wpml.ts packages/backend/src/lib/wpml.test.ts
git commit -m "feat: emit multipleDistance action trigger for grid frontlap capture"
```

---

## Task 6: Grid panel UI — mode toggle, sidelap/frontlap inputs, computed readout

**Files:**

- Modify: `packages/frontend/src/components/map/TemplateConfigPanel.tsx`

**Interfaces:**

- Consumes: `CameraSpec`, `groundFootprint`/`spacingFromSidelap`/`intervalFromFrontlap`/`gsdCm` from `@/lib/gsd` (Task 1); `GridParams.spacingMode`/`sidelapPct`/`frontlapPct`/`photoIntervalM` (Task 3).
- Produces: new optional prop `camera?: CameraSpec` on `TemplateConfigPanelProps` — consumed by Task 7 (`TemplateDrawHandler`).

- [ ] **Step 1: Add the `camera` prop and imports**

In `packages/frontend/src/components/map/TemplateConfigPanel.tsx`, add to the imports (near the top, alongside the existing `@/lib/units` import):

```ts
import {
  spacingFromSidelap,
  intervalFromFrontlap,
  gsdCm,
  type CameraSpec,
} from "@/lib/gsd";
```

Add `camera?: CameraSpec;` to `TemplateConfigPanelProps` (after `pencilParams?: PencilParams | null;`):

```ts
interface TemplateConfigPanelProps {
  type: TemplateType;
  orbitParams?: OrbitParams | null;
  gridParams?: GridParams | null;
  facadeParams?: FacadeParams | null;
  pencilParams?: PencilParams | null;
  camera?: CameraSpec;
  onOrbitChange?: (params: OrbitParams) => void;
  onGridChange?: (params: GridParams) => void;
  onFacadeChange?: (params: FacadeParams) => void;
  onPencilChange?: (params: PencilParams) => void;
  onApply: () => void;
  onCancel: () => void;
  waypointCount: number;
  pois?: PointOfInterest[];
}
```

and destructure it in the component signature (after `pencilParams,`):

```ts
export function TemplateConfigPanel({
  type,
  orbitParams,
  gridParams,
  facadeParams,
  pencilParams,
  camera,
  onOrbitChange,
  onGridChange,
  onFacadeChange,
  onPencilChange,
  onApply,
  onCancel,
  waypointCount,
  pois,
}: TemplateConfigPanelProps) {
```

- [ ] **Step 2: Replace the grid params block with the mode toggle + both input sets**

Replace the entire `{/* Grid params */}` block (currently rendering altitude/line spacing/rotation/photos/reverse) with:

```tsx
{
  /* Grid params */
}
{
  type === "grid" && gridParams && onGridChange && (
    <div className="mb-3">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <Label className="text-[10px]">
            Altitude ({heightLabel(unitSystem)})
          </Label>
          <NumericInput
            value={toDisplayHeight(gridParams.altitude, unitSystem)}
            onChange={(v) => {
              const altitude = fromDisplayHeight(v, unitSystem);
              const overlapUpdates =
                gridParams.spacingMode === "overlap" && camera
                  ? {
                      spacingM: Math.max(
                        1,
                        Math.round(
                          spacingFromSidelap(
                            camera,
                            altitude,
                            gridParams.sidelapPct ?? 70,
                          ),
                        ),
                      ),
                      photoIntervalM: Math.max(
                        1,
                        Math.round(
                          intervalFromFrontlap(
                            camera,
                            altitude,
                            gridParams.frontlapPct ?? 80,
                          ),
                        ),
                      ),
                    }
                  : {};
              onGridChange({ ...gridParams, altitude, ...overlapUpdates });
            }}
            min={5}
            step={5}
            fallback={80}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">Rotation (°)</Label>
          <NumericInput
            value={gridParams.rotationDeg}
            onChange={(v) => onGridChange({ ...gridParams, rotationDeg: v })}
            min={-180}
            max={180}
            step={5}
            fallback={0}
            className="h-7 text-xs"
          />
        </div>
      </div>

      <div className="flex gap-1 mb-2">
        <Button
          type="button"
          size="sm"
          variant={gridParams.spacingMode === "manual" ? "default" : "outline"}
          className="h-6 flex-1 text-[10px]"
          onClick={() => onGridChange({ ...gridParams, spacingMode: "manual" })}
        >
          Manual
        </Button>
        <Button
          type="button"
          size="sm"
          variant={gridParams.spacingMode === "overlap" ? "default" : "outline"}
          className="h-6 flex-1 text-[10px]"
          disabled={!camera}
          title={
            camera
              ? undefined
              : "No camera specs for this payload — use manual spacing"
          }
          onClick={() =>
            onGridChange({ ...gridParams, spacingMode: "overlap" })
          }
        >
          Overlap %
        </Button>
      </div>

      {gridParams.spacingMode === "manual" && (
        <div className="mb-2">
          <Label className="text-[10px]">
            Line spacing ({distanceLabel(unitSystem)})
          </Label>
          <NumericInput
            value={toDisplayDistance(gridParams.spacingM, unitSystem)}
            onChange={(v) =>
              onGridChange({
                ...gridParams,
                spacingM: fromDisplayDistance(v, unitSystem),
              })
            }
            min={3}
            step={5}
            fallback={30}
            className="h-7 text-xs"
          />
        </div>
      )}

      {gridParams.spacingMode === "overlap" && camera && (
        <div className="mb-2">
          <div className="grid grid-cols-2 gap-2 mb-1">
            <div>
              <Label className="text-[10px]">Sidelap (%)</Label>
              <NumericInput
                value={gridParams.sidelapPct ?? 70}
                onChange={(v) => {
                  const sidelapPct = Math.min(95, Math.max(0, v));
                  onGridChange({
                    ...gridParams,
                    sidelapPct,
                    spacingM: Math.max(
                      1,
                      Math.round(
                        spacingFromSidelap(
                          camera,
                          gridParams.altitude,
                          sidelapPct,
                        ),
                      ),
                    ),
                  });
                }}
                min={0}
                max={95}
                step={5}
                fallback={70}
                integer
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">Frontlap (%)</Label>
              <NumericInput
                value={gridParams.frontlapPct ?? 80}
                onChange={(v) => {
                  const frontlapPct = Math.min(95, Math.max(0, v));
                  onGridChange({
                    ...gridParams,
                    frontlapPct,
                    photoIntervalM: Math.max(
                      1,
                      Math.round(
                        intervalFromFrontlap(
                          camera,
                          gridParams.altitude,
                          frontlapPct,
                        ),
                      ),
                    ),
                  });
                }}
                min={0}
                max={95}
                step={5}
                fallback={80}
                integer
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Spacing{" "}
            {Math.round(
              spacingFromSidelap(
                camera,
                gridParams.altitude,
                gridParams.sidelapPct ?? 70,
              ),
            )}
            m{" · "}
            Interval{" "}
            {Math.round(
              intervalFromFrontlap(
                camera,
                gridParams.altitude,
                gridParams.frontlapPct ?? 80,
              ),
            )}
            m{" · "}
            GSD {gsdCm(camera, gridParams.altitude).toFixed(1)}cm/px
          </div>
        </div>
      )}

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
  );
}
```

Note: `spacingM` and `photoIntervalM` are recomputed and written into `gridParams` directly inside the sidelap%/frontlap%/altitude `onChange` handlers (rather than only in a derived readout), so `generateGrid` (Task 3) always receives an up-to-date `spacingM`/`photoIntervalM` without needing to know about sidelap/frontlap percentages itself. Switching `spacingMode` to `"overlap"` via the toggle button does **not** immediately recompute `spacingM` — it only takes effect once the user touches a sidelap/frontlap input or the altitude changes (both already wired above).

- [ ] **Step 3: Build check**

Run: `npm run build -w packages/frontend`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/map/TemplateConfigPanel.tsx
git commit -m "feat: add overlap %/manual spacing toggle to grid survey panel"
```

---

## Task 7: Wire the selected drone's camera into `TemplateDrawHandler`

**Files:**

- Modify: `packages/frontend/src/components/map/TemplateDrawHandler.tsx`

**Interfaces:**

- Consumes: `DRONE_MODELS` (from `@droneroute/shared`), `useMissionStore((s) => s.config)` — same lookup pattern as `packages/frontend/src/components/mission/MissionConfig.tsx:34-38`. `TemplateConfigPanel`'s new `camera` prop (Task 6).

- [ ] **Step 1: Look up the selected payload's camera spec**

In `packages/frontend/src/components/map/TemplateDrawHandler.tsx`, add to the imports:

```ts
import { DRONE_MODELS } from "@droneroute/shared";
```

Inside the `TemplateDrawHandler` component body, after the existing `useMissionStore` selector calls (near the top, after `const appendWaypoints = ...`):

```ts
const missionConfig = useMissionStore((s) => s.config);
const camera = DRONE_MODELS.find(
  (d) =>
    d.droneEnumValue === missionConfig.droneEnumValue &&
    d.droneSubEnumValue === missionConfig.droneSubEnumValue,
)?.payloads.find(
  (p) => p.payloadEnumValue === missionConfig.payloadEnumValue,
)?.camera;
```

- [ ] **Step 2: Pass it to `TemplateConfigPanel`**

In the JSX at the bottom of the component, add `camera={camera}` to the `<TemplateConfigPanel>` call:

```tsx
{
  confirmed && (
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
  );
}
```

- [ ] **Step 3: Build check**

Run: `npm run build -w packages/frontend`
Expected: PASS, no type errors.

- [ ] **Step 4: Manual QA in the browser**

Per `AGENTS.md`'s UI screenshot workflow — capture before/after screenshots of the grid panel at 1280x720, map coordinates 41.25797725781744, 0.9322907667035154:

1. Start the dev server: `npm run dev`
2. Open the app, select "DJI Mavic 3E" as the drone (the default `M3E Camera` payload has specs), draw a Grid survey.
3. Confirm the config panel shows "Manual"/"Overlap %" toggle; switch to "Overlap %"; confirm sidelap%/frontlap% inputs and the computed readout (spacing/interval/GSD) appear and update as altitude/sidelap/frontlap change.
4. Switch the drone to one without camera specs (e.g. a payload with only H20N/PSDK) and confirm "Overlap %" is disabled with the tooltip.
5. Apply the grid in overlap mode and confirm waypoints appear on the map as expected (same visual line layout as manual mode).
6. Export the mission (KMZ) and unzip it; confirm `waylines.wpml` contains a `multipleDistance` action trigger on the grid lines.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/map/TemplateDrawHandler.tsx
git commit -m "feat: wire selected drone's camera specs into the grid survey panel"
```

---

## Task 8: Docs — changelog + spec sync

**Files:**

- Create: `changelog/2026-07-21-grid-overlap-sidelap.md`
- Modify: `specs/templates.md` (this repo documents the template features — Orbit/Grid/Facade/Pencil — here, not in `mission-planning.md`)

**Interfaces:**

- Consumes: nothing (docs-only).
- Produces: nothing consumed by other tasks — this is the final task.

- [ ] **Step 1: Add the changelog entry**

Create `changelog/2026-07-21-grid-overlap-sidelap.md`, matching the repo's existing `## Summary` / `## Changes` format (e.g. `changelog/2026-06-27-privacy-policy.md`):

```markdown
## Summary

Let grid survey users set sidelap %/frontlap % instead of a manual line-spacing
number, computed from the selected drone's camera specs and altitude.

## Changes

- Add a Manual/Overlap % mode toggle to the grid survey config panel. Overlap
  mode shows sidelap %/frontlap % inputs and a computed spacing/interval/GSD
  readout, using the selected drone+payload's camera specs.
- Overlap-mode grid missions now fire photos continuously along each line at
  the computed frontlap interval (a new `multipleDistance` WPML action
  trigger), instead of only at line endpoints.
- Add camera specs (sensor size, focal length, resolution) to the RGB payloads
  in the drone/payload list (M3E/M3T/M3M/M3D/M3TD, M30/M30T, H20/H20T).
```

- [ ] **Step 2: Update `specs/templates.md`**

Replace line 8:

```markdown
- **Grid survey**: fly a back-and-forth zigzag pattern over an area. Useful for mapping or photogrammetry.
```

with:

```markdown
- **Grid survey**: fly a back-and-forth zigzag pattern over an area. Useful for mapping or photogrammetry. Choose line spacing manually, or switch to overlap mode and set sidelap %/frontlap % instead — spacing and photo-capture interval are computed automatically from the selected drone's camera and altitude (requires a drone/payload with known camera specs).
```

Add a new bullet to the "Good to know" section (after line 22, `- All generated waypoints behave like normal waypoints after placement. You can move, delete, or change their settings.`):

```markdown
- In grid survey's overlap mode, photos are captured continuously along each line at the computed interval, not just at the start and end — this only works for drones/payloads with known camera specs (shown in the drone/payload selector in mission settings).
```

- [ ] **Step 3: Full build + test check**

Run: `npm run build`
Expected: PASS.

Run: `npm run test -w packages/frontend && npm run test -w packages/backend`
Expected: PASS (all tests from Tasks 1, 3, 4, 5 green).

Run: `npm run fmt:check`
Expected: PASS (run `npm run fmt` first if not).

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-07-21-grid-overlap-sidelap.md specs/templates.md
git commit -m "docs: changelog and spec update for grid overlap/sidelap spacing"
```

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/grid-overlap-sidelap
```

(Per `AGENTS.md`: wait for CI to pass, then open a PR — do not merge without the user's explicit go-ahead.)
