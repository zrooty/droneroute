# Import and export

Bring in existing missions or export your planned flight as a file ready for DJI drones.

## What you can do

- **Export** a mission as a KMZ file compatible with DJI drones (WPML format).
- **Choose the export target** at the top of the sidebar:
  - **DJI Pilot 2** — enterprise drones (M300/M350, M30, Mavic 3 Enterprise, …). Uses the drone/payload you selected and distance-based photo triggers.
  - **DJI Fly** — consumer drones flown with the DJI Fly app (Mavic 3 Classic/Pro, Air 3, …). Reports the generic DJI Fly drone id, drops the enterprise payload block, takes a photo at each waypoint (reach-point trigger), and sets the camera pitch with a gimbal action so DJI Fly honors it.
- **Import** an existing KMZ file to load its waypoints, actions, POIs, and settings into the editor.

## How it works

### Exporting

1. Plan your mission in the editor.
2. Pick the export target (DJI Pilot 2 or DJI Fly) to match your drone.
3. Click the export/download button.
4. A KMZ file is generated and downloaded to your computer.
5. Load the KMZ onto your drone's controller (manually or using the upload tool).

### Importing

1. Click the import button.
2. Select a KMZ file from your computer.
3. The app reads the file and loads all waypoints, actions, and settings into the editor.

## Good to know

- The exported KMZ follows DJI's WPML standard, so it works with DJI's own flight apps too.
- Imported missions may not look exactly the same if the original file used features not supported by DroneRoute.
- The maximum import file size is 50 MB.
- Imported and saved missions are validated: files with malformed contents or
  out-of-range coordinates are rejected with an error rather than being loaded.
