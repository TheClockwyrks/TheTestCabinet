// Cascade — the game's whole state, in one value.
//
// `specs/state.md` lists what it must carry and `specs/instrumentation.md`
// fixes the one contract over it: every operation the debug surface names is a
// read or a pose of a field here, and `reset` puts every declared field back to
// its title-screen value. Everything else about the shape is this build's.
//
// Two members are machinery rather than game facts and are deliberately not
// reported by the snapshot: `cues`, which holds what the current frame raised
// (`src/cues.ts`), and `trail`, the drawing surface the cascade paints onto
// (`src/trail.ts`). What is OBSERVABLE about the trail is `trailStamps`, which
// is a declared field and is reported.

import { CueQueue } from "./cues";
import {
  FOUNDATION_COUNT,
  STAGE_H,
  STAGE_W,
  TABLEAU_COLUMNS,
} from "./constants";
import {
  clearTrailSurface,
  platformTrail,
  type TrailFactory,
  type TrailSurface,
} from "./trail";
import type {
  Card,
  Drag,
  DropTarget,
  Flyer,
  Gesture,
  LastPress,
  Screen,
} from "./types";

export interface CascadeState {
  /** The screen the game is showing. */
  screen: Screen;
  /** The selected item on the menu the current screen shows. */
  menuIndex: number;
  /** The title menu's remembered selection: the entry last activated there. */
  titleIndex: number;

  /** The thirteen piles, each ordered from its bottom card to its top card. */
  stock: Card[];
  waste: Card[];
  foundations: Card[][];
  tableau: Card[][];
  /** The waste's set memory: cards on each turned set, oldest first. */
  wasteSets: number[];

  /** The run in hand, or `null` when nothing is held. */
  drag: Drag | null;
  /** The pile a release would land the held run on, or `null`. */
  dropTarget: DropTarget | null;
  /** Where the pointer is, and whether it is pressed. */
  pointer: { x: number; y: number; down: boolean };
  /** The most recent press, which the double-click rule is measured against. */
  lastPress: LastPress | null;
  /** The gesture a press opened, until its release closes it. */
  gesture: Gesture | null;

  /** The four faculty gates (`specs/instrumentation.md`). */
  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;

  /** The victory cascade. */
  launchClock: number;
  launched: number;
  flyers: Flyer[];
  cascadeDone: boolean;
  /** Which foundation the launch order visits next. */
  nextFoundation: number;
  /** Stamps the painted layer has taken since it was last cleared. */
  trailStamps: number;

  /** Accumulated game time, in seconds, whatever the screen. */
  simTime: number;
  /** The game's copy of the runtime's mute bit, refreshed in every update. */
  muted: boolean;
  /** The id the next card or flyer this game creates will take. */
  nextId: number;

  /** What the current frame has raised, until an update hands it to the bus. */
  readonly cues: CueQueue;
  /** The persistent surface the cascade paints onto, where one can be made. */
  trail: TrailSurface | null;
}

/** How a fresh state is built. */
export interface StateOptions {
  /** Where the painted layer comes from; defaults to the platform's. */
  trail?: TrailFactory;
}

/** An empty list of piles, one per pile of that kind. */
function emptyPiles(count: number): Card[][] {
  return Array.from({ length: count }, () => []);
}

/** A state on the title screen, with an empty table and every gate on. */
export function createState(options: StateOptions = {}): CascadeState {
  const factory = options.trail ?? platformTrail;
  return {
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    stock: [],
    waste: [],
    foundations: emptyPiles(FOUNDATION_COUNT),
    tableau: emptyPiles(TABLEAU_COLUMNS),
    wasteSets: [],
    drag: null,
    dropTarget: null,
    pointer: { x: 0, y: 0, down: false },
    lastPress: null,
    gesture: null,
    autoFlip: true,
    winDetect: true,
    launching: true,
    trailPainting: true,
    launchClock: 0,
    launched: 0,
    flyers: [],
    cascadeDone: false,
    nextFoundation: 0,
    trailStamps: 0,
    simTime: 0,
    muted: false,
    nextId: 0,
    cues: new CueQueue(),
    trail: factory(STAGE_W, STAGE_H),
  };
}

/** Empty all thirteen piles and the waste's set memory. */
export function clearTable(state: CascadeState): void {
  state.stock.length = 0;
  state.waste.length = 0;
  state.wasteSets.length = 0;
  for (const foundation of state.foundations) foundation.length = 0;
  for (const column of state.tableau) column.length = 0;
}

/** Wipe the painted layer and the count of what it holds. */
export function clearTrail(state: CascadeState): void {
  clearTrailSurface(state.trail);
  state.trailStamps = 0;
}

/**
 * Restore every declared field to its title-screen value.
 *
 * `muted` is deliberately left exactly as it stands: muting is a player
 * preference the runtime owns, and a reset is not a reason to start making
 * noise again (`specs/instrumentation.md`).
 */
export function resetState(state: CascadeState): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.titleIndex = 0;
  clearTable(state);
  state.drag = null;
  state.dropTarget = null;
  state.pointer = { x: 0, y: 0, down: false };
  state.lastPress = null;
  state.gesture = null;
  state.autoFlip = true;
  state.winDetect = true;
  state.launching = true;
  state.trailPainting = true;
  state.launchClock = 0;
  state.launched = 0;
  state.flyers.length = 0;
  state.cascadeDone = false;
  state.nextFoundation = 0;
  clearTrail(state);
  state.simTime = 0;
}
