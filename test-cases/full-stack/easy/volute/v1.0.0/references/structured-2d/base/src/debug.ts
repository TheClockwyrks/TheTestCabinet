// Volute — the debugging and automation surface (specs/instrumentation.md).
//
// The game instance's `initialize` builds this object and returns it; the engine
// holds it and hands it back as `engine.debug`, and that is the one way a caller
// reaches it. Nothing is installed on the page, it holds no state of its own,
// and it is inert during normal play: nothing below runs until something calls
// it.
//
// EVERY OPERATION IS A READ OR A POSE. A pose ARRANGES THE HALL and never
// fabricates an outcome: it puts the live world into a situation through the
// same systems play uses, and the game's own frames — the real advance, the real
// strike, the real extraction — are what run from there. NO POSE DECLINES: each
// applies at the call whatever the screen, and an argument outside its range is
// clamped to the nearest legal value or normalized.
//
// ONE WRINKLE IS CROSSING A LEVEL TRANSITION. `reset`, `start` and `startLevel`
// may have to open a different level, which the engine performs at the end of
// the frame, so a pose made before that transition lands is HELD and applied the
// moment the incoming world has begun play, in call order
// (`VoluteGame.worldOpened`). From the caller's side the sequencing is the one
// the specification states: pose, advance a frame, read.
//
// Everything about DRIVING A BROWSER GAME rather than about Volute belongs to
// the engine and is deliberately absent: there is no `step` (the engine's
// scripted clocks and `engine.advance` own time), no key press (the engine's
// registered actions are driven at its input seam), and no overlay control (the
// engine draws the panel and owns the backtick key).

import {
  CHARGE_IDS,
  DEFAULT_SEED,
  LEVEL_COUNT,
  MACHINERY_KINDS,
  PATH_LENGTH,
  PRESSURE_MAX,
  PRESSURE_MIN,
  VOLUTE_DEBUG_VERSION,
} from "./constants";
import type { ChargeId, MachineryKind, ScreenName } from "./constants";
import { pointAt } from "./channel";
import type { VoluteGame } from "./game";
import { inDanger } from "./hall-mode";
import { clamp, normalizeAngle } from "./math";
import { clearChannel, clearProjectiles, levelSpec } from "./level";
import { resegment, spaced } from "./train";

/** One core, as `poseTrain` takes it: `[s, charge, mark]`. */
export type PosedCore = readonly [number, string, string | null];

/** One core of the train, as `snapshot` reports it. */
export interface TrainSnapshot {
  s: number;
  /** The point `s` gives on the channel. */
  x: number;
  y: number;
  charge: ChargeId;
  mark: MachineryKind | null;
  /** `0` is the lead segment, rising toward the tail. */
  segment: number;
}

/** One segment, as `snapshot` reports it. */
export interface SegmentSnapshot {
  count: number;
  /** The recoil hold's seconds left. */
  hold: number;
}

/** One projectile, as `snapshot` reports it. */
export interface ProjectileSnapshot {
  x: number;
  y: number;
  angle: number;
  charge: ChargeId;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface VoluteSnapshot {
  version: number;
  screen: ScreenName;
  score: number;
  level: number;
  cells: number;
  quotaRemaining: number;
  /** The level's quota less `quotaRemaining`. */
  emitted: number;
  pressure: number;
  /** The effective feed speed, in units per second. */
  feedSpeed: number;
  chainStep: number;
  chainTimer: number;
  interlude: number;
  danger: boolean;
  train: TrainSnapshot[];
  segments: SegmentSnapshot[];
  injector: {
    aim: number;
    cooldown: number;
    loaded: ChargeId | null;
    queued: ChargeId | null;
  };
  projectiles: ProjectileSnapshot[];
  machinery: { kind: MachineryKind; remaining: number } | null;
  muted: boolean;
  simTime: number;
  rngState: number;
}

/** The surface `engine.debug` hands back. */
export interface VoluteDebug {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): VoluteSnapshot;
  start(): void;
  startLevel(level: number): void;
  poseTrain(cores: readonly PosedCore[]): void;
  clearTrain(): void;
  setLoaded(charge: string): void;
  setQueued(charge: string): void;
  fire(angleDegrees: number): void;
  setPressure(value: number): void;
  setQuotaRemaining(n: number): void;
  grantMachinery(kind: string): void;
  pause(): void;
  resume(): void;
}

/** A charge id, or the first of the five when the argument names none. */
function asCharge(value: unknown): ChargeId {
  return CHARGE_IDS.includes(value as ChargeId)
    ? (value as ChargeId)
    : CHARGE_IDS[0];
}

/** A machinery kind, or `null` when the argument names none. */
function asMark(value: unknown): MachineryKind | null {
  return MACHINERY_KINDS.includes(value as MachineryKind)
    ? (value as MachineryKind)
    : null;
}

