## Summary

Let Grid survey missions be exported as multiple sequential KMZ files instead
of one, for surveys with more waypoints than a single battery can fly.

## Changes

- Add a "Split into parts" stepper to the grid survey config panel, with a
  live per-part distance/flight-time estimate (warns if a part would exceed
  the mission's max battery time).
- Exporting a mission with `splitParts > 1` now downloads that many separate
  `.kmz` files, each a complete standalone mission (own waypoint indexing),
  with consecutive parts sharing one connecting waypoint.
