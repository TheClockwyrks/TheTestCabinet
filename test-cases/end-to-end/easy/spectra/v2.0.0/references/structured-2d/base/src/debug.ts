// Spectra — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi` builds it and the game instance's `initialize` returns it. The
// engine holds that same object and hands it back from `engine.debug`, and that
// is the ONE way a caller reaches it: nothing is installed on the page. It holds
// no state of its own and is inert during normal play.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies — `engine.world` at the
// call, so the surface follows the world rather than holding one. A POSE takes
// only the parameters its own row names, arranges the running game, and returns
// nothing; a READING returns plain data built at the call and changes nothing.
//
// EACH POSE SETS ONE FIELD and takes scalars. There is no operation that takes a
// layout, none that arranges several things at once, and none that fabricates an
// outcome: a pose puts the game into a situation, and the game's own stepping,
// contact, band, scoring and stage rules are what run from there when the engine
// advances a frame. So there is no flip and no discharge — a caller drives the
// real action and reads the result — and no `addBurst`, because a burst is what a
// destroyed drone leaves behind.
//
// Everything about DRIVING A BROWSER GAME rather than about Spectra belongs to
// the engine and is deliberately absent: no clock operation (the engine owns the
// clock and `engine.advance` runs exact frames), no key operation (the registered
// actions are driven at the surface's event target), no overlay toggle (the
// engine draws the panel and owns the backtick key), and no `setMuted` (the
// engine owns the mute bit; the `mute` binding sets it and the snapshot reports
// the game's copy of it).

import {
  DEFAULT_SEED,
  ENEMY_BULLET_SPEED,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SPECTRA_DEBUG_VERSION,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  isChallengeStage,
} from "./constants";
import { bulletBand, droneBand, inverted, isShimmering } from "./bands";
import { dischargeReady } from "./discharge";
import { resetToTitle } from "./flow";
import { menuItemRect, type MenuRect } from "./menus";
import { droneById, takeId } from "./entities";
import { spectraState, type SpectraState } from "./game";
import type {
  Band,
  DronePhase,
  DroneKind,
  DroneState,
  Phase,
  Screen,
} from "./game";
import type { World } from "@clockwyrks/structured-2d";

/** The plain, JSON-serializable view `snapshot` returns. */
export interface SpectraSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  mode: "sortie";
  stage: number;
  isChallenge: boolean;
  score: number;
  lives: number;
  extraLifeAwarded: boolean;
  challengeHits: number;
  resonance: number;
  dischargeReady: boolean;
  inversion: number;
  inversionActive: boolean;
  muted: boolean;
  waveEntry: boolean;
  diveLaunching: boolean;
  stageClearing: boolean;
  diveClock: number;
  diveGap: number;
  droneSpeedScale: number;
  bulletSpeedScale: number;
  diveGapScale: number;
  fluxHold: number;
  ship: {
    x: number;
    band: Band;
    alive: boolean;
    lockout: number;
    cooldown: number;
    contact: boolean;
  };
  discharge: { active: boolean; radius: number };
  drones: {
    id: number;
    kind: DroneKind;
    x: number;
    y: number;
    band: Band;
    effectiveBand: Band;
    phase: DronePhase;
    slotX: number;
    slotY: number;
    bandClock: number;
    shimmer: boolean;
    shellAlive: boolean;
    travel: boolean;
    oscillation: boolean;
    fire: boolean;
  }[];
  bullets: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    band: Band;
    effectiveBand: Band;
    friendly: boolean;
  }[];
  bursts: {
    id: number;
    x: number;
    y: number;
    size: number;
    elapsed: number;
    particles: number;
  }[];
  simTime: number;
}

