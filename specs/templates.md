# Templates

Create common flight patterns automatically instead of placing waypoints one by one.

## What you can do

- **Orbit**: fly a circular path around a center point. Choose radius, number of waypoints, and direction (clockwise or counter-clockwise).
- **Grid survey**: fly a back-and-forth zigzag pattern over an area. Useful for mapping or photogrammetry. You can draw the area by hand, or import a KML polygon (e.g. from ArcGIS) and the grid will automatically follow its shape and center the map on it. Choose line spacing manually, or switch to overlap mode and set sidelap %/frontlap % instead — spacing and photo-capture interval are computed automatically from the selected drone's camera and altitude (requires a drone/payload with known camera specs).
- **Facade scan**: fly a vertical scanning pattern along a building face. Useful for inspections.
- **Pencil path**: draw a freehand path on the map and the app places evenly spaced waypoints along it.

## How it works

1. Select a template from the toolbar or press its shortcut key (O for orbit, G for grid, F for facade, Z for pencil).
2. Configure the template options in the panel that appears.
3. Click on the map to place the template.
4. The generated waypoints appear in the sidebar and can be edited individually.

## Good to know

- You can combine templates — for example, use a grid survey and then add an orbit around a specific structure.
- All generated waypoints behave like normal waypoints after placement. You can move, delete, or change their settings.
- In grid survey's overlap mode, a real waypoint is placed every photo interval along each line (not just at the start and end), and each of those waypoints takes a photo — so coverage is explicit and every capture point is visible and editable. This only works for drones/payloads with known camera specs (shown in the drone/payload selector in mission settings). Large areas can generate many waypoints; use "Split into parts" to break the survey across batteries.
- Grid survey can split its waypoints into multiple separate KMZ files (set "Split into parts" in the grid survey panel) — useful when a survey area generates more waypoints than one battery can fly. Each part is a complete, independently-flyable mission; consecutive parts share one waypoint where they connect. A live distance/time estimate per part is shown while choosing the split count, with a warning if a part would exceed the mission's max battery time.
- Importing a KML polygon only uses the first polygon found in the file. Concave areas are supported — the grid follows the boundary, flying straight across any interior notches rather than detouring around them.
