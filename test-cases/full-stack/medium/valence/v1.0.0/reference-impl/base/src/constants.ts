// Valence — fixed constants: the stage, palette, board geometry, matter and tower
// stats, and campaign tuning. Every number that specs/*.md pins lives here so the
// simulation reads exactly as written (specs/matter.md, specs/towers.md, specs/campaign.md).
//
// The model (specs/matter.md): matter is HIT POINTS + DAMAGE TYPES + STACKABLE TRAITS,
// not one-form-one-tool. A unit carries electron SHELLS (its hit points), and any of
// three damage types — ENERGY, KINETIC, NUCLEAR — strips them, gated only by a unit's
// TRAITS: BONDED (an outer bond-integrity pool any tower chips through, best chewed by
// kinetic), HEAVY (immune to energy — kinetic or nuclear only), and INERT (untargetable
// until revealed by detection). Traits stack. Seven general-purpose towers each pick one
// of two upgrade BRANCHES at tier III (specs/towers.md).

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
  cell: "#2b3d4e", // placement cue (valid spot) — free placement, no grid (specs/board.md)
  energy: "#ffcf4a",
  integrity: "#46d6e6",
  elemI: "#7fe0a0",
  elemII: "#6cb6ff",
  shell: "#eaf3ff",
  bond: "#93a6ba",
  inert: "#c4cbd6",
  heavy: "#c7e14a",
  boss: "#a45cff",
  // Damage-type accents (specs/overview.md). Energy reuses the ionizer blue, kinetic the
  // cleaver orange, nuclear the reactor red — the three towers that base each type.
  dmgEnergy: "#4aa6ff",
  dmgKinetic: "#ff8646",
  dmgNuclear: "#ff5470",
  ionizer: "#4aa6ff",
  emitter: "#8fb9ff",
  shear: "#ff8646", // Cleaver
  fission: "#ff5470", // Reactor
  beam: "#c9f24a",
  catalyst: "#e267c8",
  moderator: "#46d6c2",
  alert: "#ff5a52",
  panel: "#121821",
  text: "#e8eef5",
  text2: "#93a2b2",
  text3: "#5d6b7a",
} as const;

export const FONT = `"SF Mono", "JetBrains Mono", "Fira Mono", "DejaVu Sans Mono", "Menlo", "Consolas", monospace`;

// ---- Damage types (specs/matter.md) --------------------------------------------
export type DamageType = "energy" | "kinetic" | "nuclear";
export const DMG_COLOR: Record<DamageType, string> = {
  energy: COL.dmgEnergy,
  kinetic: COL.dmgKinetic,
  nuclear: COL.dmgNuclear,
};
// Kinetic does bonus damage to a BONDED unit's bond-integrity pool (specs/matter.md).
export const KINETIC_BOND_BONUS = 2; // base multiplier vs bonds; the Cleaver deepens it.

// ---- Tower kinds ---------------------------------------------------------------
export type TowerKind =
  | "emitter"
  | "ionizer"
  | "cleaver"
  | "reactor"
  | "beam"
  | "catalyst"
  | "moderator";
export const TOWER_ORDER: TowerKind[] = [
  "emitter",
  "ionizer",
  "cleaver",
  "reactor",
  "beam",
  "catalyst",
  "moderator",
];

export type Branch = "A" | "B";

// Per-tower targeting priority (specs/towers.md, specs/controls.md): which valid in-range
// unit a damage tower fires at. FIRST (the default) is the unit furthest along the conduit
// and LAST the least far — both measured by path PROGRESS. NEAREST / FARTHEST instead rank
// by straight-line DISTANCE from the tower's own position (independent of path progress).
// STRONGEST / WEAKEST rank by the most / least remaining hit points. Support auras ignore
// this — they affect every valid unit in range at once.
export type TargetingMode = "first" | "last" | "nearest" | "farthest" | "strongest" | "weakest";
export const TARGETING_ORDER: TargetingMode[] = ["first", "last", "nearest", "farthest", "strongest", "weakest"];
export const TARGETING_LABEL: Record<TargetingMode, string> = {
  first: "FIRST",
  last: "LAST",
  nearest: "NEAREST",
  farthest: "FARTHEST",
  strongest: "STRONGEST",
  weakest: "WEAKEST",
};

