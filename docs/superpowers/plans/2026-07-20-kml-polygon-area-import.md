# KML Polygon Area Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import a `.kml` file containing an ArcGIS-style polygon and have the app auto-generate a grid survey (lawn-mower waypoints) clipped to that polygon's shape, reusing the existing Grid template's config panel.

**Architecture:** Client-side only (no backend changes). A new pure parser (`kmlImport.ts`) turns KML text into a `[lat, lng][]` ring using the browser's native `DOMParser`. `generateGrid` in `templates.ts` gains an optional `polygon` field that clips each scan-line pass to the polygon's outermost boundary crossings. A new toolbar entry seeds the existing "grid" template mode with the parsed polygon via a small transient store field, skipping the manual drag-to-draw step.

**Tech Stack:** React 19, TypeScript, Zustand, react-map-gl/Mapbox, Vitest (new to `packages/frontend`), native browser `DOMParser`.

## Global Constraints

- Never commit or push to `main` — this work happens on the `feat/kml-polygon-area-import` branch (already checked out).
- Use sentence case for all user-visible strings (only first word + proper nouns/acronyms capitalized; `KML` stays uppercase).
- Run `npm run build` locally before pushing.
- `prettier --check` and `oxlint` run automatically on commit via lefthook — run `npm run fmt` if a commit is rejected for formatting.
- Every PR needs a changelog entry (`changelog/*.md`) — this feature is user-facing, not infra-only.
- If a PR changes user-facing behavior, the matching file in `specs/` must be updated in the same PR.
- UI-touching PRs require before/after screenshots at 1280x720, map centered on `41.25797725781744, 0.9322907667035154`, stored in `docs/screenshots/`.
- Never merge a PR without the user's explicit "merge it" instruction.
- No new backend endpoint, no file upload, no DB changes — this entire feature is client-side per the approved design (`docs/superpowers/specs/2026-07-20-kml-polygon-area-import-design.md`).

---

### Task 1: Frontend test harness + KML polygon parser

**Files:**

- Create: `packages/frontend/vitest.config.ts`
- Modify: `packages/frontend/package.json` (add `vitest`, `happy-dom` devDependencies + `test` script)
- Create: `packages/frontend/src/lib/kmlImport.ts`
- Test: `packages/frontend/src/lib/kmlImport.test.ts`

**Interfaces:**

- Produces: `parseKmlPolygon(kmlText: string): [number, number][] | null` — exported from `packages/frontend/src/lib/kmlImport.ts`. Later tasks (MapToolbar) import this.

- [ ] **Step 1: Add `vitest` and `happy-dom` as frontend dev dependencies**

Edit `packages/frontend/package.json`:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

```json
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.0",
    "@types/react": "^19.2.16",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.0.2",
    "happy-dom": "^15.11.0",
    "tailwindcss": "^4.2.4",
    "typescript": "^6.0.3",
    "vite": "^8.0.9",
    "vitest": "^4.1.9"
  }
```

(Keep the existing `vitest` version already pinned in `packages/backend/package.json` — `^4.1.9` — so both packages use the same major version.)

Run: `npm install`
Expected: lockfile updates, no errors. `node_modules/vitest` and `node_modules/happy-dom` exist.

- [ ] **Step 2: Add the Vitest config**

Create `packages/frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Write the failing tests for `parseKmlPolygon`**

Create `packages/frontend/src/lib/kmlImport.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test -w packages/frontend`
Expected: FAIL — `Cannot find module './kmlImport'` (the file doesn't exist yet).

- [ ] **Step 5: Implement `parseKmlPolygon`**

Create `packages/frontend/src/lib/kmlImport.ts`:

```ts
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w packages/frontend`
Expected: PASS — all 4 tests in `kmlImport.test.ts` green.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/package.json packages/frontend/package-lock.json packages/frontend/vitest.config.ts packages/frontend/src/lib/kmlImport.ts packages/frontend/src/lib/kmlImport.test.ts
git commit -m "feat: add KML polygon parser and frontend test harness"
```

