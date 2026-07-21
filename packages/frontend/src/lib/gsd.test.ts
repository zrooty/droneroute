import { describe, it, expect } from "vitest";
import {
  groundFootprint,
  spacingFromSidelap,
  intervalFromFrontlap,
  gsdCm,
  type CameraSpec,
} from "./gsd";

// DJI Mavic 3 Enterprise (M3E) wide camera: 4/3" CMOS, 20MP, 5280x3956,
// true focal length 12.29mm. Source: enterprise.dji.com/mavic-3-enterprise/specs
const M3E: CameraSpec = {
  sensorWidthMm: 17.3,
  sensorHeightMm: 13.0,
  focalLengthMm: 12.29,
  imageWidthPx: 5280,
  imageHeightPx: 3956,
};

describe("groundFootprint", () => {
  it("computes the ground footprint width/height at a given altitude", () => {
    const { widthM, heightM } = groundFootprint(M3E, 100);
    // width = 100 * 17.3 / 12.29 ≈ 140.76
    expect(widthM).toBeCloseTo(140.76, 1);
    // height = 100 * 13.0 / 12.29 ≈ 105.78
    expect(heightM).toBeCloseTo(105.78, 1);
  });

  it("scales linearly with altitude", () => {
    const at100 = groundFootprint(M3E, 100);
    const at200 = groundFootprint(M3E, 200);
    expect(at200.widthM).toBeCloseTo(at100.widthM * 2, 5);
    expect(at200.heightM).toBeCloseTo(at100.heightM * 2, 5);
  });
});

describe("spacingFromSidelap", () => {
  it("returns the full footprint width at 0% sidelap", () => {
    const spacing = spacingFromSidelap(M3E, 100, 0);
    expect(spacing).toBeCloseTo(groundFootprint(M3E, 100).widthM, 5);
  });

  it("returns 30% of footprint width at 70% sidelap", () => {
    const spacing = spacingFromSidelap(M3E, 100, 70);
    expect(spacing).toBeCloseTo(groundFootprint(M3E, 100).widthM * 0.3, 5);
  });

  it("returns 0 at 100% sidelap", () => {
    expect(spacingFromSidelap(M3E, 100, 100)).toBeCloseTo(0, 5);
  });
});

describe("intervalFromFrontlap", () => {
  it("returns 20% of footprint height at 80% frontlap", () => {
    const interval = intervalFromFrontlap(M3E, 100, 80);
    expect(interval).toBeCloseTo(groundFootprint(M3E, 100).heightM * 0.2, 5);
  });
});

describe("gsdCm", () => {
  it("computes ground sample distance in cm/px", () => {
    // gsd = altitude * sensorWidthMm * 100 / (focalLengthMm * imageWidthPx)
    // = 100 * 17.3 * 100 / (12.29 * 5280) ≈ 2.665
    expect(gsdCm(M3E, 100)).toBeCloseTo(2.665, 2);
  });

  it("scales linearly with altitude", () => {
    expect(gsdCm(M3E, 200)).toBeCloseTo(gsdCm(M3E, 100) * 2, 5);
  });
});
