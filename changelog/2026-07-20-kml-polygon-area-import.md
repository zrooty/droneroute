## Summary

Add the ability to import a KML polygon (e.g. exported from ArcGIS) and automatically generate a grid survey clipped to its shape, instead of only being able to drag a rectangle by hand.

## Changes

- Add "Import area (KML)" to the Template dropdown, which opens a file picker for a `.kml` file
- Parse the first polygon found in the KML file entirely client-side (no upload to the server)
- Extend the Grid survey generator to clip each scan line to the polygon's actual boundary, skipping rows that fall entirely outside it and flying straight across any interior gaps for concave shapes
- Show the imported polygon's boundary on the map alongside the generated grid preview while configuring it
