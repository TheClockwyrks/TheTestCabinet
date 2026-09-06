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
  CELLS,
  CHAIN_RESET,
  CHARGE_IDS,
  LEVEL_COUNT,
  MACHINERY_KINDS,
  PATH_LENGTH,
  PRESSURE_MAX,
  PRESSURE_MIN,
  SCREENS,
  VOLUTE_DEBUG_VERSION,
} from "./constants";
import type { ChargeId, MachineryKind, ScreenName } from "./constants";
import { pointAt } from "./channel";
import type { VoluteGame } from "./game";
import {
  inDanger,
  TIMED_MACHINERY_KINDS,
  type TimedMachineryKind,
} from "./hall-mode";
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
  /** Whether the inlet emits. */
  emission: boolean;
  /** Whether the train advances. */
  feed: boolean;
  muted: boolean;
  simTime: number;
  /** The charge posed for the next emission, and `null` while none stands. */
  nextEmitted: ChargeId | null;
}

/** The surface `engine.debug` hands back. */
export interface VoluteDebug {
  version: number;
  reset(): void;
  snapshot(): VoluteSnapshot;
  setScreen(name: string): void;
  setLevel(level: number): void;
  setScore(n: number): void;
  setCells(n: number): void;
  setChainStep(k: number): void;
  startLevel(level: number): void;
  poseTrain(cores: readonly PosedCore[]): void;
  clearTrain(): void;
  setLoaded(charge: string): void;
  setQueued(charge: string): void;
  setNextEmitted(charge: string | null): void;
  setAim(angleDegrees: number): void;
  fire(): void;
  setPressure(value: number): void;
  setQuotaRemaining(n: number): void;
  setEmission(enabled: boolean): void;
  setFeed(enabled: boolean): void;
  grantMachinery(kind: string): void;
  pause(): void;
  resume(): void;
}

/** A charge id, or `null` when the argument names none. */
function asChargeOrNull(value: unknown): ChargeId | null {
  return CHARGE_IDS.includes(value as ChargeId) ? (value as ChargeId) : null;
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

/** A screen name, or `title` when the argument names none of the seven. */
function asScreen(value: unknown): ScreenName {
  return SCREENS.includes(value as ScreenName)
    ? (value as ScreenName)
    : SCREENS[0];
}

/** One of the three timed kinds, or `choke` when the argument names none. */
function asTimedKind(value: unknown): TimedMachineryKind {
  return TIMED_MACHINERY_KINDS.includes(value as TimedMachineryKind)
    ? (value as TimedMachineryKind)
    : TIMED_MACHINERY_KINDS[0];
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
     * Restore every declared field to its title-screen value.
     *
     * `muted` is deliberately untouched: muting is a player preference the
     * runtime owns, and a reset is not a reason to start making noise again.
     */
    reset() {
      game.reset();
    },

    /** A pure read of the running game. It changes nothing. */
    snapshot() {
      return snapshot(game);
    },

    /**
     * Set the screen, and change nothing else.
     *
     * No level is opened, no channel is seeded, no timer is started and no
     * interlude is set: the screen alone moves, and what it advances and what
     * the controls read follow from it exactly as they do in play.
     */
    setScreen(name) {
      game.pose((mode) => {
        mode.state.screen = asScreen(name);
      });
    },

    /**
     * Set the level in play, and change nothing else.
     *
     * The level's feed speed and its charge set follow the new value at once,
     * because both are read off the level rather than copied when it opens.
     * Opening a level is `startLevel`.
     */
    setLevel(level) {
      game.pose((mode) => {
        mode.state.level = clamp(
          Math.round(asNumber(level, 1)),
          1,
          LEVEL_COUNT,
        );
      });
    },

    /** Set the run's score. It ends nothing and opens nothing. */
    setScore(n) {
      game.pose((mode) => {
        mode.state.score = Math.max(0, Math.round(asNumber(n, 0)));
      });
    },

    /**
     * Set the cells remaining.
     *
     * `setCells(0)` leaves the screen exactly as it stands: the ending a spent
     * last cell reaches comes from the ticks run after the pose.
     */
    setCells(n) {
      game.pose((mode) => {
        mode.state.cells = clamp(Math.round(asNumber(n, CELLS)), 0, CELLS);
      });
    },

    /**
     * Set the chain step an extraction scores at, and restart the window that
     * returns it to `1`, so the posed step holds for `CHAIN_RESET` of play.
     */
    setChainStep(k) {
      game.pose((mode) => {
        mode.state.chainStep = Math.max(1, Math.round(asNumber(k, 1)));
        mode.state.chainTimer = CHAIN_RESET;
      });
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
     * Pose the charge of the next core the inlet emits, or clear the pose with
     * `null`.
     *
     * The next emission carries it in place of the draw, whatever the channel
     * holds, and consumes it; the inlet's gate, the quota and the mark cadence
     * are untouched, so a posed charge waits behind a held inlet. It lives on
     * the instance, so a `startLevel` leaves it standing and a `reset` clears
     * it.
     */
    setNextEmitted(charge) {
      game.nextEmitted = asChargeOrNull(charge);
    },

    /**
     * Set the aim, normalized into `[0, 360)`, and do nothing else: no core is
     * released, the cooldown is untouched, and the two held charges stay.
     */
    setAim(angleDegrees) {
      game.pose((mode) => {
        const injector = mode.injector();
        mode.aimAt(normalizeAngle(asNumber(angleDegrees, injector.aim)));
      });
    },

    /**
     * Release the loaded core along the CURRENT aim, through the same path the
     * fire control takes.
     *
     * Any cooldown outstanding at the call is cleared first, so the call always
     * launches, and a call made while the injector holds no loaded core draws
     * one first. The flight, the strike, the insertion and any extraction the
     * insertion causes come from the ticks that follow.
     */
    fire() {
      game.pose((mode) => {
        mode.injector().cooldown = 0;
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
     * Hold the inlet, and let it go again.
     *
     * Independent of the quota: a hall whose quota is untouched and whose inlet
     * is held emits nothing and is never cleared for an exhausted quota. It
     * lives on the instance, so a `reset` and a `startLevel` both leave it where
     * the caller put it.
     */
    setEmission(enabled) {
      game.emission = enabled !== false;
    },

    /** Hold the train where it stands, and let it advance again. */
    setFeed(enabled) {
      game.feed = enabled !== false;
    },

    /**
     * Grant one of the three timed kinds, exactly as extracting a run holding a
     * mark of that kind grants it: it becomes the active machinery at its full
     * duration, replacing whatever was active and restarting its timer.
     *
     * `bore` is not granted here — it removes cores and scores the moment it
     * resolves, and no pose decides an outcome.
     */
    grantMachinery(kind) {
      const named = asTimedKind(kind);
      game.pose((mode) => mode.grantTimedMachinery(named));
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
    emission: game.emission,
    feed: game.feed,
    muted: game.muted(),
    simTime: game.simTime(),
    nextEmitted: game.nextEmitted,
  };
}
