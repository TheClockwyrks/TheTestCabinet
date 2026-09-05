// Carom — the game definition the engine drives, and the game instance behind
// it.
//
// `game` names the level registry under the names `LEVELS` fixes, the title
// level as the one the engine opens first, and `CaromGame` as the instance
// class. The instance is the ONE framework object that outlives every level
// transition (the engine constructs it once and keeps it), so it carries
// exactly the state specs/state.md needs to survive a transition — the mode,
// the title menu's remembered selection, the simulation clock, the seeded
// generator, the AI's two faculties, and the debug driver's hold on each
// paddle — and nothing that belongs to a level: the screen, the menus, the
// scores, and the field's bodies live in the world the open level built
// (src/state.ts, src/field.ts).
//
// `initialize` declares the cross-level surface once, before the start level
// opens: every action in `ACTIONS` against its binding in `BINDINGS`, the five
// `CUES`, the diagnostic sources the overlay shows, and — returned to the
// engine, which hands it back as `engine.debug` — the debug and automation
// surface specs/instrumentation.md fixes (src/debug.ts).
//
// THE ONE PIECE OF MACHINERY WORTH READING TWICE is `pending`. Carom's six
// screens are split across two levels — the title level hosts `title` and
// `howto`, the match level the other four — so a pose or a menu choice that
// moves between the two halves has to travel a level transition the engine
// honors at the END of the frame. `pending` is what that journey carries: the
// arrangement the incoming world is posed into once the engine has built it.
// Every path back to the title carries the title-screen arrangement, and a
// `setScreen` that crosses the boundary carries the outgoing world captured as
// it stands, which is how that pose "leaves the scores, the world, and the menu
// indices as they are" (specs/instrumentation.md) across a rebuild it did not
// ask for.

import { GameInstance } from "@clockwyrks/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@clockwyrks/structured-2d";
import { defineCues } from "./audio";
import { DEFAULT_SEED, LEVELS } from "./constants";
import { createDebugSurface, type CaromDebug } from "./debug";
import { diagnosticSources } from "./diagnostics";
import {
  applyArrangement,
  captureArrangement,
  titleArrangement,
  type Arrangement,
} from "./field";
import { registerActions } from "./input";
import { match, title } from "./levels";
import { MatchMode } from "./match-mode";
import { nextAngle } from "./rng";
import { CaromState, isTitleScreen, type Mode, type Screen } from "./state";
import { COLOR } from "./theme";
import type { PressOrigins } from "./menus";
import type { Side } from "./sim";

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

/**
 * One paddle's hold by the debug surface (specs/instrumentation.md).
 *
 * Inert during normal play: `driven` is false, the registered actions move the
 * human paddles and, in Solo, the AI moves the right one. `setPaddleDriven`
 * takes ONE side, leaving the other as it was, and a driven paddle then travels
 * at `drivenVy` through the same integrator every other mover goes through.
 * `drivenVy` holds its value across frames whether or not that paddle is
 * driven, so it is set once and read on every frame the side is held.
 */
export interface PaddleHold {
  driven: boolean;
  drivenVy: number;
}

/** The AI's two faculties, each gated on its own. Both start true. */
export interface AiFaculties {
  tracking: boolean;
  movement: boolean;
}

/** What a level transition carries into the world it is about to build. */
interface PendingOpen {
  /**
   * The arrangement to pose the incoming world into, or `null` to leave the
   * incoming mode's own opening pose alone.
   */
  arrangement: Arrangement | null;
  /**
   * Whether the OUTGOING world is frozen and read for that arrangement as it
   * closes. A `setScreen` that crosses the boundary sets it; a menu choice,
   * which is meant to rebuild, does not.
   */
  carry: boolean;
}

/** The level that hosts `screen` (specs/ui.md). */
function levelFor(screen: Screen): string {
  return isTitleScreen(screen) ? LEVELS.title : LEVELS.match;
}

export class CaromGame extends GameInstance<CaromDebug> {
  /**
   * The mode the current or most recent match is played in. Read every frame
   * rather than baked into the world, so `setMode` — which sets its own field
   * alone (specs/instrumentation.md) — decides who drives the right paddle from
   * the frame it is called on.
   */
  mode: Mode = "solo";

  /** The title menu's remembered selection (specs/ui.md). */
  titleIndex = 0;

  /**
   * Accumulated simulation time, in seconds. `src/game-clock.ts` adds every
   * update's delta time to it, and `reset` returns it to zero.
   */
  simTime = 0;

  /** The seed the generator was last seeded from. */
  seed: number = DEFAULT_SEED;

