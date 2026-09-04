// Cascade — the values a game begins and returns to.
//
// `initialize` builds the whole state in one go, and the debug surface's `reset`
// restores exactly the same values over a state that has already been played
// (`specs/instrumentation.md`). Both are written here so there is one list of
// what a fresh Cascade is, rather than two that can drift.
//
// `reset` keeps two things it is handed: `muted`, because muting is a player
// preference the runtime owns, and the painted layer's handle, because that is
// the drawing resource rather than part of the game. It clears what the layer
// holds.

import {
  DEFAULT_SEED,
  FOUNDATION_COUNT,
  STAGE_H,
  STAGE_W,
  TABLEAU_COLUMNS,
} from "./constants";
import { createTrailLayer } from "./trail";
import type { CascadeState } from "./game";
import type { Sim } from "./sim";

/** The generator state a seed starts the game from. */
export function seedState(seed: number): number {
  return Math.trunc(seed) | 0;
}

/** Empty piles: the stock, the waste, four foundations and seven columns. */
function emptyPiles(): Pick<
  CascadeState,
  "stock" | "waste" | "wasteSets" | "foundations" | "tableau"
> {
  return {
    stock: [],
    waste: [],
    wasteSets: [],
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau: Array.from({ length: TABLEAU_COLUMNS }, () => []),
  };
}

/** The state the game opens on: the title screen, and a bare table. */
export function openingState(): CascadeState {
  return {
    screen: "title",
    ...emptyPiles(),

    drag: null,
    dropTarget: null,
    pointer: { x: 0, y: 0, down: false },
    lastPress: null,

    autoFlip: true,
    winDetect: true,
    launching: true,
    trailPainting: true,

    launchClock: 0,
    launched: 0,
    flyers: [],
    cascadeDone: false,
    trailStamps: 0,

    nextId: 1,
    simTime: 0,
    muted: false,
    rngState: seedState(DEFAULT_SEED),

    trail: createTrailLayer(STAGE_W, STAGE_H),
    pendingCues: [],
  };
}

/** Restore every declared field to its title-screen value. */
export function resetToTitle(sim: Sim, seed: number): void {
  sim.screen = "title";

  sim.stock = [];
  sim.waste = [];
  sim.wasteSets = [];
  sim.foundations = Array.from({ length: FOUNDATION_COUNT }, () => []);
  sim.tableau = Array.from({ length: TABLEAU_COLUMNS }, () => []);

  sim.drag = null;
  sim.dropTarget = null;
  sim.pointer = { x: 0, y: 0, down: false };
  sim.lastPress = null;

  sim.autoFlip = true;
  sim.winDetect = true;
  sim.launching = true;
  sim.trailPainting = true;

  sim.launchClock = 0;
  sim.launched = 0;
  sim.flyers = [];
  sim.cascadeDone = false;

  sim.trail.clear();
  sim.trailStamps = 0;

  sim.nextId = 1;
  sim.simTime = 0;
  sim.rngState = seedState(seed);
  sim.pendingCues = [];
}
