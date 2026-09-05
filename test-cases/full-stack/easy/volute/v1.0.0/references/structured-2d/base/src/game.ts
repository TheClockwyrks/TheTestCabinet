// Volute — the game definition the engine drives, and the game instance behind
// it.
//
// `game` names the level registry under the names `WORLDS` fixes, the title
// level as the one the engine opens first, and `VoluteGame` as the instance
// class. The instance is the ONE framework object that outlives every level
// transition, so it carries exactly what `specs/state.md` says must survive one
// — the seeded generator's whole state, the origin the reported simulation time
// is measured from, and the request a pending transition is opening with — and
// nothing that belongs to a level: the run, the train, and the hall's bodies
// live in the world the levels build (`src/state.ts`, `src/actors.ts`).
//
// `initialize` declares the cross-level surface once, before the start level
// opens: every action in `ACTIONS` against its binding in `BINDINGS`, the
// produced files, the diagnostic sources that outlive a level, and — returned to
// the engine, which hands it back as `engine.debug` — the debug and automation
// surface `specs/instrumentation.md` fixes (`src/debug.ts`).

import { GameInstance } from "@clockwyrks/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@clockwyrks/structured-2d";
import { ACTIONS, BINDINGS, DEFAULT_SEED, WORLDS } from "./constants";
import type { ChargeId, WorldName } from "./constants";
import { loadAssets } from "./assets";
import { createDebugSurface, type VoluteDebug } from "./debug";
import {
  registerInstanceDiagnostics,
  registerWorldDiagnostics,
} from "./diagnostics";
import { HallMode } from "./hall-mode";
import { hall, title } from "./levels";
import { pick, seedState } from "./rng";
import { COLOR } from "./theme";

// The surface's types are part of the module contract, declared beside the game
// that returns it, so they are exported from here whichever module implements
// them.
export type {
  PosedCore,
  ProjectileSnapshot,
  SegmentSnapshot,
  TrainSnapshot,
  VoluteDebug,
  VoluteSnapshot,
} from "./debug";

/**
 * The field background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the field.
 */
export const BACKGROUND: string = COLOR.field;

/** One pose held while the world it is aimed at is still opening. */
type HeldPose = (mode: HallMode) => void;

/** A level transition in flight, and what to do the moment it lands. */
interface Pending {
  /** The level being opened. */
  readonly world: WorldName;
  /** The level of the run to open on arrival, or nothing for the title. */
  readonly open: { readonly level: number; readonly freshRun: boolean } | null;
  /**
   * The run's own figures, carried across the transition.
   *
   * `startLevel` "Opens `level` ... The score and the cells stay as they are"
   * (specs/instrumentation.md), and a transition builds a fresh game state, so
   * the two figures are read off the outgoing world and written onto the
   * incoming one. A fresh run leaves them behind, since `openRun` sets both.
   */
  readonly carry: { readonly score: number; readonly cells: number } | null;
  /** The poses made since the transition was requested, in call order. */
  readonly poses: HeldPose[];
}

/** The one object that outlives a level transition. */
export class VoluteGame extends GameInstance<VoluteDebug> {
  /**
   * The seeded generator's whole state (`src/rng.ts`). Every random draw the
   * game makes comes from it: the charges of the cores a level opens with, the
   * charge of each emitted core, and the charges the injector loads and queues.
   */
  rngState: number = DEFAULT_SEED;

  /**
   * Whether the inlet emits, and whether the train advances.
   *
   * The two faculty gates `setEmission` and `setFeed` set
   * (specs/instrumentation.md). They live on the instance, not on a world's game
   * state, because "a `reset` and a `startLevel` both leave this where the caller
   * put it": a level opening builds a fresh world, and a value that survives one
   * belongs here (specs/state.md).
   */
  emission = true;
  feed = true;

  /**
   * The frame clock's accumulated time, in milliseconds, at the last `reset`.
   *
   * The engine owns the frame clock and nothing may wind it back, so the
   * simulation time the surface reports is measured from here — which is what
   * makes `reset` leave it at `0` while the clock itself runs on.
   */
  private simOriginMs = 0;

  /** The transition in flight, or `null` while none is. */
  private pending: Pending | null = null;