export interface BranchDef {
  key: Branch;
  name: string; // e.g. "CHARGED"
  blurb: string; // what it does, in words (shop/inspector), specs/towers.md
}

export interface TowerDef {
  kind: TowerKind;
  name: string;
  role: string; // one-line role (shop/inspector)
  targets: string; // what it does, in words (specs/towers.md)
  color: string;
  cost: number;
  damageType: DamageType | null; // null for the two support auras
  support: boolean;
  // Tier-I base stats (specs/towers.md). Effective stats per level+branch come from
  // deriveStats() below.
  range: number;
  fireRate: number; // shots/sec (damage towers); 0 for auras
  dmg: number; // shells stripped per hit (damage towers)
  detection: boolean; // sees inert matter without help (Beam)
  branchA: BranchDef;
  branchB: BranchDef;
}

// The fixed base stats (specs/towers.md). Tier II is a generic bump; tier III commits to
// branch A or B. deriveStats() below is the single source of the effective numbers.
export const TOWERS: Record<TowerKind, TowerDef> = {
  emitter: {
    kind: "emitter",
    name: "EMITTER",
    role: "Basic energy dart",
    targets: "energy — strips shells; cheap and quick",
    color: COL.emitter,
    cost: 200,
    damageType: "energy",
    support: false,
    range: 100,
    fireRate: 1.8,
    dmg: 1,
    detection: false,
    branchA: { key: "A", name: "CHARGED", blurb: "a bigger bolt with a small energy splash" },
    branchB: { key: "B", name: "SPREAD", blurb: "fans a shot at up to 3 targets, +range" },
  },
  ionizer: {
    kind: "ionizer",
    name: "IONIZER",
    role: "Rapid energy stripper",
    targets: "energy — rapid, low per-hit; eats swarms of atoms",
    color: COL.ionizer,
    cost: 280,
    damageType: "energy",
    support: false,
    range: 110,
    fireRate: 3.0,
    dmg: 1,
    detection: false,
    branchA: { key: "A", name: "ARRAY", blurb: "faster, longer range, and SEES inert matter" },
    branchB: { key: "B", name: "OVERCHARGE", blurb: "strips harder and arcs to a nearby atom" },
  },
  cleaver: {
    kind: "cleaver",
    name: "CLEAVER",
    role: "Kinetic bond-breaker",
    targets: "kinetic — bonus vs bonds; damages heavies",
    color: COL.shear,
    cost: 325,
    damageType: "kinetic",
    support: false,
    range: 88,
    fireRate: 1.2,
    dmg: 2,
    detection: false,
    branchA: { key: "A", name: "REND", blurb: "cleaves through a line of matter; deeper bond bonus" },
    branchB: { key: "B", name: "IMPACTOR", blurb: "heavy specialist: big kinetic + splash on a crack" },
  },
  reactor: {
    kind: "reactor",
    name: "REACTOR",
    role: "Nuclear area blast",
    targets: "nuclear — area burst; damages everything, incl. heavies",
    color: COL.fission,
    cost: 600,
    damageType: "nuclear",
    support: false,
    range: 118,
    fireRate: 0.6,
    dmg: 2,
    detection: false,
    branchA: { key: "A", name: "CHAIN", blurb: "wider blast that chains between heavies" },
    branchB: { key: "B", name: "FALLOUT", blurb: "leaves an irradiated zone that damages and reveals" },
  },
  beam: {
    kind: "beam",
    name: "BEAM",
    role: "Long-range lance",
    targets: "energy — long range, big single hit; SEES inert natively",
    color: COL.beam,
    cost: 500,
    damageType: "energy",
    support: false,
    range: 200,
    fireRate: 0.85,
    dmg: 4,
    detection: true,
    branchA: { key: "A", name: "LANCE", blurb: "pierces the whole lane in one shot" },
    branchB: { key: "B", name: "DISRUPTOR", blurb: "gains heavy damage and marks a target for +damage" },
  },
  catalyst: {
    kind: "catalyst",
    name: "CATALYST",
    role: "Reveal + excite aura",
    targets: "aura — reveals inert matter and excites it (+1 damage taken)",
    color: COL.catalyst,
    cost: 550,
    damageType: null,
    support: true,
    range: 120,
    fireRate: 0,
    dmg: 0,
    detection: false,
    branchA: { key: "A", name: "BROAD", blurb: "wider field, longer reveal linger" },
    branchB: { key: "B", name: "REAGENT", blurb: "stronger excite: matter in-field takes +2 damage" },
  },
  moderator: {
    kind: "moderator",
    name: "MODERATOR",
    role: "Damping slow aura",
    targets: "aura — slows matter in its field (heavies resist; boss immune)",
    color: COL.moderator,
    cost: 400,
    damageType: null,
    support: true,
    range: 120,
    fireRate: 0,
    dmg: 0,
    detection: false,
    branchA: { key: "A", name: "CRYOSTAT", blurb: "deeper slow that also grips heavies" },
    branchB: { key: "B", name: "CONTAINMENT", blurb: "slow + makes matter in-field brittle (+1 damage)" },
  },
};

