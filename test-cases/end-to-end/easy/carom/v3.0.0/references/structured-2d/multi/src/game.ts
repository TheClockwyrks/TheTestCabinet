// Carom — the game definition the engine drives, and the game instance behind
// it.
//
// `game` names the level registry under the names `LEVELS` fixes, the title
// level as the one the engine opens first, and `CaromGame` as the instance
// class. The instance is the ONE framework object that outlives every level
// transition (the engine constructs it once and keeps it), so it carries
// exactly the state specs/state.md and specs/instrumentation.md need to
// survive a transition — the last match's mode, the seeded generator, and the
// debug driver's hold — and nothing that belongs to a level: the menus, the
// match, and the field's bodies live in the worlds and actors the levels
// build (src/state.ts).
//
// `initialize` declares the cross-level surface once, before the start level
// opens: every action in `ACTIONS` against its binding in `BINDINGS`, the five
// `CUES`, the diagnostic sources the overlay shows, and — returned to the
// engine, which hands it back as `engine.debug` — the debug and automation
// surface specs/instrumentation.md fixes (src/debug.ts).

import { GameInstance } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@test-cabinet/structured-2d";
import { DEFAULT_SEED, LEVELS } from "./constants";
import { defineCues } from "./audio";
import { createDebugSurface, type CaromDebug } from "./debug";
import { diagnosticSources } from "./diagnostics";
import { registerActions } from "./input";
import { match, title } from "./levels";
import { MatchMode } from "./match-mode";
import { nextAngle } from "./rng";
import { MatchState, type Mode } from "./state";
import { COLOR } from "./theme";

// The surface's types are part of the module contract, declared beside the
// game that returns it, so they are exported from here whichever module
// implements them.
export type {
  BallPatch,
  BallSnapshot,
  CaromDebug,
  CaromSnapshot,
  PaddlePatch,
} from "./debug";

/**
 * The field background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the field.
 */
export const BACKGROUND: string = COLOR.bg;

/**
 * Who is driving the paddles (specs/instrumentation.md, "The driver").
 *
 * Inert during normal play: `holding` is false, the registered actions move
 * the human paddles and, in Solo, the AI moves the right one. Every pose on
 * the debug surface sets `holding`, after which BOTH paddles follow `vy`
 * through the real integrator and neither the input actions nor the AI move
 * them — until `reset()`. That is what lets a scenario be posed and replayed
 * exactly. `ai` is the one exception: in Solo it hands the right paddle back
 * to the computer opponent for the rest of the driven scenario.
 */
export interface DriverState {
  holding: boolean;
  ai: boolean;
  /** The vertical velocity held for each paddle, in units per second. */
  vy: { left: number; right: number };
}

/** One pose held while the match level is still opening (src/debug.ts). */
type HeldPose = (world: World) => void;

export class CaromGame extends GameInstance<CaromDebug> {
  /**
   * The mode the current match is played in. It survives the match-over
   * screen (PLAY AGAIN keeps it) and returns to its title-screen value, Solo,
   * whenever the title level opens.
   */
  mode: Mode = "solo";

  /**
   * The seeded generator's whole state (src/rng.ts). `reset({ seed })` seeds
   * it; every draw stores the follow-on state back here.
   */
  rngState: number = DEFAULT_SEED;

  /** The debug driver's hold on the paddles. */
  readonly driver: DriverState = {
    holding: false,
    ai: false,
    vy: { left: 0, right: 0 },
  };

  /**
   * Poses made between `startMatch` and the match world beginning play,
   * applied in call order by `worldOpened`. `null` while no debug-driven
   * match open is pending.
   */
  private heldPoses: HeldPose[] | null = null;

  override initialize(api: InitApi): CaromDebug {
    registerActions(api);
    defineCues(api);
    for (const [name, source] of Object.entries(diagnosticSources(this))) {
      api.diagnostics.register(name, source);
    }
    return createDebugSurface(this);
  }

  /**
   * Seed the incoming world: bind the instance into a match's state (the
   * controllers and mode reach the driver and the generator through it),
   * remember the mode the match plays in, and land any poses a scenario made
   * while this world was opening.
   */
  override worldOpened(world: World): void {
    const state = world.state;
    if (!(state instanceof MatchState)) {
      // Returning to the title restores every match figure to its
      // title-screen value (specs/ui.md), and the mode's is Solo. The title
      // also satisfies no held match poses; a menu-driven transition clears
      // anything stale.
      this.mode = "solo";
      this.heldPoses = null;
      return;
    }
    state.game = this;
    if (world.mode instanceof MatchMode) this.mode = world.mode.modeName;

    const held = this.heldPoses;
    this.heldPoses = null;
    if (held !== null) for (const pose of held) pose(world);
  }

  // ---- The primitives the debug surface (src/debug.ts) drives -------------

  /** Draw a launch's angle from the seeded generator (specs/balls.md). */
  drawLaunchAngle(): number {
    const [angle, next] = nextAngle(this.rngState);
    this.rngState = next;
    return angle;
  }

  /** Reseed the generator, as `reset({ seed })` does. */
  reseed(seed: number): void {
    this.rngState = seed;
  }

  /** Take the paddles from the player and the AI, for a posed scenario. */
  takeControl(): void {
    this.driver.holding = true;
  }

  /** Hand the paddles back: `reset()`'s half of the driver contract. */
  releaseControl(): void {
    this.driver.holding = false;
    this.driver.ai = false;
    this.driver.vy.left = 0;
    this.driver.vy.right = 0;
  }

  /**
   * Open the match level, as choosing a mode from the menu does, and start
   * holding poses for the world it will build.
   */
  openMatch(mode: Mode): void {
    this.heldPoses = [];
    this.engine.world.open(LEVELS.match, { mode });
  }

  /**
   * Drop any held poses and pending match open. Returns whether one was
   * pending, so `reset()` can route through the title transition instead.
   */
  cancelPendingMatch(): boolean {
    const wasPending = this.heldPoses !== null;
    this.heldPoses = null;
    return wasPending;
  }

  /**
   * A pose against the field's tagged actors: applied to the open world at
   * once, or held for the opening match world.
   */
  poseField(pose: HeldPose): void {
    if (this.heldPoses !== null) {
      this.heldPoses.push(pose);
      return;
    }
    pose(this.engine.world);
  }

  /**
   * A pose that needs the match's state: applied at once when a match is
   * open, held while one is opening, and dropped on the menus — where there
   * is no match to pose.
   */
  poseMatch(pose: (state: MatchState) => void): void {
    this.poseField((world) => {
      const state = world.state;
      if (state instanceof MatchState) pose(state);
    });
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