  override async initialize(api: InitApi): Promise<VoluteDebug> {
    for (const action of ACTIONS) api.input.register(action, BINDINGS[action]);
    await loadAssets(api);
    registerInstanceDiagnostics(api, this);
    return createDebugSurface(this);
  }

  /**
   * Seed the incoming world: bind the instance into its mode, name the values
   * the overlay reads off it, open whatever the transition was requested for,
   * and land any poses made while it was in flight.
   */
  override worldOpened(world: World): void {
    const mode = world.mode;
    if (!(mode instanceof HallMode)) return;
    mode.bind(this);
    registerWorldDiagnostics(mode);

    const pending = this.pending;
    this.pending = null;

    if (world.level === WORLDS.hall) {
      const open = pending?.open ?? { level: 1, freshRun: true };
      const carry = pending?.carry ?? null;
      if (carry !== null) {
        mode.state.score = carry.score;
        mode.state.cells = carry.cells;
      }
      if (open.freshRun) mode.openRun();
      else mode.openLevel(open.level);
    }

    for (const pose of pending?.poses ?? []) pose(mode);
  }

  // ---- What the debug surface and the controls drive ----------------------

  /** The mode of the open world, whichever level that is. */
  mode(): HallMode {
    const mode = this.engine.world.mode;
    if (!(mode instanceof HallMode)) {
      throw new Error(
        `Volute: the "${this.engine.world.level}" level has no mode`,
      );
    }
    return mode;
  }

  /** One charge from the seeded generator, uniformly over `from`. */
  drawCharge(from: readonly ChargeId[]): ChargeId {
    const drawn = pick(this.rngState, from);
    this.rngState = drawn.state;
    return drawn.value;
  }

  /** The simulation time the run has accumulated, in seconds. */
  simTime(): number {
    return (this.engine.frame().timeMs - this.simOriginMs) / 1000;
  }

  /** The engine's own mute bit, read live off the audio bus. */
  muted(): boolean {
    return this.engine.world.audio.muted();
  }

  /** Reseed the generator, restart the reported clock, and return to the title. */
  reset(seed: number): void {
    this.rngState = seedState(seed);
    this.simOriginMs = this.engine.frame().timeMs;
    this.toTitle();
  }

  /** Open a fresh run on level 1: the start control, and the surface's `start`. */
  startRun(): void {
    this.enterHall({ level: 1, freshRun: true });
  }

  /** Open one level of the run, keeping the score and the cells as they are. */
  startLevel(level: number): void {
    this.enterHall({ level, freshRun: false });
  }

  /** Return to the title with every value of a fresh run restored. */
  toTitle(): void {
    const world = this.engine.world;
    if (world.level === WORLDS.title && this.pending === null) {
      this.mode().resetToTitle();
      return;
    }
    this.pending = { world: WORLDS.title, open: null, carry: null, poses: [] };
    world.open(WORLDS.title);
  }

  /**
   * Arrange the live world, or hold the arrangement for the world that is
   * opening.
   *
   * A pose is applied at the call whenever there is a world to apply it to; the
   * one case there is not is the frame a transition was requested in, whose
   * poses land the moment the incoming world has begun play.
   */
  pose(pose: HeldPose): void {
    if (this.pending !== null) {
      this.pending.poses.push(pose);
      return;
    }
    pose(this.mode());
  }

  /** Open the hall, in place when it is already open and by transition when not. */
  private enterHall(open: { level: number; freshRun: boolean }): void {
    const world = this.engine.world;
    if (world.level === WORLDS.hall && this.pending === null) {
      const mode = this.mode();
      if (open.freshRun) mode.openRun();
      else mode.openLevel(open.level);
      return;
    }
    // A fresh run sets both figures itself; a level opened into keeps them.
    const held = this.engine.world.mode;
    const carry =
      open.freshRun || !(held instanceof HallMode)
        ? null
        : { score: held.state.score, cells: held.state.cells };
    this.pending = { world: WORLDS.hall, open, carry, poses: [] };
    world.open(WORLDS.hall);
  }
}

/** The definition the engine is built over. */
export const game: GameDefinition<VoluteDebug> = {
  instance: VoluteGame,
  startLevel: WORLDS.title,
  levels: {
    [WORLDS.title]: title,
    [WORLDS.hall]: hall,
  },
};
