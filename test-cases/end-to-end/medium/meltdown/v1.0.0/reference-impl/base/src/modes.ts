// Meltdown — game modes and difficulty presets. A `ModeConfig` fully
// parameterises a match: the starting economy, the number of waves, and any
// special rules. The standard **Containment** defense is played at one of three
// **difficulties** — which set the starting money and the wave count — and the
// **special modes** are fixed challenges layered on the same systems
// (specs/modes.md). The menu content here (mode/difficulty names and the info
// text shown on hover) is the reference build's own; the specs fix the modes and
// what each changes, not the wording or layout.

export type DifficultyId = "easy" | "medium" | "hard";
export type ModeId =
  | "containment"
  | "hundred"
  | "deep-pockets"
  | "bottleneck"
  | "sudden-death";

// Inclusive tile bounds of a restricted build region (Bottleneck). A footprint is
// only buildable if every tile in it lies within these bounds.
export interface BuildZone {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

export interface ModeConfig {
  mode: ModeId;
  difficulty: DifficultyId | null; // set only for Containment
  label: string; // short readout label, e.g. "CONTAINMENT — HARD"
  startMoney: number;
  startLives: number;
  totalWaves: number;
  interest: boolean; // between-wave interest paid (specs/flow.md)
  hpMult: number; // extra surge-HP multiplier on top of the per-wave scale
  buildZone: BuildZone | null; // Bottleneck: restrict building to this region
  onslaught: boolean; // The Hundred: one continuous 100-unit wave
}

// A selectable menu entry: an id, a display name, and the info lines shown when
// the entry is focused/hovered before it is chosen.
export interface MenuEntry {
  id: string;
  name: string;
  blurb: string[];
}

export interface DifficultyEntry extends MenuEntry {
  startMoney: number;
  totalWaves: number;
}

// The three Containment difficulties. Each sets the opening money and the number
// of waves; Medium is the reference balance (specs/modes.md, specs/flow.md).
export const DIFFICULTIES: DifficultyEntry[] = [
  {
    id: "easy",
    name: "EASY",
    startMoney: 350,
    totalWaves: 15,
    blurb: [
      "The gentlest containment.",
      "Open flush with 350 funds — room to lay a generous maze.",
      "A shorter run of 15 waves.",
    ],
  },
  {
    id: "medium",
    name: "MEDIUM",
    startMoney: 250,
    totalWaves: 20,
    blurb: [
      "The standard containment — the reference balance.",
      "Open with 250 funds.",
      "The full run of 20 waves.",
    ],
  },
  {
    id: "hard",
    name: "HARD",
    startMoney: 200,
    totalWaves: 26,
    blurb: [
      "A punishing containment.",
      "Lean 200 funds to open with.",
      "A long siege of 26 waves — the surge climbs far higher.",
    ],
  },
];

// The mode roster, in mode-select order. Containment leads to the difficulty
// screen; each special mode starts directly (specs/modes.md).
export const MODE_ENTRIES: MenuEntry[] = [
  {
    id: "containment",
    name: "CONTAINMENT",
    blurb: [
      "The standard defense on the open reactor floor.",
      "Hold every wave to the last, pacing your heat across the maze.",
      "Choose a difficulty next: Easy, Medium, or Hard.",
    ],
  },
  {
    id: "hundred",
    name: "THE HUNDRED",
    blurb: [
      "One hundred intruders in a single unbroken surge.",
      "Build during an untimed opening, then hold — no waves to pace,",
      "no pauses to bank interest. Clear all one hundred to win.",
    ],
  },
  {
    id: "deep-pockets",
    name: "DEEP POCKETS",
    blurb: [
      "Open flush with 10,000 funds — build your dream maze at once.",
      "But the vault is all you get: no interest between waves.",
      "The full 20 waves still come.",
    ],
  },
  {
    id: "bottleneck",
    name: "BOTTLENECK",
    blurb: [
      "Build only inside the marked core zone — the rest is off-limits.",
      "Concentrate your guns, and their heat, into one tight killbox.",
      "Thread it with Sinks or watch it bake. 20 waves.",
    ],
  },
  {
    id: "sudden-death",
    name: "SUDDEN DEATH",
    blurb: [
      "One life. A single leak breaches the reactor.",
      "The full 20 waves, with no margin for a mistake.",
    ],
  },
];

// Bottleneck's buildable region: a central block that both straight vent→exhaust
// corridors (mid rows and mid cols) pass through, so the maze still matters.
const BOTTLENECK_ZONE: BuildZone = { c0: 14, c1: 35, r0: 9, r1: 26 };

export function containmentConfig(difficulty: DifficultyId): ModeConfig {
  const d = DIFFICULTIES.find((x) => x.id === difficulty) ?? DIFFICULTIES[1];
  return {
    mode: "containment",
    difficulty,
    label: `CONTAINMENT — ${d.name}`,
    startMoney: d.startMoney,
    startLives: 20,
    totalWaves: d.totalWaves,
    interest: true,
    hpMult: 1,
    buildZone: null,
    onslaught: false,
  };
}

export function specialConfig(mode: ModeId): ModeConfig {
  switch (mode) {
    case "hundred":
      return {
        mode,
        difficulty: null,
        label: "THE HUNDRED",
        startMoney: 600,
        startLives: 20,
        totalWaves: 1,
        interest: false,
        hpMult: 2.5,
        buildZone: null,
        onslaught: true,
      };
    case "deep-pockets":
      return {
        mode,
        difficulty: null,
        label: "DEEP POCKETS",
        startMoney: 10000,
        startLives: 20,
        totalWaves: 20,
        interest: false,
        hpMult: 1,
        buildZone: null,
        onslaught: false,
      };
    case "bottleneck":
      return {
        mode,
        difficulty: null,
        label: "BOTTLENECK",
        startMoney: 300,
        startLives: 20,
        totalWaves: 20,
        interest: true,
        hpMult: 1,
        buildZone: BOTTLENECK_ZONE,
        onslaught: false,
      };
    case "sudden-death":
      return {
        mode,
        difficulty: null,
        label: "SUDDEN DEATH",
        startMoney: 300,
        startLives: 1,
        totalWaves: 20,
        interest: true,
        hpMult: 1,
        buildZone: null,
        onslaught: false,
      };
    default:
      return containmentConfig("medium");
  }
}

// The default match: the standard Containment defense on Medium. Used for the
// title-screen reset and the headless simulation harness.
export const DEFAULT_CONFIG: ModeConfig = containmentConfig("medium");

// The Hundred's fixed onslaught totals exactly one hundred units.
export const ONSLAUGHT_TOTAL = 100;
