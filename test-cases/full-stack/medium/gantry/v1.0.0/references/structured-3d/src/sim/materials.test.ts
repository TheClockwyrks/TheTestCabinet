import { describe, expect, it } from "vitest";
import {
  BUCKLE_REF,
  CABLE_CAP_TENSION,
  STRUT_CAP_COMPRESSION,
  STRUT_CAP_TENSION,
} from "../constants";
import {
  capacityCompression,
  isMaterial,
  MATERIALS,
  utilization,
} from "./materials";

describe("buckling", () => {
  it("leaves a member no longer than BUCKLE_REF at full compression capacity", () => {
    expect(capacityCompression("strut", 2)).toBe(STRUT_CAP_COMPRESSION);
    expect(capacityCompression("strut", BUCKLE_REF)).toBe(
      STRUT_CAP_COMPRESSION,
    );
  });

  it("falls with the square of the length past BUCKLE_REF", () => {
    expect(capacityCompression("strut", 6)).toBeCloseTo(
      STRUT_CAP_COMPRESSION * (4 / 6) ** 2,
      9,
    );
    // The figure the design note rests on: a six-unit chord keeps 44 % of it.
    expect(capacityCompression("strut", 6) / STRUT_CAP_COMPRESSION).toBeCloseTo(
      0.4444,
      4,
    );
  });

  it("applies to the rail as it does to the strut, and not to the cable", () => {
    expect(MATERIALS.rail.buckles).toBe(true);
    expect(MATERIALS.cable.buckles).toBe(false);
    expect(MATERIALS.cable.capCompression).toBe(0);
  });
});

describe("utilization", () => {
  it("reads tension against the tension capacity", () => {
    expect(utilization("strut", 2, STRUT_CAP_TENSION)).toBe(1);
    expect(utilization("cable", 10, CABLE_CAP_TENSION / 2)).toBe(0.5);
  });

  it("reads compression against the length-reduced compression capacity", () => {
    expect(utilization("strut", 4, -STRUT_CAP_COMPRESSION)).toBe(1);
    expect(utilization("strut", 8, -STRUT_CAP_COMPRESSION / 4)).toBeCloseTo(
      1,
      12,
    );
  });

  it("is zero at zero force, which is what a slack cable reports", () => {
    expect(utilization("cable", 12, 0)).toBe(0);
    expect(utilization("strut", 6, 0)).toBe(0);
  });

  it("names the three materials and nothing else", () => {
    expect(isMaterial("strut")).toBe(true);
    expect(isMaterial("rail")).toBe(true);
    expect(isMaterial("beam")).toBe(false);
  });
});
