# KML polygon area import — design

## Problem

Users who have a survey area defined externally (e.g. exported from ArcGIS as a `.kml` polygon, like `ref/1/doc.kml`) currently have no way to turn that shape into a mission. The only way to generate an area-survey grid today is to drag a rectangle by hand on the map (`generateGrid` in `packages/frontend/src/lib/templates.ts`), which can't represent an arbitrary (often concave) parcel boundary.

## Goal

Let a user import a `.kml` file containing a polygon and have the app generate a lawn-mower grid survey whose waypoints follow the actual shape of that polygon, reusing the existing Grid template's config panel and generation logic as much as possible.

## Out of scope

- Shapefile (`.shp`) import — explicitly deferred; KML only for this feature.
- Multiple polygons in one file — only the first `Polygon` found (in document order, including inside `MultiGeometry`) is used; the rest are ignored.
- Persisting the imported polygon boundary as a visible/editable layer after apply — it is a transient preview only, discarded after Apply/Cancel, matching how the existing Orbit/Grid/Facade drag guides behave.
- Splitting a single grid pass into multiple waypoint segments when a row crosses a concave boundary more than twice — the flight line is clipped to the outermost entry/exit points of that row and flies straight across any interior gaps.
- Server-side involvement of any kind — no new backend endpoint, no file upload, no DB changes.

## User flow

1. In the map toolbar's "Template" dropdown (`packages/frontend/src/components/map/MapToolbar.tsx`), a new item **"Import area (KML)"** sits alongside Orbit/Grid/Facade/Pencil.
2. Clicking it immediately opens a native file picker (`<input type="file" accept=".kml">`) — there is no drag-to-draw step for this entry, unlike the other template types.
3. On file selection, the file is read as text and parsed entirely in the browser (never uploaded to the backend).
4. If parsing fails (invalid XML, no `Polygon` element found, degenerate ring) a `toast.error(...)` is shown and the app stays in its previous state.
5. On success, the polygon boundary is drawn on the map as a preview guide, and the same `TemplateConfigPanel` grid form used by the manual Grid template (altitude, line spacing, rotation, photos, reverse) opens, pre-seeded with a grid clipped to the polygon's shape. The waypoint count badge and preview lines are live as the user tweaks parameters.
6. Apply appends the generated waypoints to the mission via the existing `appendWaypoints` store action. Both the polygon preview guide and the grid preview disappear on Apply or Cancel — nothing about the import persists beyond the generated waypoints.

## Parsing (`packages/frontend/src/lib/kmlImport.ts`, new file)

```ts
export function parseKmlPolygon(kmlText: string): [number, number][] | null;
```

- Uses the browser's native `DOMParser` (`application/xml`) — no new npm dependency. `fast-xml-parser` (used server-side for DJI WPML KMZ in `kmzParser.ts`) is not reused here since this runs client-side and the input isn't WPML-namespaced.
- Finds the first `<Placemark>` containing a `<Polygon>` (directly or nested in `<MultiGeometry>`), then its `<outerBoundaryIs><LinearRing><coordinates>` text.
- Splits the coordinate string on whitespace, each token split on `,` as `lng,lat[,alt]`, and swapped to the app's `[lat, lng]` convention (same swap already done for GeoJSON in `extractPolygons()` in `packages/frontend/src/lib/geo.ts`).
- Drops a duplicated closing vertex when the ring's first and last points are identical.
- Returns `null` (caller shows the toast) when: the document fails to parse (`parsererror` element present), no `Polygon`/`coordinates` is found, or the resulting ring has fewer than 3 points.
- Inner rings (`innerBoundaryIs`, i.e. holes) are ignored — only the outer boundary is used.

## Grid generation clipped to a polygon (`packages/frontend/src/lib/templates.ts`)

