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