---

### Task 2: Polygon-clipped grid generation

**Files:**

- Modify: `packages/frontend/src/lib/templates.ts`
- Test: `packages/frontend/src/lib/templates.test.ts` (new)

**Interfaces:**

- Consumes: nothing new from other tasks.
- Produces: `GridParams.polygon?: [number, number][]` and `clipSegmentToPolygon(p1: [number, number], p2: [number, number], polygon: [number, number][]): [[number, number], [number, number]] | null`, both exported from `templates.ts`. Task 5 (TemplateDrawHandler) relies on `GridParams.polygon` existing on the type; nothing outside this file calls `clipSegmentToPolygon` directly, but it stays exported for testability, matching how `pointInPolygon` is exported from `geo.ts` for the same reason.

- [ ] **Step 1: Write the failing tests for `clipSegmentToPolygon`**

Create `packages/frontend/src/lib/templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clipSegmentToPolygon, generateGrid } from "./templates";

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
  const baseParams = {
    corner1: [41.25, 0.92] as [number, number],
    corner2: [41.252, 0.924] as [number, number],
    altitude: 50,
    spacingM: 60,
    addPhotos: false,
    rotationDeg: 0,
    reverse: false,
  };

  it("produces identical waypoints to the unclipped rectangle when the polygon fully encloses the bounding box", () => {
    const enclosingPolygon: [number, number][] = [
      [41.24, 0.91],
      [41.24, 0.936],
      [41.264, 0.936],
      [41.264, 0.91],
    ];

    const unclipped = generateGrid(baseParams);
    const clipped = generateGrid({ ...baseParams, polygon: enclosingPolygon });

    expect(clipped.waypoints).toEqual(unclipped.waypoints);
  });

  it("produces fewer waypoints than the unclipped rectangle for a sub-area triangle", () => {
    const triangle: [number, number][] = [
      [41.25, 0.92],
      [41.25, 0.924],
      [41.2508, 0.92],
    ];

    const unclipped = generateGrid(baseParams);
    const clipped = generateGrid({ ...baseParams, polygon: triangle });

    expect(clipped.waypoints.length).toBeGreaterThan(0);
    expect(clipped.waypoints.length).toBeLessThan(unclipped.waypoints.length);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w packages/frontend`
Expected: FAIL — `clipSegmentToPolygon is not a function` (not exported yet), and the `polygon` field doesn't exist on `GridParams`.

- [ ] **Step 3: Add `polygon` to `GridParams` and implement the clipping helpers**

In `packages/frontend/src/lib/templates.ts`, add the import at the top:

```ts
import { pointInPolygon } from "@/lib/geo";
```

Modify the `GridParams` interface:

```ts
export interface GridParams {
  corner1: [number, number]; // [lat, lng]
  corner2: [number, number]; // [lat, lng]
  altitude: number;
  spacingM: number;
  addPhotos: boolean;
  rotationDeg: number; // rotation of the grid in degrees (0-360)
  reverse: boolean; // fly the grid in reverse order
  polygon?: [number, number][]; // clip grid lines to this ring (KML import)
}
```

Add these functions right after `haversine` (before the "Template Types" section):

