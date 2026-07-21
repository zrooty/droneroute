# Grid survey: split into multiple flight parts

**Date:** 2026-07-21
**Status:** Approved for planning

## Motivation

Importing a real-world survey area (see `reference/doc.kml`) and running Grid
survey over it can generate hundreds of waypoints — more than a single
battery can fly. Today there is no way to break a mission into multiple
sequential flights from inside droneroute; the user has to do it manually
after export (see `reference/doc (converted) 1.kmz` and `... 2.kmz`, two
independently-flyable WPML missions covering one continuous zigzag path,
split roughly in half, each starting where the previous one's last waypoint
left off).

This spec lets the user choose how many parts to split a Grid survey mission
into, see a live distance/time estimate per part (with a battery-time
warning), and get that many separate KMZ files when they export.

## Scope

- **In scope:** Grid survey template only. Splitting happens at export time;
  the mission itself stays a single continuous, editable path in the app
  (POIs, obstacles, per-waypoint edits all keep working exactly as today).
  Export from the main editor (`App.tsx`'s download button) is the only
  export path that produces split output.
- **Out of scope:** Orbit/Facade/Pencil templates. Splitting saved/shared
  mission exports (`RoutesPage.tsx`, `SharedMissionPage.tsx` keep exporting a
  single KMZ, unchanged) — those can adopt the same `config.splitParts` later
  if wanted, but it's not part of this spec. Automatic part count based on
  `maxBatteryMinutes` (the user picks the count manually; battery time is
  shown as a warning, not used to compute anything).

## User-facing behavior

The Grid survey config panel gets a new **"Split into parts"** stepper
(same style as the existing Altitude/Rotation numeric inputs), directly
below the Photos/Reverse checkboxes. Default 1 (no split, today's behavior).

Whenever it's set above 1, a small list appears underneath:

```
Part 1   1.2 km · 3m40s
Part 2   1.3 km · 3m55s
```

using the mission's `autoFlightSpeed`. Any part whose estimated flight time
exceeds the mission's `maxBatteryMinutes` is shown in a warning color — the
value already exists in Mission Config for exactly this kind of check.

The stepper is clamped so every part keeps at least 2 waypoints (the
existing minimum the export endpoint already enforces).

This value is a per-mission setting (like `autoFlightSpeed` or
`maxBatteryMinutes`), not a one-off panel setting — it's set here because
this is where the user is already looking at waypoint count, but it persists
with the mission and is what the main export button reads at download time.

Clicking **Apply** behaves exactly as today: the full combined waypoint path
is inserted into the mission editor for further editing. Nothing about
editing changes. The only new behavior is at export: the main download
button, when `splitParts > 1`, downloads that many separate `.kmz` files
back-to-back instead of one.

## Data model changes

### `packages/shared/src/types.ts`

```ts
export interface MissionConfig {
  // ...existing fields...
  splitParts?: number; // number of separate KMZ files to export this mission as; default/undefined = 1 (no split)
}
```

Defaults to `undefined` (treated as 1) for backward compatibility with
existing saved missions.

## Split algorithm (`packages/frontend/src/lib/geo.ts`)

`geo.ts` already has (duplicated three times today, in `App.tsx`,
`RoutesPage.tsx`, and `SharedMissionPage.tsx`) the per-segment haversine
distance/time math used to show total mission distance/duration. This spec
consolidates that into one shared export, because the new split function
needs the same per-segment distances:

```ts
export function segmentDistances(waypoints: LatLng[]): number[]; // meters, length = waypoints.length - 1

export function estimateFlightStats(
  waypoints: {
    latitude: number;
    longitude: number;
    speed: number;
    useGlobalSpeed: boolean;
  }[],
  globalSpeedMs: number,
): { distanceM: number; timeS: number };
```

`App.tsx`, `RoutesPage.tsx`, and `SharedMissionPage.tsx` drop their local
copies and import these instead. No behavior change for existing callers.

New function, also in `geo.ts`:

```ts
export function splitWaypointsByDistance<T extends LatLng>(
  waypoints: T[],
  partCount: number,
): T[][];
```

- `partCount <= 1` → returns `[waypoints]` unchanged.
- Walks the cumulative distance from `segmentDistances`, and cuts at the
  waypoint index closest to each `k * total/partCount` (k = 1..partCount-1).
- Each part after the first is prefixed with a duplicate of the previous
  part's last waypoint, so consecutive parts share one coincident waypoint —
  matching the reference KMZ pair exactly.
- Clamps `partCount` down (silently, since this only ever runs against a
  clamped UI input — see below) so no part has fewer than 2 waypoints.

The UI-facing clamp is explicit: the "Split into parts" stepper's `max` is
computed as `Math.max(1, Math.floor((waypointCount + (partCount - 1)) / 2))`
— i.e. the largest N where an N-way split (accounting for the N-1 duplicated
boundary points) still leaves every part with ≥ 2 waypoints.

### Re-indexing (important, easy to get wrong)

`buildTemplateKml`/`buildWaylinesWpml` in the backend emit `<wpml:index>`
from each waypoint's own `.index` field, not its array position. Each part
returned by `splitWaypointsByDistance` must have its waypoints re-indexed to
start at 0 before being sent to `/kmz/generate` — otherwise part 2+ would
export with indices continuing from where part 1 left off (and DJI's WPML
parser expects each mission file's indices to start at 0, as seen in both
reference KMZs).

## UI changes (`packages/frontend/src/components/map/TemplateConfigPanel.tsx`)

- Two new props, grid-only: `splitParts: number`, `onSplitPartsChange: (n: number) => void`.
- New props `autoFlightSpeed: number` and `maxBatteryMinutes: number` (both
  already live on `MissionConfig`, passed down alongside the existing
  `camera` prop) — used only to render the per-part estimate list.
- Stepper + per-part list rendered in the grid branch, using
  `splitWaypointsByDistance(gridPreviewWaypoints, splitParts)` and
  `estimateFlightStats` per part.

### `packages/frontend/src/components/map/TemplateDrawHandler.tsx`

Already reads `missionConfig` from `useMissionStore` and computes
`preview.waypoints` for the grid branch — both are passed straight through
to the panel. `onSplitPartsChange` is wired directly to the store's existing
`setConfig({ splitParts: n })` (not tied to Apply/Cancel — it's a mission
setting, updates immediately like other config fields do elsewhere).

## Export changes (`packages/frontend/src/App.tsx`, `handleExport`)

```ts
const parts =
  config.splitParts && config.splitParts > 1
    ? splitWaypointsByDistance(waypoints, config.splitParts).map(
        reindexFromZero,
      )
    : [waypoints];

for (let i = 0; i < parts.length; i++) {
  const blob = await api.post<Blob>("/kmz/generate", {
    name: missionName,
    config,
    waypoints: parts[i],
    pois,
  });
  downloadBlob(
    blob,
    parts.length > 1
      ? `${missionName} part ${i + 1}.kmz`
      : `${missionName}.kmz`,
  );
}
```

Sequential (not parallel) `await`, so downloads fire one at a time in order.
No backend changes — this reuses the existing `/kmz/generate` endpoint per
part.

## Defaults & edge cases

- `splitParts` unset/1 → identical to current export behavior, byte-for-byte.
- Stepper max clamps down automatically as `waypointCount` changes (e.g. user
  lowers altitude/line spacing after setting a high split count) — never
  lets the user pick a count that would produce a <2-waypoint part.
- POIs and obstacles are not split or duplicated per part — they're
  mission-wide references (e.g. `headingMode: "towardPOI"`), each part's KMZ
  carries the full POI list untouched, same as today's single-file export.

## Testing

- `geo.ts`: unit tests for `segmentDistances`, `estimateFlightStats`
  (regression — same values as today's three duplicated implementations),
  and `splitWaypointsByDistance` (even split, uneven/remainder split,
  `partCount` clamping, boundary-waypoint duplication, re-indexing).
- Manual QA in-browser: import `reference/doc.kml`, run Grid survey, set
  split to 2, confirm the two downloaded KMZs are structurally comparable to
  `reference/doc (converted) 1.kmz` / `... 2.kmz` (index reset, shared
  boundary waypoint, action groups intact).

## Docs

- Update `specs/templates.md` (Grid survey section) per `AGENTS.md`'s
  mandatory spec-sync rule.
- Changelog entry.