  /** The seeded generator's whole state (src/rng.ts). */
  rngState: number = DEFAULT_SEED;

  /** The AI's two faculties (specs/instrumentation.md). */
  readonly ai: AiFaculties = { tracking: true, movement: true };

  /** The debug driver's hold on each paddle, one side at a time. */
  readonly driver: Readonly<Record<Side, PaddleHold>> = {
    left: { driven: false, drivenVy: 0 },
    right: { driven: false, drivenVy: 0 },
  };

  /**
   * Which item each pointer in contact was pressed on, by pointer id
   * (src/menus.ts). A gesture belongs to the player rather than to any one
   * world, so it is kept here and survives a transition made mid-drag.
   */
  readonly pressOrigins: PressOrigins = new Map<number, number | null>();

  /** The transition in flight, and what it carries. `null` when none is. */
  private pending: PendingOpen | null = null;

  /**
   * Whether the open world is the outgoing half of a carried transition, and
   * so must not simulate this frame (src/state.ts, `isSimulating`).
   */
  get frozen(): boolean {
    return this.pending?.carry === true;
  }

  override initialize(api: InitApi): CaromDebug {
    registerActions(api);
    defineCues(api);
    for (const [name, source] of Object.entries(diagnosticSources(this))) {
      api.diagnostics.register(name, source);
    }
    return createDebugSurface(this);
  }

  /** The arrangement a carried transition takes with it, read as it closes. */
  override worldClosing(world: World): void {
    if (this.pending?.carry === true) {
      this.pending.arrangement = captureArrangement(world);
    }
  }

  /**
   * Seed the incoming world: bind the instance into its state — the
   * controllers, actors, and mode reach everything that outlives a level
   * through it — take the mode the level was opened with, and pose the world
   * into whatever the transition carried.
   */
  override worldOpened(world: World): void {
    const state = world.state;
    if (!(state instanceof CaromState)) return;
    state.game = this;
    if (world.mode instanceof MatchMode) this.mode = world.mode.modeName;

    const pending = this.pending;
    this.pending = null;
    if (pending?.arrangement != null) {
      applyArrangement(world, pending.arrangement);
    }
  }

  // ---- The primitives the menus and the debug surface drive ---------------

  /** Draw a launch's angle from the seeded generator (specs/balls.md). */
  drawLaunchAngle(): number {
    const [angle, next] = nextAngle(this.rngState);
    this.rngState = next;
    return angle;
  }

  /** Seed the generator, setting both `seed` and `rngState` to `seed`. */
  reseed(seed: number): void {
    this.seed = seed;
    this.rngState = seed;
  }

  /**
   * Start a match, as SOLO and VERSUS on the title, RESTART on the pause menu,
   * and PLAY AGAIN after a match all do (specs/ui.md, "Starting a match"): the
   * match level opens fresh, and its mode's opening pose is the whole of it.
   */
  startMatch(mode: Mode): void {
    this.pending = { arrangement: null, carry: false };
    this.engine.world.open(LEVELS.match, { mode });
  }

  /**
   * Return to the title, restoring every declared field to its title-screen
   * value except `titleIndex`, `simTime`, `muted`, `seed`, and `rngState`, and
   * with `menuIndex` taken from `menuIndex` (specs/ui.md).
   *
   * The world is posed at once so a reading taken before the next frame already
   * sees the title, and the same arrangement travels with the transition when
   * the title's own level has to be opened for it.
   */
  goToTitle(menuIndex: number): void {
    this.mode = "solo";
    this.ai.tracking = true;
    this.ai.movement = true;
    for (const side of ["left", "right"] as const) {
      this.driver[side].driven = false;
      this.driver[side].drivenVy = 0;
    }
    this.pressOrigins.clear();

    const arrangement = titleArrangement(menuIndex);
    const world = this.engine.world;
    applyArrangement(world, arrangement);
    if (world.level !== LEVELS.title) {
      this.pending = { arrangement, carry: false };
      world.open(LEVELS.title);
    }
  }

  /**
   * Make sure the level hosting `screen` is the one that will be open, carrying
   * the world as it stands across the transition if it is not.
   *
   * Called by `setScreen` alone, after it has set the field: the screen is the
   * pose, and the level is the machinery the pose rides (see the header).
   */
  followScreen(screen: Screen): void {
    const wanted = levelFor(screen);
    const world = this.engine.world;
    if (world.level === wanted && !this.frozen) return;
    this.pending = { arrangement: null, carry: true };
    world.open(wanted, { mode: this.mode });
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
