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
