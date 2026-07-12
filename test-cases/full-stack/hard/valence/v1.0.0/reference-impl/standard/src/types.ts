// Valence — shared runtime types (the simulation entities and UI intents).

import type { Form, MatterType, TowerKind } from "./constants";
import type { Lane } from "./board";

export interface AtomSpec {
  element: 0 | 1;
  shells: number;
}

// A live unit of matter on the board. Its `form` decides which tool can act on it,
// and can change as it is broken down (specs/matter.md).
export interface Unit {
  id: number;
  type: MatterType;
  form: Form;
  lane: Lane;
  s: number; // arc-length progress toward the collector
  element: 0 | 1;
  baseSpeed: number; // px/s before the tick's slow factor
  shells: number; // free atom / reactive noble: remaining electron shells
  atoms: AtomSpec[]; // molecule: bonded atoms (index 0 = leading, peeled first)
  criticality: number; // heavy / boss: accumulated fission hits
  critThreshold: number;
  reactive: boolean; // a noble made reactive by a Catalyst
  reactiveTimer: number; // seconds of reactivity left after leaving the field
  excited: boolean; // inside a Catalyst field this tick
  excitedBonus: number; // extra shells stripped per Ionizer hit while excited
  slowFactor: number; // this tick's slow multiplier (1 = none)
  radius: number;
  fragmentsShed: number; // boss: fragment steps already shed
  fragmentTarget: number; // boss: total fragment steps
  animT: number; // seconds alive (electron orbit / boss wobble frame)
  hitFlash: number; // seconds since last hit (a brief flash)
  dead: boolean;
}

export interface Tower {
  node: number;
  kind: TowerKind;
  level: 1 | 2 | 3;
  x: number;
  y: number;
  range: number;
  fireRate: number;
  cooldown: number;
  spent: number; // total energy spent (build + upgrades), for the sell refund
  placedInBuildPhaseOf: number; // the round number whose build phase placed it
  refundable: boolean; // full refund until the round it was placed on has run
  fireAnim: number; // seconds since last shot (drives the fire sheet)
  aimAngle: number;
}

export type GameState = "title" | "howto" | "playing" | "paused" | "victory" | "defeat";
export type Phase = "build" | "round";

export type FxKind = "ionize" | "bondsnap" | "fission" | "neutralize" | "muzzle" | "leak";
export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
}
export type Cue = "shot" | "snap" | "fission" | "neutralize" | "build" | "alarm";

export interface Clickable {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  payload?: string;
  disabled?: boolean;
}
