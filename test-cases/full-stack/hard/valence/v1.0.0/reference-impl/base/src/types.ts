// Valence — shared runtime types (the simulation entities and UI intents).

import type { Branch, DamageType, MatterType, TowerKind, Trait } from "./constants";
import type { Lane } from "./board";

export interface AtomSpec {
  element: 0 | 1;
  shells: number;
}

// A live unit of matter on the board. Its TRAITS decide which damage reaches it and
// whether a tower can see it; its SHELLS are its hit points. Traits stack, and a unit's
// makeup can change as it is broken down — a bonded cluster sheds free atoms as its bond
// pool is chipped away, a heavy splits into daughters (specs/matter.md).
export interface Unit {
  id: number;
  type: MatterType;
  traits: Trait[]; // any of bonded / heavy / inert (stacked)
  lane: Lane;
  s: number; // arc-length progress toward the collector
  element: 0 | 1;
  baseSpeed: number; // px/s before the tick's slow factor
  shells: number; // free-atom / heavy hit points remaining
  maxShells: number;
  atoms: AtomSpec[]; // bonded: the constituent atoms still to be shed (index 0 = leading)
  bondHP: number; // bonded: remaining outer bond integrity (any tower chips it)
  maxBondHP: number;
  // Detection / buff state, recomputed each tick from the aura towers.
  revealed: boolean; // an inert unit currently visible (a Catalyst/Fallout field, + linger)
  revealTimer: number; // seconds of reveal left after leaving a revealing field
  excite: number; // +damage-taken from a Catalyst/Containment field this tick
  markTimer: number; // Beam Disruptor mark: +damage-taken while > 0
  markBonus: number;
  slowFactor: number; // this tick's aura slow multiplier (1 = none)
  hitSlowTimer: number; // Cleaver Impactor on-hit slow, decays
  hitSlowFactor: number;
  radius: number;
  fragmentsShed: number; // boss: fragment steps already shed
  fragmentTarget: number; // boss: total fragment steps
  animT: number; // seconds alive (electron orbit / boss wobble frame)
  hitFlash: number; // seconds since last hit (a brief flash)
  dead: boolean;
}

export interface Tower {
  cell: number; // the build-grid cell id this tower occupies (specs/board.md)
  kind: TowerKind;
  level: 1 | 2 | 3;
  branch: Branch | null; // the branch chosen at tier III (null until then)
  x: number;
  y: number;
  range: number;
  fireRate: number;
  cooldown: number;
  spent: number; // total energy spent (build + upgrades), for the sell refund
  placedInBuildPhaseOf: number; // the round number whose build phase placed it
  refundable: boolean; // full refund until the round it was placed on has run
  fireAnim: number; // seconds since last shot (drives the fire sheet)
  aimAngle: number; // the head's heading — tracks the current target (specs/towers.md)
}

// A shot in flight. A damage tower launches one (or several) toward its target; it homes
// onto that unit and applies the tower's effect on IMPACT (specs/towers.md) — never a
// hitscan. It carries a snapshot of the firing tower's effective shot so the effect is
// correct even if the tower is later sold or upgraded, and misses harmlessly if its
// target is gone. Piercing shots keep travelling and strike several units.
export interface Projectile {
  id: number;
  kind: TowerKind;
  damageType: DamageType;
  dmg: number;
  x: number;
  y: number;
  angle: number; // heading, for the sprite's rotation
  speed: number;
  targetId: number; // the homed unit
  lane: Lane; // the target's lane at launch (for a lane-piercing lance)
  // Shot-shape snapshot (from EffStats), so the impact is faithful.
  splash: number;
  pierce: number; // extra units it can pass through on impact
  pierceRadius: number; // how far a pierce reaches for its next unit
  sameLane: boolean; // a pierce that only strikes the target's own lane (Beam Lance)
  chain: number;
  bondBonus: number;
  heavyBonus: number;
  hitsHeavy: boolean;
  splashOnHeavy: number;
  slowOnHit: number;
  mark: number;
  hitIds: number[]; // units already struck (so a pierce/lane shot doesn't re-hit)
  dead: boolean;
}

// A lingering irradiated zone (Reactor Fallout): damages and reveals matter inside it
// (specs/towers.md). Ticks damage on a cadence and reveals inert units it covers.
export interface Zone {
  id: number;
  x: number;
  y: number;
  radius: number;
  dps: number;
  life: number; // seconds remaining
  tickAcc: number; // accumulator for the damage cadence
}

export type GameState = "title" | "howto" | "playing" | "paused" | "victory" | "defeat";
export type Phase = "build" | "round";

export type FxKind = "energy" | "kinetic" | "nuclear" | "bondsnap" | "split" | "neutralize" | "muzzle" | "leak" | "reveal";
export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
}
export type Cue = "shot" | "kinetic" | "nuclear" | "snap" | "neutralize" | "build" | "alarm" | "reveal";

export interface Clickable {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  payload?: string;
  disabled?: boolean;
}