// Upgrade cost multipliers (of build cost): to level II = 1.0x, to III = 1.7x.
// Indexed by TARGET level (t.level + 1), so slots 0 and 1 are unused padding.
export const UPGRADE_MULT = [0, 0, 1.0, 1.7];

// ---- Effective stats (the single source of the model, specs/towers.md) ---------
// A tower's live behaviour is fully derived from (kind, level, branch). Tier II is a
// generic bump; tier III applies exactly one branch. This keeps the sim and the specs
// reading off one function.
export interface EffStats {
  range: number;
  fireRate: number;
  dmg: number;
  damageType: DamageType | null;
  support: boolean;
  detection: boolean;
  // damage-tower shot shape
  splash: number; // area-of-effect radius on impact (0 = single target)
  pierce: number; // extra units a shot passes through (0 = stops at first)
  lanePierce: boolean; // pierces every unit on the target's lane (Beam Lance)
  chain: number; // extra nearby atoms the hit arcs to (Ionizer Overcharge)
  multiTarget: number; // separate shots launched per volley (Emitter Spread)
  bondBonus: number; // kinetic multiplier vs bonds (non-kinetic ignores this)
  heavyBonus: number; // extra dmg vs a heavy unit (Cleaver Impactor, Beam Disruptor)
  hitsHeavy: boolean; // can this shot damage a heavy at all (energy normally cannot)
  splashOnHeavy: number; // extra splash when a heavy is cracked (Cleaver Impactor)
  slowOnHit: number; // brief slow applied to a struck unit (0 = none)
  mark: number; // +damage-taken applied to a struck unit for MARK_TIME (Beam Disruptor)
  dot: { radius: number; dps: number; life: number } | null; // Reactor Fallout zone
  dotReveals: boolean; // the zone reveals inert matter inside it
  // support auras
  auraSlow: number; // 1 = none; <1 slows
  auraSlowHeavy: number; // slow floor a heavy resists to (>= auraSlow)
  auraReveals: boolean; // reveals inert matter in field
  auraExcite: number; // +damage-taken for matter in field (0 = none)
  revealLinger: number; // seconds an inert unit stays revealed after leaving the field
}

export const MARK_TIME = 2.0; // Beam Disruptor mark duration (s)
export const SLOW_ON_HIT_TIME = 0.6; // Cleaver Impactor on-hit slow duration (s)
export const SLOW_ON_HIT_FACTOR = 0.6;

// Generic per-level bumps applied on the way to tier II and III (before the branch).
function bump(s: EffStats, kind: TowerKind, level: number): void {
  const perLevel = level - 1; // 0,1,2
  if (kind === "catalyst" || kind === "moderator") {
    s.range += 14 * perLevel;
    return;
  }
  s.range += 12 * perLevel;
  s.fireRate *= Math.pow(1.15, perLevel);
  s.dmg += level >= 2 ? 1 : 0; // tier II already adds a shell of punch
}

