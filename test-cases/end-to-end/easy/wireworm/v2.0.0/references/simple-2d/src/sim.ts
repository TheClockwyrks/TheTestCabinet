// Wireworm — the working value a frame is built in.
//
// The engine holds the state by value and hands every reader a
// `DeepReadonly<WirewormState>` view, so nothing in this build ever writes to a
// state it was handed. What `update` and every debug pose do instead is COPY the
// state they were given into a `Sim` — a field-for-field mirror of
// `WirewormState` with the `readonly` markers dropped — advance that, and return
// it. TypeScript accepts the result as a `WirewormState` because a mutable field
// is assignable to a readonly one, so the copy costs a type assertion nowhere.
//
// The copy is deep down to the entities: every node, worm, foe, bolt and arc is
// rebuilt, so a frame can rewrite one without the state it came from noticing.
// `sprites` is carried across by reference, because the art is loaded once and
// never changes.
//
// Writing the frame this way rather than as a chain of spreads is what keeps the
// rules readable as the rules: `node.charge = Math.min(CHARGE_MAX, charge + 1)`
// is the sentence `specs/nodes.md` writes, and the immutability the engine
// requires is enforced at the one boundary where it matters, the state handed
// in and the state handed back.

import type { CueName } from "./constants";
import type {
  FoeKind,
  Phase,
  PressAnchor,
  Screen,
  Sprites,
  WirewormState,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

/**
 * What a frame produced beside the state it advanced.
 *
 * Cues are gathered rather than played as they happen, so a frame that raises
 * one twice still plays it once, which is what `specs/ui.md` asks for.
 * `segmentsRemoved` is what the level-clear rule reads: `specs/progression.md`
 * makes a clear the STEP in which the last segment is removed, so a board that
 * holds no segments and has had none removed is being played rather than
 * cleared, and that is a fact about the frame rather than about the board.
 */
export interface FrameEvents {
  readonly cues: Set<CueName>;
  segmentsRemoved: number;
}

/** A fresh record of what a frame produced. */
export function newFrameEvents(): FrameEvents {
  return { cues: new Set<CueName>(), segmentsRemoved: 0 };
}

export interface MutTile {
  c: number;
  r: number;
}

export interface MutNode {
  c: number;
  r: number;
  charge: number;
}

export interface MutWorm {
  id: number;
  segments: MutTile[];
  dh: number;
  dv: number;
  diving: boolean;
  stepping: boolean;
  body: boolean;
  stepClock: number;
}

export interface MutFoe {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: boolean;
  mind: boolean;
  travel: boolean;
  dartClock: number;
}

export interface MutBolt {
  id: number;
  x: number;
  y: number;
}

export interface MutArc {
  from: MutTile;
  to: MutTile;
  life: number;
}

export interface MutCursor {
  x: number;
  y: number;
  invulnerable: number;
  contact: boolean;
}

/** The whole of `WirewormState`, writable, for the length of one transition. */
export interface Sim {
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;

  score: number;
  lives: number;
  level: number;
  reachedLevel: number;

  nodes: MutNode[];
  worms: MutWorm[];
  foes: MutFoe[];
  bolts: MutBolt[];
  arcs: MutArc[];

  cursor: MutCursor;
  fireCooldown: number;

  foeSpawning: boolean;
  wormEntry: boolean;
  glitchTimer: number;
  corruptorTimer: number;
  dropperTimer: number;

  nextId: number;
  simTime: number;
  muted: boolean;
  rngState: number;

  presses: PressAnchor[];

  sprites: Sprites;
}

/** Copy the state handed in into a value this transition may write. */
export function toSim(state: DeepReadonly<WirewormState>): Sim {
  return {
    screen: state.screen,
    phase: state.phase,
    phaseTimer: state.phaseTimer,
    menuIndex: state.menuIndex,

    score: state.score,
    lives: state.lives,
    level: state.level,
    reachedLevel: state.reachedLevel,

    nodes: state.nodes.map((node) => ({
      c: node.c,
      r: node.r,
      charge: node.charge,
    })),
    worms: state.worms.map((worm) => ({
      id: worm.id,
      segments: worm.segments.map((tile) => ({ c: tile.c, r: tile.r })),
      dh: worm.dh,
      dv: worm.dv,
      diving: worm.diving,
      stepping: worm.stepping,
      body: worm.body,
      stepClock: worm.stepClock,
    })),
    foes: state.foes.map((foe) => ({
      id: foe.id,
      kind: foe.kind,
      x: foe.x,
      y: foe.y,
      vx: foe.vx,
      vy: foe.vy,
      hit: foe.hit,
      mind: foe.mind,
      travel: foe.travel,
      dartClock: foe.dartClock,
    })),
    bolts: state.bolts.map((bolt) => ({ id: bolt.id, x: bolt.x, y: bolt.y })),
    arcs: state.arcs.map((arc) => ({
      from: { c: arc.from.c, r: arc.from.r },
      to: { c: arc.to.c, r: arc.to.r },
      life: arc.life,
    })),

    cursor: {
      x: state.cursor.x,
      y: state.cursor.y,
      invulnerable: state.cursor.invulnerable,
      contact: state.cursor.contact,
    },
    fireCooldown: state.fireCooldown,

    foeSpawning: state.foeSpawning,
    wormEntry: state.wormEntry,
    glitchTimer: state.glitchTimer,
    corruptorTimer: state.corruptorTimer,
    dropperTimer: state.dropperTimer,

    nextId: state.nextId,
    simTime: state.simTime,
    muted: state.muted,
    rngState: state.rngState,

    presses: state.presses.map((press) => ({
      id: press.id,
      screen: press.screen,
      index: press.index,
    })),

    // Loaded once and never written, so the frames themselves are shared.
    sprites: state.sprites as Sprites,
  };
}

/**
 * The id the next worm, foe or bolt takes.
 *
 * `specs/instrumentation.md` requires only that an id is distinct among the
 * entities live at one moment; a counter that never goes backwards gives that
 * and makes an id stable for as long as its entity exists.
 */
export function takeId(sim: Sim): number {
  const id = sim.nextId;
  sim.nextId = id + 1;
  return id;
}

/** The worm with that id, or `undefined`. */
export function wormById(sim: Sim, id: number): MutWorm | undefined {
  return sim.worms.find((worm) => worm.id === id);
}

/** The foe with that id, or `undefined`. */
export function foeById(sim: Sim, id: number): MutFoe | undefined {
  return sim.foes.find((foe) => foe.id === id);
}