```ts
/**
 * Parametric intersection of segment (p1->p2) with segment (p3->p4).
 * Returns the t value along p1->p2 (0..1) if they cross, else null.
 */
function segmentIntersectionT(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): number | null {
  const [y1, x1] = p1;
  const [y2, x2] = p2;
  const [y3, x3] = p3;
  const [y4, x4] = p4;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return null; // parallel

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** All parametric `t` values (0..1) where segment p1->p2 crosses a polygon edge. */
function lineSegmentPolygonIntersections(
  p1: [number, number],
  p2: [number, number],
  polygon: [number, number][],
): number[] {
  const ts: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const t = segmentIntersectionT(p1, p2, polygon[j], polygon[i]);
    if (t !== null) ts.push(t);
  }
  return ts;
}

/**
 * Clip a grid pass segment (p1->p2) to the outermost points where it
 * crosses the polygon boundary. Returns null if the segment never touches
 * the polygon at all (that pass is skipped). Concave polygons that are
 * crossed more than twice on the same row are NOT split into multiple
 * segments — the drone flies a straight line across any interior gap,
 * bounded by the two most extreme crossing points.
 */
export function clipSegmentToPolygon(
  p1: [number, number],
  p2: [number, number],
  polygon: [number, number][],
): [[number, number], [number, number]] | null {
  const ts = lineSegmentPolygonIntersections(p1, p2, polygon);
  if (pointInPolygon(p1, polygon)) ts.push(0);
  if (pointInPolygon(p2, polygon)) ts.push(1);

  if (ts.length < 2) return null;

  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const lerp = (t: number): [number, number] => [
    p1[0] + t * (p2[0] - p1[0]),
    p1[1] + t * (p2[1] - p1[1]),
  ];

  return [lerp(tMin), lerp(tMax)];
}
```

- [ ] **Step 4: Wire the clip into `generateGrid`**

In `generateGrid`, update the destructuring. Change:

```ts
export function generateGrid(params: GridParams): TemplateResult {
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

to:

```ts
export function generateGrid(params: GridParams): TemplateResult {
  const {
    corner1,
    corner2,
    altitude,
    spacingM,
    addPhotos,
    rotationDeg,
    reverse,
    polygon,
  } = params;
```

Then change this block (currently):

```ts
    // Apply rotation
    const [rLat1, rLng1] = rotatePoint(wpLat1, wpLng1);
    const [rLat2, rLng2] = rotatePoint(wpLat2, wpLng2);

    waypoints.push({
```

to:

```ts
    // Apply rotation
    let [rLat1, rLng1] = rotatePoint(wpLat1, wpLng1);
    let [rLat2, rLng2] = rotatePoint(wpLat2, wpLng2);

    if (polygon) {
      const clipped = clipSegmentToPolygon(
        [rLat1, rLng1],
        [rLat2, rLng2],
        polygon,
      );
      if (!clipped) continue; // this row never touches the polygon
      [[rLat1, rLng1], [rLat2, rLng2]] = clipped;
    }

    waypoints.push({
```

(`continue` skips straight to the next `pass` iteration of the enclosing `for` loop, so no waypoints are emitted for a row the polygon doesn't touch.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w packages/frontend`
Expected: PASS — all tests in `templates.test.ts` (and `kmlImport.test.ts` from Task 1) green.

- [ ] **Step 6: Run the type check**

Run: `npm run build -w packages/frontend`
Expected: builds cleanly, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/lib/templates.ts packages/frontend/src/lib/templates.test.ts
git commit -m "feat: clip grid survey passes to an imported polygon"
```

---

### Task 3: Mission store wiring

**Files:**

- Modify: `packages/frontend/src/store/missionStore.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `pendingImportPolygon: [number, number][] | null` state field and `setPendingImportPolygon: (polygon: [number, number][] | null) => void` action on `useMissionStore`. Task 4 (MapToolbar) calls `setPendingImportPolygon`; Task 5 (TemplateDrawHandler) reads `pendingImportPolygon` and calls `setPendingImportPolygon(null)` to clear it.

No test file for this task — it's a mechanical addition to an existing Zustand store, following the exact pattern already used for every other field in the file (e.g. `shareToken` / `setShareToken`). Verified end-to-end in Task 6's manual QA pass.

- [ ] **Step 1: Add the field and setter to the `MissionState` interface**

In `packages/frontend/src/store/missionStore.ts`, add to the interface right after `templateMode: TemplateType | null;`:

```ts
  templateMode: TemplateType | null;
  pendingImportPolygon: [number, number][] | null;
```

And add the setter signature right after `setTemplateMode: (mode: TemplateType | null) => void;`:

```ts
  setTemplateMode: (mode: TemplateType | null) => void;
  setPendingImportPolygon: (polygon: [number, number][] | null) => void;
```

- [ ] **Step 2: Add the initial value and setter implementation**

Add the initial value right after `templateMode: null,`:

```ts
  templateMode: null,
  pendingImportPolygon: null,
```

Add the setter implementation right after the existing `setTemplateMode` action:

```ts
  setTemplateMode: (mode) =>
    set({
      templateMode: mode,
      isAddingWaypoint: false,
      isAddingPoi: false,
      isDrawingObstacle: false,
      selectedWaypointIndices: new Set(),
      selectedPoiId: null,
    }),

  setPendingImportPolygon: (polygon) => set({ pendingImportPolygon: polygon }),
```

- [ ] **Step 3: Type-check**

Run: `npm run build -w packages/frontend`
Expected: builds cleanly (this task only adds new fields; nothing consumes them yet, so there's nothing to break).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/store/missionStore.ts
git commit -m "feat: add pendingImportPolygon to mission store"
```

---

### Task 4: Toolbar import entry point

**Files:**

- Modify: `packages/frontend/src/components/map/MapToolbar.tsx`

**Interfaces:**

- Consumes: `parseKmlPolygon` from `packages/frontend/src/lib/kmlImport.ts` (Task 1); `setPendingImportPolygon` and `setTemplateMode` from `useMissionStore` (Task 3, and pre-existing).
- Produces: nothing new for later tasks — this is a leaf UI change.

- [ ] **Step 1: Add the new imports**

In `packages/frontend/src/components/map/MapToolbar.tsx`, change:

```tsx
import {
  MousePointerClick,
  Hand,
  Trash2,
  Crosshair,
  Orbit,
  Grid3X3,
  Building2,
  PenLine,
  ChevronDown,
  Triangle,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useMissionStore } from "@/store/missionStore";
import type { TemplateType } from "@/lib/templates";
```

to:

```tsx
import {
  MousePointerClick,
  Hand,
  Trash2,
  Crosshair,
  Orbit,
  Grid3X3,
  Building2,
  PenLine,
  ChevronDown,
  Triangle,
  FileUp,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMissionStore } from "@/store/missionStore";
import type { TemplateType } from "@/lib/templates";
import { parseKmlPolygon } from "@/lib/kmlImport";
```

- [ ] **Step 2: Destructure the new store action and add a file input ref**

Change:

```tsx
const {
  isAddingWaypoint,
  isAddingPoi,
  isDrawingObstacle,
  templateMode,
  setIsAddingWaypoint,
  setIsAddingPoi,
  setIsDrawingObstacle,
  setTemplateMode,
  waypoints,
  pois,
  obstacles,
  clearMission,
} = useMissionStore();

const [showTemplateMenu, setShowTemplateMenu] = useState(false);
const menuRef = useRef<HTMLDivElement>(null);
```

to:

```tsx
const {
  isAddingWaypoint,
  isAddingPoi,
  isDrawingObstacle,
  templateMode,
  setIsAddingWaypoint,
  setIsAddingPoi,
  setIsDrawingObstacle,
  setTemplateMode,
  setPendingImportPolygon,
  waypoints,
  pois,
  obstacles,
  clearMission,
} = useMissionStore();

const [showTemplateMenu, setShowTemplateMenu] = useState(false);
const menuRef = useRef<HTMLDivElement>(null);
const kmlInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: Add the file-select handler**

Add this function inside the `MapToolbar` component, after the outside-click-close `useEffect` block (right before `const isPanning = ...`):

```tsx
const handleImportKmlChange = async (
  e: React.ChangeEvent<HTMLInputElement>,
) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  const polygon = parseKmlPolygon(text);

  if (!polygon) {
    toast.error("Could not find a polygon in that KML file");
  } else {
    setTemplateMode("grid");
    setPendingImportPolygon(polygon);
  }

  e.target.value = "";
};
```

- [ ] **Step 4: Add the dropdown item and hidden file input**

Inside the template dropdown menu block, change:

```tsx
        {showTemplateMenu && (
          <div className="absolute top-full right-0 mt-1 w-48 bg-card/95 backdrop-blur-sm border border-border rounded-md shadow-lg overflow-hidden z-50">
            {TEMPLATE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = templateMode === opt.type;
              return (
                <button
                  key={opt.type}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors ${isActive ? "bg-accent text-accent-foreground" : ""}`}
                  onClick={() => {
                    setTemplateMode(opt.type);
                    setShowTemplateMenu(false);
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <div className="text-left flex-1">
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {opt.description}
                    </div>
                  </div>
                  <kbd className="text-[10px] font-mono font-bold border border-white/20 bg-white/10 px-1.5 py-0.5 rounded text-foreground/80 shrink-0">
                    {opt.key}
                  </kbd>
                </button>
              );
            })}
          </div>
        )}
      </div>
```

to:

```tsx
        {showTemplateMenu && (
          <div className="absolute top-full right-0 mt-1 w-48 bg-card/95 backdrop-blur-sm border border-border rounded-md shadow-lg overflow-hidden z-50">
            {TEMPLATE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = templateMode === opt.type;
              return (
                <button
                  key={opt.type}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors ${isActive ? "bg-accent text-accent-foreground" : ""}`}
                  onClick={() => {
                    setTemplateMode(opt.type);
                    setShowTemplateMenu(false);
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <div className="text-left flex-1">
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {opt.description}
                    </div>
                  </div>
                  <kbd className="text-[10px] font-mono font-bold border border-white/20 bg-white/10 px-1.5 py-0.5 rounded text-foreground/80 shrink-0">
                    {opt.key}
                  </kbd>
                </button>
              );
            })}
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors border-t border-border"
              onClick={() => {
                kmlInputRef.current?.click();
                setShowTemplateMenu(false);
              }}
            >
              <FileUp className="h-4 w-4 shrink-0" />
              <div className="text-left flex-1">
                <div className="font-medium">Import area (KML)</div>
                <div className="text-[10px] text-muted-foreground">
                  Generate a grid survey from a KML polygon
                </div>
              </div>
            </button>
          </div>
        )}
        <input
          ref={kmlInputRef}
          type="file"
          accept=".kml"
          onChange={handleImportKmlChange}
          className="hidden"
        />
      </div>
```

- [ ] **Step 5: Type-check**

Run: `npm run build -w packages/frontend`
Expected: builds cleanly.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/map/MapToolbar.tsx
git commit -m "feat: add Import area (KML) entry to the template dropdown"
```

---

### Task 5: Draw handler wiring + polygon preview guide

**Files:**

- Modify: `packages/frontend/src/components/map/TemplateDrawHandler.tsx`

**Interfaces:**

- Consumes: `pendingImportPolygon` / `setPendingImportPolygon` from `useMissionStore` (Task 3); `GridParams.polygon` field and `DEFAULT_GRID_PARAMS` from `templates.ts` (Task 2, `DEFAULT_GRID_PARAMS` already imported in this file).
- Produces: nothing new for later tasks — this is the final wiring point. `generateGrid(gridParams)` (already called in this file's existing `preview` memo) automatically picks up clipping once `gridParams.polygon` is set, with no further changes needed there.

- [ ] **Step 1: Subscribe to `pendingImportPolygon`**

In `packages/frontend/src/components/map/TemplateDrawHandler.tsx`, change:

```tsx
export function TemplateDrawHandler() {
  const templateMode = useMissionStore((s) => s.templateMode);
  const setTemplateMode = useMissionStore((s) => s.setTemplateMode);
  const appendWaypoints = useMissionStore((s) => s.appendWaypoints);
  const { current: map } = useMap();
```

to:

```tsx
export function TemplateDrawHandler() {
  const templateMode = useMissionStore((s) => s.templateMode);
  const setTemplateMode = useMissionStore((s) => s.setTemplateMode);
  const appendWaypoints = useMissionStore((s) => s.appendWaypoints);
  const pendingImportPolygon = useMissionStore((s) => s.pendingImportPolygon);
  const { current: map } = useMap();
```

- [ ] **Step 2: Add the seeding effect**

Add this new `useEffect` right after the existing reset effect:

```tsx
useEffect(() => {
  resetState();
}, [templateMode, resetState]);

// Seed the grid config panel from an imported KML polygon, skipping the
// manual drag-to-draw step. Keyed on pendingImportPolygon (not
// templateMode) so it fires even if the user was already in "grid" mode
// when they imported.
useEffect(() => {
  if (!pendingImportPolygon) return;

  const lats = pendingImportPolygon.map(([lat]) => lat);
  const lngs = pendingImportPolygon.map(([, lng]) => lng);

  setGridParams({
    ...DEFAULT_GRID_PARAMS,
    corner1: [Math.min(...lats), Math.min(...lngs)],
    corner2: [Math.max(...lats), Math.max(...lngs)],
    polygon: pendingImportPolygon,
  });
  setConfirmed(true);
  useMissionStore.getState().setPendingImportPolygon(null);
}, [pendingImportPolygon]);
```

(This effect intentionally runs after the existing reset effect in source order — React fires a component's effects in declaration order, so if both `templateMode` and `pendingImportPolygon` change in the same update, the reset always happens before this seeds the params, never after.)

- [ ] **Step 3: Render the imported polygon as a preview guide**

Add this `useMemo` after the existing `dragGuideGeojson` memo:

```tsx
const importedPolygonGeojson = useMemo(() => {
  if (!gridParams?.polygon) return null;
  const ring = gridParams.polygon;
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: [
        ...ring.map(([lat, lng]) => [lng, lat]),
        [ring[0][1], ring[0][0]],
      ],
    },
  };
}, [gridParams]);
```

Then render it right after the existing drag-guide `<Source>` block:

```tsx
{
  /* Draw guide during drag */
}
{
  dragGuideGeojson && (
    <Source id="template-drag-guide" type="geojson" data={dragGuideGeojson}>
      <Layer
        id="template-drag-guide-layer"
        type="line"
        paint={{
          "line-color": "#a78bfa",
          "line-width": 2,
          "line-opacity": 0.5,
          "line-dasharray": [3, 2],
        }}
      />
    </Source>
  );
}

{
  /* Imported KML polygon boundary, shown alongside the generated grid */
}
{
  importedPolygonGeojson && (
    <Source
      id="imported-polygon-guide"
      type="geojson"
      data={importedPolygonGeojson}
    >
      <Layer
        id="imported-polygon-guide-layer"
        type="line"
        paint={{
          "line-color": "#34d399",
          "line-width": 2,
          "line-opacity": 0.8,
          "line-dasharray": [2, 2],
        }}
      />
    </Source>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npm run build -w packages/frontend`
Expected: builds cleanly.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/map/TemplateDrawHandler.tsx
git commit -m "feat: seed grid template from imported KML polygon"
```

---

### Task 6: Manual QA, docs, and final polish

**Files:**

- Create: `docs/screenshots/kml-import-before.png`, `docs/screenshots/kml-import-after.png`
- Create: `changelog/2026-07-20-kml-polygon-area-import.md`
- Modify: `specs/templates.md`

**Interfaces:** none — this task only touches documentation/screenshots and does a full manual run-through; no code interfaces are produced or consumed.

- [ ] **Step 1: Capture a "before" screenshot**

Run: `npm run dev` (from repo root)
Open `http://localhost:5173`, pan/zoom the map to `41.25797725781744, 0.9322907667035154`, open the Template dropdown (don't click anything in it yet) so the new "Import area (KML)" item is visible for later comparison, and save a 1280x720 screenshot to `docs/screenshots/kml-import-before.png`.

- [ ] **Step 2: Manually verify the end-to-end import flow**

With the dev server still running:

1. Click the Template dropdown, click "Import area (KML)".
2. In the file picker, select `ref/1/doc.kml` (the ArcGIS export already in this repo).
3. Verify: the polygon's boundary appears on the map as a dashed green line, and the grid config panel opens (same layout as the manual Grid template) showing a non-zero waypoint count.
4. Adjust "Line spacing" in the panel and confirm the waypoint count and preview lines update live.
5. Click Apply. Verify: waypoints appear in the sidebar list, the dashed green polygon guide disappears, and the mission's dirty flag is set (save button becomes active).
6. Repeat steps 1-2, but this time click Cancel instead of Apply. Verify: no waypoints are added and the polygon guide disappears.
7. Repeat steps 1-2 with a non-KML file (e.g. rename any `.txt` file to `.kml` temporarily, or pick a KML with no `<Polygon>`) and verify a toast error appears and no config panel opens.

If any of these fail, fix the underlying code in the relevant task above before proceeding — do not weaken this checklist.

- [ ] **Step 3: Capture an "after" screenshot**

With a KML successfully imported and its waypoints visible on the map (step 2.5 above, before clicking Apply — i.e. with the grid preview and polygon guide both visible), save a 1280x720 screenshot to `docs/screenshots/kml-import-after.png`. Annotate it (e.g. a red arrow/label pointing at the new "Import area (KML)" menu item and the polygon guide line) per the project's UI screenshot convention.

- [ ] **Step 4: Run the full test and build suite**

Run: `npm run test -w packages/frontend`
Expected: PASS (all tests from Tasks 1 and 2).

Run: `npm run build`
Expected: builds cleanly across all workspaces.

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 5: Add the changelog entry**

Create `changelog/2026-07-20-kml-polygon-area-import.md`:

```markdown
## Summary

Add the ability to import a KML polygon (e.g. exported from ArcGIS) and automatically generate a grid survey clipped to its shape, instead of only being able to drag a rectangle by hand.

## Changes

- Add "Import area (KML)" to the Template dropdown, which opens a file picker for a `.kml` file
- Parse the first polygon found in the KML file entirely client-side (no upload to the server)
- Extend the Grid survey generator to clip each scan line to the polygon's actual boundary, skipping rows that fall entirely outside it and flying straight across any interior gaps for concave shapes
- Show the imported polygon's boundary on the map alongside the generated grid preview while configuring it
```

- [ ] **Step 6: Update the templates spec**

In `specs/templates.md`, change:

```markdown
- **Grid survey**: fly a back-and-forth zigzag pattern over an area. Useful for mapping or photogrammetry.
```

to:

```markdown
- **Grid survey**: fly a back-and-forth zigzag pattern over an area. Useful for mapping or photogrammetry. You can draw the area by hand, or import a KML polygon (e.g. from ArcGIS) and the grid will automatically follow its shape.
```

And change:

```markdown
## Good to know

- You can combine templates — for example, use a grid survey and then add an orbit around a specific structure.
- All generated waypoints behave like normal waypoints after placement. You can move, delete, or change their settings.
```

to:

```markdown
## Good to know

- You can combine templates — for example, use a grid survey and then add an orbit around a specific structure.
- All generated waypoints behave like normal waypoints after placement. You can move, delete, or change their settings.
- Importing a KML polygon only uses the first polygon found in the file. Concave areas are supported — the grid follows the boundary, flying straight across any interior notches rather than detouring around them.
```

- [ ] **Step 7: Format and commit**

```bash
npm run fmt
git add docs/screenshots/kml-import-before.png docs/screenshots/kml-import-after.png changelog/2026-07-20-kml-polygon-area-import.md specs/templates.md
git commit -m "docs: changelog and spec update for KML polygon area import"
```

- [ ] **Step 8: Push the branch**

```bash
git push -u origin feat/kml-polygon-area-import
```

Do not open or merge the PR without the user's explicit go-ahead — per this repo's `AGENTS.md`, PR creation needs an issue link check (`gh issue list`) and merging always requires separate, explicit user permission.