/** The surface the game instance's `initialize` returns. */
export interface SpectraDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): SpectraSnapshot;
  /** Bring every reported reading into agreement with the game as it stands. */
  reconcile(): void;
  menuItemRect(index: number): MenuRect | null;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(n: number): void;
  setScore(n: number): void;
  setLives(n: number): void;
  setStage(n: number): void;
  setExtraLifeAwarded(awarded: boolean): void;
  setChallengeHits(n: number): void;

  setWaveEntry(enabled: boolean): void;
  setDiveLaunching(enabled: boolean): void;
  setStageClearing(enabled: boolean): void;
  setShipContact(enabled: boolean): void;
  setDiveClock(seconds: number): void;
  setDiveGap(seconds: number): void;

  setShipX(x: number): void;
  setShipBand(band: Band): void;
  setFireLockout(seconds: number): void;
  setFireCooldown(seconds: number): void;

  setResonance(value: number): void;
  setInversion(seconds: number): void;

  addDrone(kind: DroneKind, x: number, y: number): void;
  setDronePosition(id: number, x: number, y: number): void;
  setDroneBand(id: number, band: Band): void;
  setDronePhase(id: number, phase: DronePhase): void;
  setDroneSlot(id: number, x: number, y: number): void;
  setDroneBandClock(id: number, seconds: number): void;
  setDroneShell(id: number, intact: boolean): void;
  setDroneTravel(id: number, enabled: boolean): void;
  setDroneOscillation(id: number, enabled: boolean): void;
  setDroneFire(id: number, enabled: boolean): void;
  removeDrone(id: number): void;
  clearDrones(): void;

  addPlayerBullet(x: number, y: number, band: Band): void;
  addEnemyBullet(x: number, y: number, band: Band): void;
  setBulletVelocity(id: number, vx: number, vy: number): void;
  removeBullet(id: number): void;
  clearPlayerBullets(): void;
  clearEnemyBullets(): void;

  removeBurst(id: number): void;
  clearBursts(): void;
}

/**
 * The finite number the caller passed, at or above `floor`.
 *
 * AN OPERATION IS UNCONDITIONAL, and the floor is a bound
 * `specs/instrumentation.md` fixes as a constant — so it is the argument's DOMAIN
 * rather than an edge to snap to: a call outside it fails loudly rather than
 * being clamped into range, which would leave the state holding a value nobody
 * asked for.
 */
function atLeast(op: string, value: number, floor: number): number {
  if (!Number.isFinite(value) || value < floor) {
    throw new RangeError(
      `Spectra: ${op} needs a finite number at or above ${floor}, got ${String(value)}`,
    );
  }
  return value;
}

/** The finite number the caller passed, inside the closed range the specs fix. */
function inRange(op: string, value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value) || value < lo || value > hi) {
    throw new RangeError(
      `Spectra: ${op} needs a finite number in [${lo}, ${hi}], got ${String(value)}`,
    );
  }
  return value;
}

/** A finite, non-negative number of seconds; below zero is a caller error. */
function seconds(op: string, value: number): number {
  return atLeast(op, value, 0);
}

/** One entry of a roster by id, or a caller error naming the id. */
function requireId<T extends { id: number }>(
  op: string,
  roster: readonly T[],
  id: number,
): T {
  const found = roster.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new RangeError(`Spectra: ${op} names no live entry with id ${id}`);
  }
  return found;
}