export function deriveStats(kind: TowerKind, level: 1 | 2 | 3, branch: Branch | null): EffStats {
  const def = TOWERS[kind];
  const s: EffStats = {
    range: def.range,
    fireRate: def.fireRate,
    dmg: def.dmg,
    damageType: def.damageType,
    support: def.support,
    detection: def.detection,
    splash: kind === "reactor" ? 40 : 0,
    pierce: 0,
    lanePierce: false,
    chain: 0,
    multiTarget: 1,
    bondBonus: KINETIC_BOND_BONUS,
    heavyBonus: 0,
    hitsHeavy: def.damageType === "kinetic" || def.damageType === "nuclear",
    splashOnHeavy: 0,
    slowOnHit: 0,
    mark: 0,
    dot: null,
    dotReveals: false,
    auraSlow: kind === "moderator" ? 0.55 : 1,
    auraSlowHeavy: kind === "moderator" ? 0.78 : 1,
    auraReveals: kind === "catalyst",
    auraExcite: kind === "catalyst" ? 1 : 0,
    revealLinger: kind === "catalyst" ? 2.0 : 0,
  };
  bump(s, kind, level);
  if (level < 3 || branch == null) return s;

  // Tier III — apply exactly one branch (specs/towers.md).
  switch (kind) {
    case "emitter":
      if (branch === "A") {
        s.dmg += 2;
        s.splash = 30;
      } else {
        s.multiTarget = 3;
        s.range += 25;
      }
      break;
    case "ionizer":
      if (branch === "A") {
        s.fireRate *= 1.5;
        s.range += 20;
        s.detection = true;
      } else {
        s.dmg += 1;
        s.chain = 1;
      }
      break;
    case "cleaver":
      if (branch === "A") {
        s.pierce = 2;
        s.bondBonus = 3;
      } else {
        s.heavyBonus = 3;
        s.splashOnHeavy = 46;
        s.slowOnHit = SLOW_ON_HIT_FACTOR;
      }
      break;
    case "reactor":
      if (branch === "A") {
        s.splash += 34;
      } else {
        s.dot = { radius: 46, dps: 3, life: 3.0 };
        s.dotReveals = true;
      }
      break;
    case "beam":
      if (branch === "A") {
        s.lanePierce = true;
        s.dmg += 1;
      } else {
        s.hitsHeavy = true;
        s.heavyBonus = 2;
        s.mark = 1;
      }
      break;
    case "catalyst":
      if (branch === "A") {
        s.range += 30;
        s.revealLinger = 4.0;
      } else {
        s.auraExcite = 2;
      }
      break;
    case "moderator":
      if (branch === "A") {
        s.auraSlow = 0.4;
        s.auraSlowHeavy = 0.6;
      } else {
        s.auraSlow = 0.48;
        s.auraExcite = 1; // "brittle" — matter in the field takes +1 damage
      }
      break;
  }
  return s;
}

// ---- Matter (specs/matter.md) --------------------------------------------------
// A unit's TRAITS decide which damage reaches it; its SHELLS are its hit points. A
// bonded unit also carries a bond-integrity pool (bondHP) that any tower chips through,
// shedding free atoms as it depletes.
export type Trait = "bonded" | "heavy" | "inert";

export type MatterType =
  | "atom" // the regular unit — parameterized by its ELECTRON count (1..6)
  | "dimer"
  | "polymer"
  | "lattice" // the heaviest bonded cluster: a big pool over a large spray
  | "noble"
  | "heavy" // an unstable radioactive isotope
  | "shroud" // inert + heavy
  | "chelate" // inert + bonded
  | "macromass"; // boss — a super-heavy nucleus that fissions

