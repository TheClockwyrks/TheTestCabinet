// Valence — fixed constants: the stage, palette, board geometry, matter and tower
// stats, and campaign tuning. Every number that specs/*.md pins lives here so the
// simulation reads exactly as written (specs/matter.md, specs/towers.md, specs/flow.md).

// ---- Stage (specs/overview.md) -------------------------------------------------
export const STAGE_W = 1280;
export const STAGE_H = 720;

export const STATUS_H = 56; // top status bar: y in [0, 56], full width
export const PANEL_X = 1000; // right build panel: x in [1000, 1280], y in [56, 720]
export const BOARD_X0 = 0;
export const BOARD_Y0 = STATUS_H;
export const BOARD_X1 = PANEL_X;
export const BOARD_Y1 = STAGE_H;

// Fixed simulation timestep (specs/controls.md — a fixed tick, render interpolates).
export const FIXED_STEP = 1 / 60;

// ---- Palette (specs/overview.md) ----------------------------------------------
export const COL = {
  void: "#090d13",
  substrate: "#10171f",
  conduit: "#22303e",
  flow: "#3d6b8c",
  node: "#2b3d4e",
  energy: "#ffcf4a",
  integrity: "#46d6e6",
  elemI: "#7fe0a0",
  elemII: "#6cb6ff",
  shell: "#eaf3ff",
  bond: "#93a6ba",
  inert: "#c4cbd6",
  heavy: "#c7e14a",
  boss: "#a45cff",
  ionizer: "#4aa6ff",
  shear: "#ff8646",
  fission: "#ff5470",
  catalyst: "#e267c8",
  moderator: "#46d6c2",
  alert: "#ff5a52",
  panel: "#121821",
  text: "#e8eef5",
  text2: "#93a2b2",
  text3: "#5d6b7a",
} as const;

export const FONT = `"SF Mono", "JetBrains Mono", "Fira Mono", "DejaVu Sans Mono", "Menlo", "Consolas", monospace`;

// ---- Tower kinds ---------------------------------------------------------------
export type TowerKind = "ionizer" | "shear" | "fission" | "catalyst" | "moderator";
export const TOWER_ORDER: TowerKind[] = ["ionizer", "shear", "fission", "catalyst", "moderator"];

export interface TowerDef {
  kind: TowerKind;
  name: string;
  role: string;
  targets: string; // what it targets, in words (shop/inspector), specs/towers.md
  color: string;
  cost: number;
  range: number; // level-1 range (radius, logical px)
  fireRate: number; // shots/sec (damage towers); 0 for auras
  support: boolean;
}

// specs/towers.md — the fixed base stats.
export const TOWERS: Record<TowerKind, TowerDef> = {
  ionizer: {
    kind: "ionizer",
    name: "IONIZER",
    role: "Strip free atoms",
    targets: "strips free reactive atoms",
    color: COL.ionizer,
    cost: 100,
    range: 110,
    fireRate: 2.0,
    support: false,
  },
  shear: {
    kind: "shear",
    name: "SHEAR",
    role: "Break molecules",
    targets: "breaks molecule bonds",
    color: COL.shear,
    cost: 140,
    range: 100,
    fireRate: 1.5,
    support: false,
  },
  fission: {
    kind: "fission",
    name: "FISSION",
    role: "Split heavies",
    targets: "cracks heavy nuclei",
    color: COL.fission,
    cost: 250,
    range: 120,
    fireRate: 0.6,
    support: false,
  },
  catalyst: {
    kind: "catalyst",
    name: "CATALYST",
    role: "Make inert reactive",
    targets: "reveals inert; excites matter",
    color: COL.catalyst,
    cost: 180,
    range: 120,
    fireRate: 0,
    support: true,
  },
  moderator: {
    kind: "moderator",
    name: "MODERATOR",
    role: "Slow matter",
    targets: "slows all non-boss matter",
    color: COL.moderator,
    cost: 160,
    range: 120,
    fireRate: 0,
    support: true,
  },
};

// Upgrade cost multipliers (of build cost): to level II = 1.0x, to III = 1.6x.
export const UPGRADE_MULT = [0, 1.0, 1.6]; // index by target level (2 or 3)

// Moderator slow factor per level (I/II/III), specs/towers.md.
export const MODERATOR_SLOW = [0.55, 0.45, 0.38];
export const HEAVY_SLOW = 0.78; // heavy nuclei resist the slow (fixed regardless of level)
export const CATALYST_LINGER = 2.0; // reactive persists 2s after leaving a Catalyst field
export const CATALYST_EXCITE_BONUS = [1, 1, 2]; // extra shells/hit while excited, by level (I/II/III)
export const FISSION_SPLASH = [40, 40, 70]; // splash radius by level (I/II/III)

