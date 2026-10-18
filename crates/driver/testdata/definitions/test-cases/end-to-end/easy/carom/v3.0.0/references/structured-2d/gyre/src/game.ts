// Carom — the game definition the engine drives, and the game instance behind
// it.
//
// `game` names the level registry under the names `LEVELS` fixes, the title
// level as the one the engine opens first, and `CaromGame` as the instance
// class. The instance is the ONE framework object that outlives every level
// transition (the engine constructs it once and keeps it), so it carries
// exactly the state specs/state.md says must survive one — the mode of the
// current or most recent match, the title menu's remembered selection, and the
// simulation clock — plus, while a transition is in
// flight, the carry the incoming world is dressed from (`src/carry.ts`).
// Everything scoped to the open world lives on that world's game state and its
// actors (`src/state.ts`).
//
// THE FOUR ACTS THAT CROSS A LEVEL. Carom's six screens are split across two
// levels, so starting a match, returning to the title, resetting, and setting a
// screen the other level hosts are all level transitions — and each keeps a
// different part of the state (specs/ui.md, specs/instrumentation.md). Each is
// one method here: it builds the carry that says what survives and asks the
// engine to open the level, and `worldOpened` writes that carry onto the world
// the engine built. Nothing else in the build opens a level.
//
// `initialize` declares the cross-level surface once, before the start level
// opens: every action in `ACTIONS` against its binding in `BINDINGS`, the four
// `CUES`, the diagnostic sources the overlay shows, and — returned to the
// engine, which hands it back as `engine.debug` — the debug and automation
// surface specs/instrumentation.md fixes (src/debug.ts).

import { GameInstance } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi, World } from "@clockwyrks/structured-2d";
import { LEVELS } from "./constants";
import { defineCues } from "./audio";
import {
  applyCarry,
  captureCarry,
  matchStartCarry,
  titleCarry,
  type CaromCarry,
} from "./carry";
import { createDebugSurface, type CaromDebug } from "./debug";
import { diagnosticSources } from "./diagnostics";
import { registerActions } from "./input";
import { match, title } from "./levels";
import { CaromState, levelOf, type Mode, type Screen } from "./state";
import { COLOR } from "./theme";

// The surface's types are part of the module contract, declared beside the
// game that returns it, so they are exported from here whichever module
// implements them.
export type {
  BallSnapshot,
  CaromDebug,
  CaromSnapshot,
  MenuRect,
  ObstacleSnapshot,
  PaddleSnapshot,
  TrailSampleSnapshot,
} from "./debug";

/**
 * The field background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the field.
 */
export const BACKGROUND: string = COLOR.bg;

export class CaromGame extends GameInstance<CaromDebug> {
  /**
   * The mode the current or most recent match is played in. It survives the
   * match-over screen (PLAY AGAIN keeps it) and returns to its title-screen
   * value, Solo, whenever the game returns to the title.
   */
  mode: Mode = "solo";

  /**
   * The title menu's remembered selection: the entry that led away from the
   * title, which every way back selects again (specs/ui.md). It survives a
   * return to the title, which is the whole point of it.
   */
  titleIndex = 0;

  /**
   * Accumulated simulation time, in seconds. Every update adds its delta,
   * whatever the screen — the paused screen and the menus included — and only
   * `reset` returns it to zero (specs/state.md).
   */
  simTime = 0;

  /**
   * The state the next world to open is dressed from. It is set by whichever
   * act asked for the transition and consumed by `worldOpened`, so it is live
   * only for the length of one transition. The start level is dressed from the
   * title-screen carry, which is what puts the game on its opening state.
   */
  private carried: CaromCarry = titleCarry(0);

  override initialize(api: InitApi): CaromDebug {
    registerActions(api);
    defineCues(api);
    for (const [name, source] of Object.entries(diagnosticSources(this))) {
      api.diagnostics.register(name, source);
    }
    return createDebugSurface(this);
  }

  /**
   * Dress the incoming world: bind the instance into its state — the world's
   * controllers, mode, and components reach the state that outlives a world
   * through it — and write the carry the act that opened this level built.
   */
  override worldOpened(world: World): void {
    const state = world.state;
    if (!(state instanceof CaromState)) return;
    state.game = this;
    applyCarry(world, this.carried);
  }

  // ---- The four acts that open a level -----------------------------------

  /**
   * Start a match, exactly as SOLO and VERSUS on the title, RESTART on the
   * pause menu, and PLAY AGAIN after a match all start one (specs/ui.md).
   */
  startMatch(mode: Mode): void {
    this.mode = mode;
    this.open(matchStartCarry(this.engine.world));
  }

  /**
   * Return to the title, restoring every declared field to its title-screen
   * value except the five that are kept, with `menuIndex` from `titleIndex`
   * (specs/ui.md).
   */
  returnToTitle(): void {
    this.mode = "solo";
    this.open(titleCarry(this.titleIndex));
  }

  /**
   * Return the whole game to its title-screen state, the five kept figures
   * included — the surface's one lifecycle verb (specs/instrumentation.md).
   * The mute bit is the engine's and is deliberately left alone.
   */
  reset(): void {
    this.mode = "solo";
    this.titleIndex = 0;
    this.simTime = 0;
    this.open(titleCarry(0));
  }

  /**
   * Show `screen`, and change nothing else. Within one level that is a field on
   * the game state; across the split it is a level transition carrying the
   * whole of the live state, so the scores, the world, and the menu indices are
   * as they were (specs/instrumentation.md).
   */
  setScreen(screen: Screen): void {
    const world = this.engine.world;
    if (levelOf(screen) === world.level) {
      (world.state as CaromState).screen = screen;
      return;
    }
    this.open(captureCarry(world, screen));
  }

  /** Hold the carry and ask the engine for the level its screen is hosted by. */
  private open(carry: CaromCarry): void {
    this.carried = carry;
    this.engine.world.open(levelOf(carry.screen));
  }
}

export const game: GameDefinition<CaromDebug> = {
  instance: CaromGame,
  startLevel: LEVELS.title,
  levels: {
    [LEVELS.title]: title,
    [LEVELS.match]: match,
  },
};