// A radioactive isotope breaks down along a DECAY CHAIN as it is worn down. Each decay
// step emits one of: an ALPHA (a full 6-electron atom), a BETA (a light 2-electron atom),
// or — for a super-heavy nucleus — a DAUGHTER isotope, itself heavy and shielded, which
// travels on and must be cracked in its own right. The parent transmutes into a lighter
// nucleus at each step until it reaches a stable one and is neutralized (specs/matter.md).
export type DecayEmission = "alpha" | "beta" | "daughter";
export const ALPHA_ELECTRONS = 6; // an alpha particle is a full 6-electron atom
export const BETA_ELECTRONS = 2; // a beta particle is a light 2-electron atom

// A regular atom is ONE unit type carrying a number of ELECTRONS (1..6) — its layers,
// Bloons-style. Every electron is one shell / one hit point that any damage type strips.
// Electrons render on TWO shells: up to 2 on the inner and up to 4 on the outer
// (specs/matter.md, specs/overview.md). Fewer electrons = a lighter, faster atom (a
// 1-electron atom is the fast, fragile unit); more electrons = slower and tougher.
export const ATOM_MAX_ELECTRONS = 6;
export const ATOM_INNER_MAX = 2; // electrons the inner shell holds before the outer fills
export const ATOM_OUTER_MAX = 4; // electrons the outer shell holds (2 + 4 = 6 total)

// Regular-atom speed (logical px/s) by electron count — fewer electrons, faster.
const ATOM_SPEED = [0, 112, 70, 60, 53, 48, 44];
export function atomSpeed(electrons: number): number {
  return ATOM_SPEED[clampElectrons(electrons)]!;
}
// An atom's visual/collision radius grows a little with its electron count.
export function atomRadius(electrons: number): number {
  return 9 + clampElectrons(electrons); // e1 ≈ 10 … e6 ≈ 15
}
export function clampElectrons(e: number): number {
  return Math.max(1, Math.min(ATOM_MAX_ELECTRONS, Math.round(e)));
}

export interface MatterDef {
  type: MatterType;
  label: string;
  traits: Trait[];
  element: 0 | 1; // 0 = element I (green), 1 = element II (blue)
  shells: number; // free-atom electrons / heavy isotope hit points
  atoms: number; // bonded: constituent atom count
  atomShells: number; // bonded: electrons on each constituent atom (0 = not a cluster)
  bondHP: number; // bonded: outer bond-integrity pool
  speed: number; // logical px/s (0 = computed from electron count, for the atom family)
  leak: number; // integrity cost on leak (0 = its remaining electrons, for the atom family)
  radius: number; // visual/collision radius hint (logical px)
  decay: DecayEmission[]; // isotopes only: the emission at each decay step (else empty)
}