- `GridParams` gains an optional field: `polygon?: [number, number][]`.
- `corner1`/`corner2` continue to define the bounding box exactly as today; when importing from KML they are set to the polygon's min/max lat/lng corners rather than coming from a drag gesture.
- In `generateGrid`, after computing each pass's rotated endpoint pair (`rLat1,rLng1` → `rLat2,rLng2`, same as today), if `polygon` is present the pair is clipped:
  1. Compute every parametric `t` (0 = start, 1 = end) where the row segment crosses a polygon edge, via a new helper `lineSegmentPolygonIntersections` that follows the same orientation-test math already used by `segmentsIntersect`/`direction`/`onSegment` in `geo.ts`, but returns intersection `t` values instead of a boolean.
  2. Add `t = 0` if the segment's start point is itself inside the polygon (`pointInPolygon`, imported directly from `geo.ts`), and `t = 1` if the end point is inside.
  3. If fewer than 2 candidate `t` values result, the row does not touch the polygon at all — no waypoints are emitted for that pass.
  4. Otherwise the row is clipped to `[min(t), max(t)]` — the outermost crossing points. This is what implements "fly straight across interior gaps" for concave shapes: no special-casing needed for rows with more than 2 crossings, since only the extremes are kept.
- `numPasses` is still derived from the bounding box as today; some interior passes may simply be skipped (0 waypoints) when the box extends beyond the polygon, e.g. near a corner cut off by a diagonal edge. This is expected and requires no special UI handling — the existing waypoint-count badge in `TemplateConfigPanel` already reflects whatever `generateGrid` returns.
- Rectangle-drag grid generation (no `polygon` set) is unchanged — the new clipping path only activates when `polygon` is present.

## Wiring

- `missionStore.ts` gains a transient field `pendingImportPolygon: [number, number][] | null` and setter `setPendingImportPolygon`, used only to hand the parsed polygon from the toolbar to the draw handler.
- `MapToolbar.tsx`: new dropdown entry wires the hidden file input; on successful parse it calls `setPendingImportPolygon(polygon)` then `setTemplateMode("grid")`.
- `TemplateDrawHandler.tsx`: the effect that resets state on `templateMode` change is extended — if `templateMode === "grid"` and `pendingImportPolygon` is non-null, it computes the bounding box, sets `gridParams` to `{ ...DEFAULT_GRID_PARAMS, corner1, corner2, polygon }`, sets `confirmed = true` (skipping the drag step entirely), and clears `pendingImportPolygon`. The manual drag-to-draw path for the Grid template is untouched.
- A new `<Source>/<Layer>` renders `gridParams.polygon` (when present) as a dashed guide line, visually distinct from the existing purple drag-guide, so the user can compare the generated grid against the true imported boundary.

## Edge cases

- Invalid/unparseable KML, or KML without a polygon → `toast.error`, no state change.
- Zero waypoints generated (spacing too coarse relative to the polygon, or a degenerate shape) → config panel still opens showing "0 waypoints"; Apply is harmless (appends nothing), same as how other templates already behave with an empty preview. No new UI state needed.
- No network calls are introduced anywhere in this feature — parsing and generation are 100% client-side, so there are no new CORS/CSP/file-upload-validation concerns under this codebase's security rules.

## Testing

- `packages/frontend` has no test runner configured today (only `packages/backend` uses `vitest`, e.g. `missionValidation.test.ts`). This feature adds `vitest` as a frontend dev dependency plus a `test` script, reusing a tool already established elsewhere in the monorepo rather than introducing a new one.
- `kmlImport.test.ts`: covers a valid single-polygon KML (using `ref/1/doc.kml`-shaped fixtures), a closed-ring duplicate-vertex case, missing-`Polygon` KML, and malformed XML.
- A test alongside `templates.ts` covers `generateGrid` with a `polygon` set: a simple convex clip (fewer waypoints than the full bounding box), a concave polygon producing a skipped row, and the untouched rectangle-only path (no `polygon`) still matching current behavior.

## Files touched

- New: `packages/frontend/src/lib/kmlImport.ts`, `packages/frontend/src/lib/kmlImport.test.ts`
- Modified: `packages/frontend/src/lib/templates.ts` (+ new test coverage for polygon clipping)
- Modified: `packages/frontend/src/components/map/MapToolbar.tsx`
- Modified: `packages/frontend/src/components/map/TemplateDrawHandler.tsx`
- Modified: `packages/frontend/src/store/missionStore.ts`
- Modified: `packages/frontend/package.json` (add `vitest` + `test` script)
- New: `changelog/*.md` entry (per AGENTS.md, this is a user-facing feature)
- Modified: `specs/` — a plain-language spec entry describing the new "Import area (KML)" capability (per AGENTS.md spec-sync rule)
