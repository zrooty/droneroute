# Grid survey: overlap/sidelap-based spacing

**Date:** 2026-07-21
**Status:** Approved for planning

## Motivation

Inspired by features seen in [YLabs-FPV/YMapper](https://github.com/YLabs-FPV/YMapper) (a DJI Fly/Litchi mission planner), which lets users pick a camera and set overlap/sidelap percentages instead of a raw line spacing.

droneroute's Grid survey template currently takes a manual `spacingM` (line spacing in meters) with no relationship to the actual camera being flown. Users doing real photogrammetry surveys have to compute spacing/overlap by hand. This spec adds an alternative "Overlap %" mode that computes both line spacing (from sidelap %) and a continuous photo-capture interval (from frontlap %) using the selected drone's camera specs and flight altitude.

Note: droneroute exports the DJI **WPML/KMZ** format (`droneEnumValue`/`payloadEnumValue`), targeting DJI Pilot 2 / enterprise aircraft (M300, M30, M350, Mavic 3 Enterprise variants, Mini 4 Pro). YMapper targets **DJI Fly/Litchi** consumer app missions instead, which is why it supports the Mavic 3 Classic — that drone doesn't support WPML/Pilot 2 waypoint missions at all. Adding Mavic 3 Classic to droneroute's drone list is out of scope; it would need an entirely separate export pipeline and is not part of this spec.

## Scope

- **In scope:** Grid survey template only. Sidelap % (line spacing) and frontlap % (continuous photo interval).
- **Out of scope:** Mavic 3 Classic / DJI Fly / Litchi export support. Applying overlap-based spacing to Orbit, Facade scan, or Pencil path templates.

## User-facing behavior

The Grid survey config panel gets a mode toggle: **Manual** (today's behavior, unchanged) vs **Overlap %**.

- **Manual mode:** identical to current behavior — a single "Line spacing" input.
- **Overlap % mode:**
  - Two inputs: **Sidelap %** (default 70%) and **Frontlap %** (default 80%).
  - Read-only computed readout: line spacing (m), photo interval (m), and GSD (ground sample distance, cm/px) — all recomputed live as altitude/overlap/drone selection change.
  - Requires the mission's selected drone+payload (set in Mission Config) to have known camera specs. If the current payload has none (e.g. thermal-only payloads, generic PSDK), the "Overlap %" option is disabled with a tooltip explaining why, and the panel stays in Manual mode.

## Data model changes

### `packages/shared/src/types.ts`

Add optional camera specs to `PayloadModel`, populated for RGB payloads we have real specs for (H20, H20T, M30 Camera, M30T Camera, M3E/T/M/D/TD Camera, Mini 4 Pro Camera). Left undefined for H20N (thermal), H30/H30T (thermal), PSDK (generic third-party payload, no fixed sensor).

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

Add an optional field to `Waypoint`, defaulting to today's behavior (`reachPoint`, single-point action group) when omitted:

```ts
export interface Waypoint {
  // ...existing fields...
  actionTrigger?: {
    type: "multipleDistance";
    distanceM: number;
    endIndex: number; // absolute waypoint index this action group's range ends at
  };
}
```

### `GridParams` (`packages/frontend/src/lib/templates.ts`)

```ts
export interface GridParams {
  // ...existing fields...
  spacingMode: "manual" | "overlap";
  sidelapPct?: number; // used when spacingMode === "overlap"
  frontlapPct?: number; // used when spacingMode === "overlap"
  photoIntervalM?: number; // computed by the panel, carried through to the generator/export
}
```

`spacingMode` defaults to `"manual"` for backward compatibility with existing saved missions (field absent = manual).

## Overlap math (`packages/frontend/src/lib/gsd.ts`, new file)

Standard nadir-camera photogrammetry formulas. Convention: sensor width = across-track (drives sidelap/line spacing), sensor height = along-track (drives frontlap/photo interval) — the standard mount orientation for mapping.

```ts
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

export function gsdCm(camera: CameraSpec, altitudeM: number): number {
  // informational readout only — not used in spacing/interval math
  return (
    (altitudeM * camera.sensorWidthMm * 100) /
    (camera.focalLengthMm * camera.imageWidthPx)
  );
}
```

No new dependency; four pure functions.

## UI changes (`packages/frontend/src/components/map/TemplateConfigPanel.tsx`)

- New optional prop `camera?: CameraSpec`, resolved by the parent from `missionStore`'s `config.droneEnumValue`/`payloadEnumValue` via a `DRONE_MODELS` lookup (same pattern already used in `MissionConfig.tsx`).
- Grid params section gets a segmented-control mode toggle ("Manual" / "Overlap %"), disabled to "Manual" when `camera` is `undefined`.
- Manual mode: unchanged existing UI.
- Overlap mode: Sidelap % and Frontlap % numeric inputs (defaults 70/80), plus a read-only line showing computed spacing, photo interval, and GSD via the `gsd.ts` helpers.

## Grid generation (`packages/frontend/src/lib/templates.ts`, `generateGrid`)

- `spacingM` continues to be used as-is for laying out lines (the panel has already computed it from sidelap % before calling `generateGrid` in overlap mode) — no change to the line-layout math itself.
- New behavior when `spacingMode === "overlap"` and `addPhotos` is true: instead of attaching a `takePhoto` action to both the line-start and line-end waypoints (today's behavior), only the **line-start** waypoint gets `actions: [takePhoto]` plus an `actionTrigger` of type `multipleDistance` with `distanceM: photoIntervalM`. The line-end waypoint gets `actions: []`.
- Because `generateGrid` doesn't know the final absolute waypoint indices yet (those are assigned later by `missionStore.appendWaypoints` via `startIndex + i`), `endIndex` is stored as the **local offset within the batch this call returns** (e.g., the array position of the line's end waypoint). `appendWaypoints` shifts this by `startIndex` when assigning final indices, mirroring how it already shifts `wp.index`.
- Manual mode (or `addPhotos: false`): entirely unchanged from current behavior.

## Backend WPML export (`packages/backend/src/lib/wpml.ts`)

`buildActionGroupXml(wp, groupIdOffset)` currently always emits a single-index `actionGroup` with `actionTriggerType: reachPoint`. It gains a branch:

- If `wp.actionTrigger` is present (type `multipleDistance`): emit `actionGroupStartIndex = wp.index`, `actionGroupEndIndex = wp.actionTrigger.endIndex`, `actionTriggerType = multipleDistance`, `actionTriggerParam = wp.actionTrigger.distanceM`.
- Otherwise: today's behavior (`reachPoint`, single-index group) — unaffected for Orbit/Facade/Pencil/manual-mode Grid.

DJI's WPML format auto-fires the action at the given distance interval between the group's start/end waypoint indices — no additional intermediate waypoints are needed.

## Defaults & edge cases

- Defaults: sidelap 70%, frontlap 80% (standard starting points for photogrammetry).
- Payload has no `camera` spec → "Overlap %" toggle disabled with a tooltip; user stays in Manual mode.
- Computed interval longer than the line itself → harmless; the drone takes one photo at the line start, same as manual mode today.
- Altitude/overlap/drone changes while in Overlap mode recompute spacing/interval/GSD live.

## Testing

- `gsd.ts`: unit tests for `groundFootprint`/`spacingFromSidelap`/`intervalFromFrontlap`/`gsdCm` against hand-computed values for real camera specs (e.g. M3E, M30T). Note: neither `templates.ts` nor `wpml.ts` have existing test files today — the frontend package has no test runner at all yet, so this also means adding one (Vitest, matching the backend's setup).
- `templates.ts`: new tests covering `spacingMode: "overlap"` producing `actionTrigger` on line-start waypoints only, and `endIndex` offsets that are correctly shifted after `missionStore.appendWaypoints`.
- `wpml.ts`: new tests asserting both the existing `reachPoint` XML shape (regression coverage) and the new `multipleDistance` XML shape when a waypoint carries `actionTrigger`.
- Manual QA in-browser (Grid survey panel, before/after screenshots) per `AGENTS.md`'s UI screenshot workflow.

## Docs

- Changelog entry (`changelog/*.md`).
- Update `specs/templates.md` (this repo documents template features there, not in `mission-planning.md`) per `AGENTS.md`'s mandatory spec-sync rule.