// The fixed roster. `TOTAL SHELLS` below each entry is everything the board must strip to
// finish that unit outright, its own hit points plus everything it fragments into, which
// is also exactly what it pays out (specs/campaign.md). These values do not scale with the
// round: a Dimer is the same unit in Round 3 and Round 38, and a round's difficulty comes
// entirely from the counts and mix its row of the round table names (specs/matter.md).
//
// A cluster's atoms all carry ATOM_MAX_ELECTRONS unless its own `atomShells` says smaller.
export const MATTER: Record<MatterType, MatterDef> = {
  // TOTAL SHELLS = its electron count, 1..6.
  atom: { type: "atom", label: "ATOM", traits: [], element: 0, shells: 1, atoms: 1, atomShells: 0, bondHP: 0, speed: 0, leak: 0, radius: 11, decay: [] },
  // TOTAL SHELLS 11 = bond 5 + 2 atoms of 3.
  dimer: { type: "dimer", label: "DIMER", traits: ["bonded"], element: 0, shells: 3, atoms: 2, atomShells: 3, bondHP: 5, speed: 50, leak: 1, radius: 11, decay: [] },
  // TOTAL SHELLS 47 = bond 11 + 6 atoms of 6.
  polymer: { type: "polymer", label: "POLYMER", traits: ["bonded"], element: 1, shells: 6, atoms: 6, atomShells: 6, bondHP: 11, speed: 40, leak: 2, radius: 12, decay: [] },
  // TOTAL SHELLS 104 = bond 8 + 16 atoms of 6. The heaviest cluster: a modest pool over a
  // very large spray, so opening one floods the strippers behind it.
  lattice: { type: "lattice", label: "LATTICE", traits: ["bonded"], element: 1, shells: 6, atoms: 16, atomShells: 6, bondHP: 8, speed: 34, leak: 4, radius: 15, decay: [] },
  // TOTAL SHELLS = its electron count; an inert atom.
  noble: { type: "noble", label: "NOBLE", traits: ["inert"], element: 0, shells: 3, atoms: 1, atomShells: 0, bondHP: 0, speed: 0, leak: 0, radius: 11, decay: [] },
  // TOTAL SHELLS 23 = 9 shells + alpha 6 + alpha 6 + beta 2.
  heavy: { type: "heavy", label: "ISOTOPE", traits: ["heavy"], element: 1, shells: 9, atoms: 1, atomShells: 0, bondHP: 0, speed: 36, leak: 3, radius: 13, decay: ["alpha", "alpha", "beta"] },
  // TOTAL SHELLS 23, shielded: the same isotope, sealed until it is detected.
  shroud: { type: "shroud", label: "SHROUD", traits: ["inert", "heavy"], element: 1, shells: 9, atoms: 1, atomShells: 0, bondHP: 0, speed: 38, leak: 3, radius: 13, decay: ["alpha", "alpha", "beta"] },
  // TOTAL SHELLS 47, shielded: a Polymer sealed until it is detected.
  chelate: { type: "chelate", label: "CHELATE", traits: ["inert", "bonded"], element: 0, shells: 6, atoms: 6, atomShells: 6, bondHP: 11, speed: 44, leak: 2, radius: 12, decay: [] },
  // TOTAL SHELLS 616 = bond 180 + 132 shells + 6 daughters (23 each) + 17 alpha + 32 beta.
  // A super-heavy nucleus behind its own containment pool. Cracking it is a fission chain:
  // it sheds daughter isotopes that are themselves heavy and must each be cracked in turn,
  // amid a long spray of alpha and beta particles.
  macromass: {
    type: "macromass",
    label: "MACROMASS",
    traits: ["heavy", "bonded"],
    element: 1,
    shells: 132,
    atoms: 1,
    atomShells: 0,
    bondHP: 180,
    speed: 28,
    leak: 12,
    radius: 22,
    decay: [
      "beta", "alpha", "daughter", "beta", "alpha", "beta",
      "alpha", "daughter", "beta", "alpha", "beta", "alpha",
      "daughter", "beta", "alpha", "beta", "alpha", "daughter",
      "beta", "alpha", "beta", "alpha", "daughter", "beta",
      "alpha", "beta", "alpha", "daughter", "beta", "alpha",
      "beta", "alpha", "beta", "alpha", "beta", "alpha",
      "beta", "alpha", "beta", "alpha", "beta", "beta",
      "beta", "beta", "beta", "beta", "beta", "beta",
      "beta", "beta", "beta", "beta", "beta", "beta", "beta",
    ],
  },
};

// Projectile travel speed by damage type (logical px/s). A shot is a real travelling
// projectile that deals its effect on impact, not a hitscan (specs/towers.md).
export const PROJECTILE_SPEED: Record<TowerKind, number> = {
  emitter: 600,
  ionizer: 640,
  cleaver: 480,
  reactor: 380,
  beam: 900, // a fast lance
  catalyst: 0,
  moderator: 0,
};

// ---- Economy / rounds (specs/campaign.md) -----------------------------------------
export const TOTAL_ROUNDS = 40;
export const BUILD_PHASE_SECONDS = 15; // between-round build phase length
export const INTEREST_RATE = 0.05;
export const INTEREST_CAP = 50;
export const BOSS_ROUNDS = [40]; // the first Macromass anchors the final round

export function roundClearBonus(round: number): number {
  return 100 + round;
}

// Difficulty scaling with round r (specs/campaign.md): matter gains HIT POINTS and, late,
// gains TRAITS (combos). Regular atoms grow by their ELECTRON count (the ramp below);
// bond pools, molecule length, and isotope HP grow by the round; speeds, bounties, leaks
// and every tower stat stay fixed — only the matter grows.