/** The surface. Every member is one pose or one reading. */
export function createDebugApi(world: () => World): SpectraDebugApi {
  /** The live state, read at the call. */
  const read = (): SpectraState => spectraState(world());

  /**
   * Apply `change` to the drone with that id, or fail loudly naming the id.
   *
   * An id no live drone carries names no state to reach, so it THROWS where the
   * caller sees it rather than returning with the roster exactly as it was: a
   * pose that vanished would grade a check that never addressed the drone it
   * meant to as one that did.
   */
  const poseDrone = (
    op: string,
    id: number,
    change: (drone: DroneState, state: SpectraState) => void,
  ): void => {
    const state = read();
    const drone = droneById(state, id);
    if (drone === undefined) {
      throw new RangeError(`Spectra: ${op} names no live drone with id ${id}`);
    }
    change(drone, state);
  };

  /**
   * Apply `change` to the drone with that id, of that kind, or fail loudly.
   *
   * A band window belongs to a Flux and a shell to a Prism, so posing either on
   * a drone that has none names no state to reach.
   */
  const poseDroneOfKind = (
    op: string,
    id: number,
    kind: DroneKind,
    change: (drone: DroneState, state: SpectraState) => void,
  ): void => {
    poseDrone(op, id, (drone, state) => {
      if (drone.kind !== kind) {
        throw new RangeError(
          `Spectra: ${op} needs a ${kind}, and drone ${id} is a ${drone.kind}`,
        );
      }
      change(drone, state);
    });
  };

  return {
    version: SPECTRA_DEBUG_VERSION,

    reset(options) {
      resetToTitle(read(), options?.seed ?? DEFAULT_SEED);
    },

    /**
     * Bring every reported reading into agreement with the game as it stands.
     *
     * Every derived reading this build reports — `isChallenge`, the four
     * stage-scaled figures, `dischargeReady`, `inversionActive`, `ship.alive`,
     * every `effectiveBand`, a Flux's `shimmer` and a burst's `particles` — is
     * worked out at the READ, in `snapshot` below, from the stage, the resonance,
     * the inversion, the phase and the bands beside it. Nothing is held that a
     * pose can leave behind, so there is nothing here to rewrite and this body is
     * the answer rather than an omission.
     *
     * The operation is required of EVERY build, including one that keeps those
     * readings as stored copies and must rewrite them from their sources here.
     * This is what it comes to in a build that does not. It advances no clock,
     * runs no system, fires nothing, and corrects nothing.
     */
    reconcile() {},

    snapshot() {
      const state = read();
      const swapped = inverted(state.inversion);
      return {
        version: SPECTRA_DEBUG_VERSION,
        screen: state.screen,
        phase: state.phase,
        phaseTimer: state.phaseTimer,
        menuIndex: state.menuIndex,
        mode: "sortie",
        stage: state.stage,
        isChallenge: isChallengeStage(state.stage),
        score: state.score,
        lives: state.lives,
        extraLifeAwarded: state.extraLifeAwarded,
        challengeHits: state.challengeHits,
        resonance: state.resonance,
        dischargeReady: dischargeReady(state.resonance),
        inversion: state.inversion,
        inversionActive: swapped,
        muted: state.muted,
        waveEntry: state.waveEntry,
        diveLaunching: state.diveLaunching,
        stageClearing: state.stageClearing,
        diveClock: state.diveClock,
        diveGap: state.diveTarget,
        droneSpeedScale: droneSpeedScale(state.stage),
        bulletSpeedScale: bulletSpeedScale(state.stage),
        diveGapScale: diveGapScale(state.stage),
        fluxHold: fluxHold(state.stage),
        ship: {
          x: state.ship.x,
          band: state.ship.band,
          // Derived: the ship is gone exactly while the wave holds its ready
          // phase (`specs/progression.md`).
          alive: state.phase !== "ready",
          lockout: state.ship.lockout,
          cooldown: state.ship.cooldown,
          contact: state.ship.contact,
        },
        discharge: {
          active: state.discharge.active,
          radius: state.discharge.radius,
        },
        drones: state.drones.map((drone) => ({
          id: drone.id,
          kind: drone.kind,
          x: drone.x,
          y: drone.y,
          band: drone.band,
          effectiveBand: droneBand(drone, state.stage, swapped),
          phase: drone.phase,
          slotX: drone.slotX,
          slotY: drone.slotY,
          bandClock: drone.kind === "flux" ? drone.bandClock : 0,
          shimmer: isShimmering(drone, state.stage),
          shellAlive: drone.kind === "prism" ? drone.shellAlive : true,
          travel: drone.travel,
          oscillation: drone.oscillation,
          fire: drone.fire,
        })),
        bullets: state.bullets.map((bullet) => ({
          id: bullet.id,
          x: bullet.x,
          y: bullet.y,
          vx: bullet.vx,
          vy: bullet.vy,
          band: bullet.band,
          effectiveBand: bulletBand(bullet, swapped),
          friendly: bullet.friendly,
        })),
        bursts: state.bursts.map((burst) => ({
          id: burst.id,
          x: burst.x,
          y: burst.y,
          size: burst.size,
          elapsed: burst.elapsed,
          // Read off the burst's own simulation at the call.
          particles: burst.sim.liveCount,
        })),
        simTime: state.simTime,
      };
    },

    /**
     * A pure read of the hit region of item `index` on the menu the current screen
     * shows, in logical units. It changes nothing.
     *
     * Null on the four screens that show no menu, and null for an index the current
     * menu has no item at (`specs/instrumentation.md`). The region is the one
     * `src/menus.ts` lays out, which is the one `src/render.ts` draws the item in
     * and the one the pointer selects on.
     */
    menuItemRect(index) {
      return menuItemRect(read().screen, index);
    },

    // ---- The screen and the run ------------------------------------------

    setScreen(screen) {
      read().screen = screen;
    },

    setPhase(phase) {
      read().phase = phase;
    },

    setPhaseTimer(value) {
      read().phaseTimer = seconds("setPhaseTimer(seconds)", value);
    },

    setMenuIndex(n) {
      read().menuIndex = Math.round(atLeast("setMenuIndex(n)", n, 0));
    },

    // A pose is a precondition, so no extra life is granted here whatever
    // boundary the score is carried across, and the latch is left as it stands.
    setScore(n) {
      read().score = n;
    },

    setLives(n) {
      read().lives = Math.round(atLeast("setLives(n)", n, 0));
    },

    // The stage's four derived figures and `isChallenge` all follow this, and
    // nothing is spawned or cleared by setting it.
    setStage(n) {
      read().stage = Math.round(atLeast("setStage(n)", n, 1));
    },

    setExtraLifeAwarded(awarded) {
      read().extraLifeAwarded = awarded;
    },

    /**
     * Set the current challenge stage's tally of drones destroyed.
     *
     * It destroys nothing and pays nothing: it is the latch alone, and the
     * bonus belongs to the scoring path.
     */
    setChallengeHits(n) {
      read().challengeHits = Math.round(atLeast("setChallengeHits(n)", n, 0));
    },

    // ---- The world gates and the dive clock -------------------------------

    setWaveEntry(enabled) {
      read().waveEntry = enabled;
    },

    setDiveLaunching(enabled) {
      read().diveLaunching = enabled;
    },

    setStageClearing(enabled) {
      read().stageClearing = enabled;
    },

    setShipContact(enabled) {
      read().ship.contact = enabled;
    },

    setDiveClock(value) {
      read().diveClock = seconds("setDiveClock(seconds)", value);
    },

    setDiveGap(value) {
      read().diveTarget = seconds("setDiveGap(seconds)", value);
    },

    // ---- The ship and its cannon ------------------------------------------

    // The `x` it was GIVEN. The lane's bounds are the argument's domain rather
    // than an edge to snap to, so a value outside them fails loudly instead of
    // landing the ship somewhere nobody asked for.
    setShipX(x) {
      read().ship.x = inRange("setShipX(x)", x, SHIP_X_MIN, SHIP_X_MAX);
    },

    // The band the ship holds, and nothing else: no fire lockout is started,
    // because `setFireLockout` is what poses the lockout.
    setShipBand(band) {
      read().ship.band = band;
    },

    setFireLockout(value) {
      read().ship.lockout = seconds("setFireLockout(seconds)", value);
    },

    setFireCooldown(value) {
      read().ship.cooldown = seconds("setFireCooldown(seconds)", value);
    },

    // ---- Resonance and the inversion --------------------------------------

    setResonance(value) {
      read().resonance = inRange(
        "setResonance(value)",
        value,
        0,
        RESONANCE_MAX,
      );
    },

    setInversion(value) {
      read().inversion = seconds("setInversion(seconds)", value);
    },

    // ---- The drones -------------------------------------------------------

    addDrone(kind, x, y) {
      const state = read();
      state.drones.push({
        id: takeId(state),
        kind,
        x,
        y,
        band: "cyan",
        phase: "formation",
        phaseClock: 0,
        slotX: x,
        slotY: y,
        entryGroup: 0,
        bandClock: 0,
        shellAlive: true,
        shotsFired: 0,
        travel: true,
        oscillation: true,
        fire: true,
      });
    },

    setDronePosition(id, x, y) {
      poseDrone("setDronePosition", id, (drone) => {
        drone.x = x;
        drone.y = y;
      });
    },

    // The stored band, on every kind, and nothing else: the band clock stays
    // exactly where it stands.
    setDroneBand(id, band) {
      poseDrone("setDroneBand", id, (drone) => {
        drone.band = band;
      });
    },

    // A phase change starts that phase's own path from its beginning, however
    // the change came about (`specs/state.md`).
    setDronePhase(id, phase) {
      poseDrone("setDronePhase", id, (drone) => {
        drone.phase = phase;
        drone.phaseClock = 0;
        drone.shotsFired = 0;
      });
    },

    setDroneSlot(id, x, y) {
      poseDrone("setDroneSlot", id, (drone) => {
        drone.slotX = x;
        drone.slotY = y;
      });
    },

    // How far into the CURRENT band window the Flux is, and nothing else:
    // `shimmer` follows it and the stored band does not change.
    // The seconds it was HANDED, whatever `fluxWindow(stage)` is at the time: the
    // window is a live figure the stage moves, so it is a game rule rather than
    // this argument's domain, and a clock posed past the end of the window stays
    // where it was put until the oscillation reaches it.
    setDroneBandClock(id, value) {
      poseDroneOfKind("setDroneBandClock", id, "flux", (drone) => {
        drone.bandClock = seconds("setDroneBandClock(seconds)", value);
      });
    },

    setDroneShell(id, intact) {
      poseDroneOfKind("setDroneShell", id, "prism", (drone) => {
        drone.shellAlive = intact;
      });
    },

    setDroneTravel(id, enabled) {
      poseDrone("setDroneTravel", id, (drone) => {
        drone.travel = enabled;
      });
    },

    setDroneOscillation(id, enabled) {
      poseDrone("setDroneOscillation", id, (drone) => {
        drone.oscillation = enabled;
      });
    },

    setDroneFire(id, enabled) {
      poseDrone("setDroneFire", id, (drone) => {
        drone.fire = enabled;
      });
    },

    removeDrone(id) {
      const state = read();
      requireId("removeDrone", state.drones, id);
      state.drones = state.drones.filter((drone) => drone.id !== id);
    },

    clearDrones() {
      read().drones = [];
    },

    // ---- The bullets ------------------------------------------------------

    addPlayerBullet(x, y, band) {
      const state = read();
      state.bullets.push({
        id: takeId(state),
        x,
        y,
        vx: 0,
        vy: -PLAYER_BULLET_SPEED,
        band,
        friendly: true,
      });
    },

    addEnemyBullet(x, y, band) {
      const state = read();
      state.bullets.push({
        id: takeId(state),
        x,
        y,
        vx: 0,
        vy: ENEMY_BULLET_SPEED * bulletSpeedScale(state.stage),
        band,
        friendly: false,
      });
    },

    setBulletVelocity(id, vx, vy) {
      const bullet = requireId("setBulletVelocity", read().bullets, id);
      bullet.vx = vx;
      bullet.vy = vy;
    },

    removeBullet(id) {
      const state = read();
      requireId("removeBullet", state.bullets, id);
      state.bullets = state.bullets.filter((bullet) => bullet.id !== id);
    },

    clearPlayerBullets() {
      const state = read();
      state.bullets = state.bullets.filter((bullet) => !bullet.friendly);
    },

    clearEnemyBullets() {
      const state = read();
      state.bullets = state.bullets.filter((bullet) => bullet.friendly);
    },

    // ---- The bursts -------------------------------------------------------

    removeBurst(id) {
      const state = read();
      requireId("removeBurst", state.bursts, id);
      state.bursts = state.bursts.filter((burst) => burst.id !== id);
    },

    clearBursts() {
      read().bursts = [];
    },
  };
}