/** A finite number, or a stated fallback. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Build the surface over the game instance. It holds no state of its own. */
export function createDebugSurface(game: VoluteGame): VoluteDebug {
  return {
    version: VOLUTE_DEBUG_VERSION,

    /**
     * Restore every declared field to its title-screen value and reseed the
     * generator.
     *
     * `muted` is deliberately untouched: muting is a player preference the
     * runtime owns, and a reset is not a reason to start making noise again.
     */
    reset(options) {
      game.reset(asNumber(options?.seed, DEFAULT_SEED));
    },

    /** A pure read of the running game. It changes nothing. */
    snapshot() {
      return snapshot(game);
    },

    /**
     * Pose exactly what the start control on the title does: the score `0`, the
     * cells full, and level `1` opened as `startLevel` opens it.
     *
     * The generator's state and `simTime` stay as they are, so a run from a
     * known seed is a `reset` followed by this.
     */
    start() {
      game.startRun();
    },

    /** Open `level`, exactly as the interlude before it opens it. */
    startLevel(level) {
      game.startLevel(clamp(Math.round(asNumber(level, 1)), 1, LEVEL_COUNT));
    },

    /**
     * Replace every core on the channel with the cores given.
     *
     * The train orders them by descending arc position whatever order the list
     * arrived in, two cores at the same position keeping the order the list gave
     * them. Segments follow from the spacing and every recoil hold is cleared,
     * so a posed train advances on the tick after the call.
     */
    poseTrain(cores) {
      const posed = [...(cores ?? [])].map((core) => ({
        charge: asCharge(core?.[1]),
        s: Math.min(PATH_LENGTH, asNumber(core?.[0], 0)),
        mark: asMark(core?.[2]),
      }));
      // Stable, so two cores at one arc position keep the list's order.
      posed.sort((a, b) => b.s - a.s);
      game.pose((mode) => {
        const state = mode.state;
        clearChannel(state, mode);
        state.cores = posed.map((core) =>
          mode.spawnCore(core.charge, core.s, core.mark, 0),
        );
        resegment(state);
      });
    },

    /**
     * Remove every core from the channel and every projectile.
     *
     * Nothing extracts, nothing scores, and no cell is spent: the cores are
     * simply gone, with no removal and so no recoil, no pressure drop, and no
     * grant.
     */
    clearTrain() {
      game.pose((mode) => {
        clearChannel(mode.state, mode);
        clearProjectiles(mode.state, mode);
      });
    },

    /** Set the charge the injector holds loaded. The generator is untouched. */
    setLoaded(charge) {
      game.pose((mode) => mode.injector().setLoaded(asCharge(charge)));
    },

    /** Set the charge the injector holds queued. The generator is untouched. */
    setQueued(charge) {
      game.pose((mode) => {
        mode.injector().queued = asCharge(charge);
      });
    },

    /**
     * Aim at `angleDegrees` and release the loaded core along it, through the
     * same path the fire control takes.
     *
     * Any cooldown outstanding at the call is cleared first, so the call always
     * launches, and a call made while the injector holds no loaded core draws
     * one first. The flight, the strike, the insertion and any extraction the
     * insertion causes come from the ticks that follow.
     */
    fire(angleDegrees) {
      game.pose((mode) => {
        const injector = mode.injector();
        injector.setAim(normalizeAngle(asNumber(angleDegrees, injector.aim)));
        injector.cooldown = 0;
        mode.fire();
      });
    },

    /** Set the pressure, clamped to its range. */
    setPressure(value) {
      game.pose((mode) => {
        mode.state.pressure = clamp(
          asNumber(value, mode.state.pressure),
          PRESSURE_MIN,
          PRESSURE_MAX,
        );
      });
    },

    /**
     * Set the cores the inlet has left to emit this level.
     *
     * The count of cores emitted this level is the level's quota less what
     * remains, so which of the following emissions carry a mark, and which kind
     * each mark is, follow the new value.
     */
    setQuotaRemaining(n) {
      game.pose((mode) => {
        mode.state.quotaRemaining = clamp(
          Math.round(asNumber(n, 0)),
          0,
          levelSpec(mode.state.level).quota,
        );
      });
    },

    /**
     * Grant a kind exactly as extracting a run holding a mark of that kind
     * grants it: the three timed kinds become the active machinery at their full
     * duration, and `bore` resolves at once, centered on the head core.
     */
    grantMachinery(kind) {
      const named = asMark(kind) ?? MACHINERY_KINDS[0];
      game.pose((mode) => mode.grantMachinery(named));
    },

    /** Pose the pause control. */
    pause() {
      game.pose((mode) => {
        mode.state.screen = "paused";
      });
    },

    /** Pose the pause control again. */
    resume() {
      game.pose((mode) => {
        mode.state.screen = "playing";
      });
    },
  };
}

/** The whole snapshot, read straight off the live world. */
export function snapshot(game: VoluteGame): VoluteSnapshot {
  const mode = game.mode();
  const state = mode.state;
  const injector = mode.injector();

  const train: TrainSnapshot[] = [];
  let segment = 0;
  for (let i = 0; i < state.cores.length; i += 1) {
    const core = state.cores[i];
    if (i > 0 && !spaced(state.cores[i - 1], core)) segment += 1;
    const point = pointAt(core.s);
    train.push({
      s: core.s,
      x: point.x,
      y: point.y,
      charge: core.charge,
      mark: core.mark,
      segment,
    });
  }

  return {
    version: VOLUTE_DEBUG_VERSION,
    screen: state.screen,
    score: state.score,
    level: state.level,
    cells: state.cells,
    quotaRemaining: state.quotaRemaining,
    emitted: levelSpec(state.level).quota - state.quotaRemaining,
    pressure: state.pressure,
    feedSpeed: mode.feedSpeed(),
    chainStep: state.chainStep,
    chainTimer: state.chainTimer,
    interlude: state.interlude,
    danger: inDanger(state),
    train,
    segments: state.segments.map((entry) => ({
      count: entry.count,
      hold: entry.hold,
    })),
    injector: {
      aim: injector.aim,
      cooldown: injector.cooldown,
      loaded: injector.loaded,
      queued: injector.queued,
    },
    projectiles: state.projectiles.map((projectile) => ({
      x: projectile.transform.x,
      y: projectile.transform.y,
      angle: projectile.angle,
      charge: projectile.charge,
    })),
    machinery:
      state.machinery === null
        ? null
        : { kind: state.machinery.kind, remaining: state.machinery.remaining },
    muted: game.muted(),
    simTime: game.simTime(),
    rngState: game.rngState >>> 0,
  };
}