// Per-level tweaks applied on top of the previous level (specs/towers.md).
export const RANGE_PER_LEVEL: Record<TowerKind, number> = {
  ionizer: 12,
  shear: 12,
  fission: 12,
  catalyst: 15,
  moderator: 12,
};
export const FIRERATE_MULT: Record<TowerKind, number> = {
  ionizer: 1.2,
  shear: 1.2,
  fission: 1.25,
  catalyst: 1,
  moderator: 1,
};

// ---- Matter (specs/matter.md) --------------------------------------------------
export type Form = "atom" | "molecule" | "heavy" | "inert" | "boss";
export type MatterType =
  | "monatom"
  | "swift"
  | "dimer"
  | "polymer"
  | "noble"
  | "heavy"
  | "macromass";

export interface MatterDef {
  type: MatterType;
  form: Form;
  label: string;
  element: 0 | 1; // 0 = element I (green), 1 = element II (blue)
  shells: number; // free atom's base electron shells (round 1)
  atoms: number; // molecule atom count (round 1)
  criticality: number; // heavy / boss fission hits to split (round 1)
  speed: number; // logical px/s
  energy: number; // bounty
  leak: number; // integrity cost on leak
  radius: number; // visual/collision radius hint (logical px)
}

export const MATTER: Record<MatterType, MatterDef> = {
  monatom: { type: "monatom", form: "atom", label: "MONATOM", element: 0, shells: 2, atoms: 1, criticality: 0, speed: 55, energy: 2, leak: 1, radius: 11 },
  swift: { type: "swift", form: "atom", label: "SWIFT", element: 1, shells: 1, atoms: 1, criticality: 0, speed: 110, energy: 2, leak: 1, radius: 10 },
  dimer: { type: "dimer", form: "molecule", label: "DIMER", element: 0, shells: 2, atoms: 2, criticality: 0, speed: 50, energy: 5, leak: 1, radius: 11 },
  polymer: { type: "polymer", form: "molecule", label: "POLYMER", element: 1, shells: 2, atoms: 4, criticality: 0, speed: 40, energy: 10, leak: 2, radius: 11 },
  noble: { type: "noble", form: "inert", label: "NOBLE", element: 0, shells: 2, atoms: 1, criticality: 0, speed: 65, energy: 6, leak: 1, radius: 11 },
  heavy: { type: "heavy", form: "heavy", label: "HEAVY", element: 1, shells: 0, atoms: 1, criticality: 2, speed: 35, energy: 12, leak: 2, radius: 13 },
  macromass: { type: "macromass", form: "boss", label: "MACROMASS", element: 1, shells: 0, atoms: 1, criticality: 6, speed: 28, energy: 140, leak: 12, radius: 22 },
};

// Projectile travel speed by damage tower (logical px/s). A shot is a real travelling
// projectile that deals its effect on impact, not a hitscan (specs/towers.md); these are
// fast enough that a hit normally lands well within the fire interval.
export const PROJECTILE_SPEED: Record<"ionizer" | "shear" | "fission", number> = {
  ionizer: 640, // a quick charge bolt
  shear: 480, // a heavier cleaving shard
  fission: 380, // a slow, weighty slug
};

// Freed/stripped atoms are a little faster; capped (specs/matter.md).
export const FRAGMENT_SPEED_BONUS = 10; // an atom peeled from a molecule / a fissioned daughter
export const STRIP_SPEED_BONUS = 6; // an atom that just lost a shell
export const MAX_ATOM_SPEED = 135; // cap on a free atom's speed after bonuses

// Daughters from a fissioned heavy (specs/matter.md: two 2-shell atoms).
export const HEAVY_DAUGHTER_SHELLS = 2;

// ---- Economy / rounds (specs/flow.md) -----------------------------------------
export const TOTAL_ROUNDS = 20;
export const BUILD_PHASE_SECONDS = 15; // between-round build phase length
export const INTEREST_RATE = 0.05;
export const INTEREST_CAP = 50;
export const BOSS_ROUNDS = [10, 20];

export function roundClearBonus(round: number): number {
  return 20 + 5 * round;
}

// Difficulty scaling with round r (specs/flow.md).
export function scaledShells(base: number, r: number): number {
  return base + Math.floor((r - 1) / 5);
}
export function scaledAtoms(base: number, r: number): number {
  return base + Math.floor(r / 6); // add one atom (and bond) every 6 rounds
}
export function scaledCriticality(base: number, r: number): number {
  return base + Math.floor((r - 1) / 6);
}
