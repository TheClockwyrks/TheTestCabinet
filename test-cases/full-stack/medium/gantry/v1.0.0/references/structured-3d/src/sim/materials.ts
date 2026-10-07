// The material table of `specs/structure.md`, and the two figures derived from
// it: the buckling-reduced compression capacity and a member's utilization.

import {
  BUCKLE_REF,
  CABLE_CAP_TENSION,
  CABLE_COST_PER_UNIT,
  CABLE_EA,
  CABLE_MASS_PER_UNIT,
  CABLE_MAX_LEN,
  RAIL_CAP_COMPRESSION,
  RAIL_CAP_TENSION,
  RAIL_COST_PER_UNIT,
  RAIL_EA,
  RAIL_MASS_PER_UNIT,
  RAIL_MAX_LEN,
  STRUT_CAP_COMPRESSION,
  STRUT_CAP_TENSION,
  STRUT_COST_PER_UNIT,
  STRUT_EA,
  STRUT_MASS_PER_UNIT,
  STRUT_MAX_LEN,
} from "../constants";
import type { Material } from "./types";

/** One row of the material table. */
export interface MaterialSpec {
  readonly costPerUnit: number;
  readonly massPerUnit: number;
  readonly ea: number;
  readonly capTension: number;
  /** A cable has none: in compression it goes slack and carries nothing. */
  readonly capCompression: number;
  readonly maxLength: number;
  /** Whether the compression capacity falls with length. */
  readonly buckles: boolean;
  /** Whether the member leaves the system when its force comes back negative. */
  readonly isCable: boolean;
}

export const MATERIALS: Readonly<Record<Material, MaterialSpec>> = {
  strut: {
    costPerUnit: STRUT_COST_PER_UNIT,
    massPerUnit: STRUT_MASS_PER_UNIT,
    ea: STRUT_EA,
    capTension: STRUT_CAP_TENSION,
    capCompression: STRUT_CAP_COMPRESSION,
    maxLength: STRUT_MAX_LEN,
    buckles: true,
    isCable: false,
  },
  cable: {
    costPerUnit: CABLE_COST_PER_UNIT,
    massPerUnit: CABLE_MASS_PER_UNIT,
    ea: CABLE_EA,
    capTension: CABLE_CAP_TENSION,
    capCompression: 0,
    maxLength: CABLE_MAX_LEN,
    buckles: false,
    isCable: true,
  },
  rail: {
    costPerUnit: RAIL_COST_PER_UNIT,
    massPerUnit: RAIL_MASS_PER_UNIT,
    ea: RAIL_EA,
    capTension: RAIL_CAP_TENSION,
    capCompression: RAIL_CAP_COMPRESSION,
    maxLength: RAIL_MAX_LEN,
    buckles: true,
    isCable: false,
  },
};

export const MATERIAL_NAMES: readonly Material[] = ["strut", "cable", "rail"];

/** Whether a string names a material, for reading posed or stored data. */
export function isMaterial(name: string): name is Material {
  return name === "strut" || name === "cable" || name === "rail";
}

/**
 * The compression a member of length `L` bears: its material's compression
 * capacity times `min(1, (BUCKLE_REF / L)^2)` (`specs/structure.md`).
 */
export function capacityCompression(material: Material, l: number): number {
  const reduction = (BUCKLE_REF / l) * (BUCKLE_REF / l);
  return MATERIALS[material].capCompression * Math.min(1, reduction);
}

/**
 * A member's force against its capacity (`specs/statics.md`): positive force is
 * tension, negative is compression, and a slack cable comes here with `0`.
 */
export function utilization(
  material: Material,
  l: number,
  force: number,
): number {
  if (force >= 0) return force / MATERIALS[material].capTension;
  return -force / capacityCompression(material, l);
}
