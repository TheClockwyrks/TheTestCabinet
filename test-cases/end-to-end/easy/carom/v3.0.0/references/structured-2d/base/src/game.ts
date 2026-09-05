// Carom — the game definition the engine drives, and the game instance behind
// it.
//
// `game` names the level registry under the names `LEVELS` fixes, the title
// level as the one the engine opens first, and `CaromGame` as the instance
// class. The instance is the ONE framework object that outlives every level
// transition (the engine constructs it once and keeps it), so it carries
// exactly the state that must survive one — and specs/ui.md says precisely
// which fields those are, because "Returning to the title" restores every
// declared field EXCEPT `titleIndex`, `simTime`, `muted`, `seed` and
// `rngState`, and "Starting a match" names a list that leaves the AI's
// faculties and the debug surface's hold on each paddle alone. Everything else
// specs/state.md declares lives in the world: the screen and the menus on the
// game state, the scores on the player states, the field's bodies on the
// actors.
//
// `muted` is the one of the five that is not kept here: it is the runtime's own
// bit, which the game mirrors rather than stores (specs/audio.md), so the
// snapshot reads it live off the world's audio bus.
//
// `initialize` declares the cross-level surface once, before the start level
// opens: every action in `ACTIONS` against its binding in `BINDINGS`, the four
// `CUES`, the diagnostic sources the overlay shows, and — returned to the
// engine, which hands it back as `engine.debug` — the debug and automation
// surface specs/instrumentation.md fixes (`src/debug.ts`).

import { GameInstance } from "@clockwyrks/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@clockwyrks/structured-2d";
import { DEFAULT_SEED, LEVELS } from "./constants";
import { defineCues } from "./audio";
import { CaromMode } from "./carom-mode";
import { createDebugSurface, type CaromDebug } from "./debug";
import { diagnosticSources } from "./diagnostics";
import { registerActions } from "./input";
import { match, title } from "./levels";
import { nextSign } from "./rng";
import { CaromState } from "./state";
import { COLOR } from "./theme";

// The surface's types are part of the module contract, declared beside the
// game that returns it, so they are exported from here whichever module
// implements them.
export type {
  BallSnapshot,
  CaromDebug,
  CaromSnapshot,
  ObstacleSnapshot,
  PaddleSnapshot,
} from "./debug";

/**
 * The field background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the field.
 */
export const BACKGROUND: string = COLOR.bg;

/** The AI's two faculties, each gated on its own (specs/state.md). */
export interface AiState {
  tracking: boolean;
  movement: boolean;
}

/** A value held once per side of the field. */
export type PerSide<T> = { left: T; right: T };

export class CaromGame extends GameInstance<CaromDebug> {
  /**
   * The title menu's remembered selection. Confirming a title item sets it,
   * and every path back to the title restores `menuIndex` from it
   * (specs/ui.md).
   */
  titleIndex = 0;

  /**
   * Accumulated simulation time, in seconds. Every update adds its delta,
   * whatever the screen; only `reset` returns it to zero
   * (specs/instrumentation.md).
   */
  simTime = 0;

  /** The seed the generator was last seeded from. */
  seed: number = DEFAULT_SEED;

  /**
   * The seeded generator's whole state (`src/rng.ts`). Every draw stores the
   * follow-on state back here, so a reseeded replay reproduces exactly.
   */
  rngState: number = DEFAULT_SEED;

  /** The AI's faculties. Both start true, and `reset` returns both to true. */
  readonly ai: AiState = { tracking: true, movement: true };

  /** Whether the debug surface is moving each paddle, one side at a time. */
  readonly driven: PerSide<boolean> = { left: false, right: false };

  /**
   * The velocity `setPaddleVy` last set for each side, in units per second. It
   * holds across frames whether or not that side is driven, and reaches a
   * paddle's `vy` only through the frames advanced while it is
   * (specs/instrumentation.md).
   */
  readonly drivenVy: PerSide<number> = { left: 0, right: 0 };

  override initialize(api: InitApi): CaromDebug {
    registerActions(api);
    defineCues(api);
    for (const [name, source] of Object.entries(diagnosticSources(this))) {
      api.diagnostics.register(name, source);
    }
    return createDebugSurface(this);
  }

  /**
   * Bind the instance into the incoming world's state — the world's
   * controllers, actors, and mode reach the state that outlives a transition
   * through it — and then let the mode make the opening arrangement that needs
   * it. This runs after the mode's `beginPlay`, which is why the arrangement
   * is split in two.
   */
  override worldOpened(world: World): void {
    const state = world.state;
    if (!(state instanceof CaromState)) return;
    state.game = this;
    const mode = world.mode;
    if (mode instanceof CaromMode) mode.arrive();
  }

  /** Draw the serve's vertical sign from the seeded generator. */
  drawServeSign(): 1 | -1 {
    const [sign, next] = nextSign(this.rngState);
    this.rngState = next;
    return sign;
  }

  /** Seed the generator: `seed` is the value given, `rngState` its start. */
  setSeed(seed: number): void {
    this.seed = seed;
    this.rngState = seed;
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
