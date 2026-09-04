// Spectra — the debugging and automation surface, `window.__spectra`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS A READ, A POSE OF ONE FIELD, OR A MOVE OF THE CLOCK. That is
// the whole design. A pose ARRANGES THE FIELD and never fabricates an outcome: it
// puts the game into a situation, and the game's own update — the real sub-step, the
// real contact test, the real band comparison, the real charge, the real scoring —
// is what runs from there. So a scenario driven from code behaves exactly like one
// played by hand, and every pose is verifiable by setting a value and reading it
// back off `snapshot`.
//
// THE TWO CLOCK OPERATIONS REACH PAST THE STATE, into the runtime, because this
// build stands on no engine and nothing outside it owns its clock. Without them a
// scenario could only be driven by waiting, and a check that waits measures the
// machine it ran on.
//
// WHAT IS DELIBERATELY ABSENT, and why:
//
//   * no `keyDown`, `keyUp` or `press` — the runtime's registered actions are driven
//     by dispatching real key events at the page, which is the path a player's
//     keyboard takes;
//   * no overlay toggle — the runtime draws the panel and owns the backtick key;
//   * no `setMuted` — mute is the runtime's own bit, reached the way a player
//     reaches it through `KeyM`, and the snapshot reports the result;
//   * nothing that flips, fires, discharges or overloads — each of those is an
//     OUTCOME the items grade, so a caller poses the precondition and drives the
//     real action.

import { droneEffectiveBand, bulletEffectiveBand } from "./bands";
import { burstParticles } from "./bursts";
import {
  DEFAULT_SEED,
  OVERLOAD_AT,
  RESONANCE_MAX,
  SPECTRA_DEBUG_VERSION,
  SPECTRA_HANDLE,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  fluxWindow,
  isChallengeStage,
} from "./constants";
import { shimmering } from "./drones";
import {
  addDrone,
  addEnemyBullet,
  addPlayerBullet,
  findBullet,
  findDrone,
  removeBulletById,
  removeDroneById,
} from "./entities";
import { clampShipX } from "./field";
import { resetState } from "./game";
import { menuItemRect, type MenuRect } from "./menus";
import { dischargeReady } from "./resonance";
import { poseScore } from "./scoring";
import { shipAlive } from "./progression";
import type {
  Band,
  DroneKind,
  DronePhase,
  Phase,
  Screen,
  SpectraState,
} from "./types";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
}

/** One drone, as the snapshot reports it. */
export interface DroneSnapshot {
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
  charge: number;
}

/** One bullet, as the snapshot reports it. */
export interface BulletSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: Band;
  effectiveBand: Band;
  friendly: boolean;
}

/** One drone-burst, as the snapshot reports it. */
export interface BurstSnapshot {
  id: number;
  x: number;
  y: number;
  size: number;
  elapsed: number;
  particles: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface SpectraSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  mode: "overload";
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
  diveClock: number;
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
  drones: DroneSnapshot[];
  bullets: BulletSnapshot[];
  bursts: BurstSnapshot[];
  simTime: number;
}

/** Every operation the surface carries. */
export interface SpectraDebugApi {
  version: number;

  // The clock.
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  // The core.
  reset(options?: { seed?: number }): void;
  snapshot(): SpectraSnapshot;
  menuItemRect(index: number): MenuRect | null;

  // The screen and the run.
  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setStage(stage: number): void;
  setExtraLifeAwarded(awarded: boolean): void;
  setChallengeHits(hits: number): void;

  // The world gates and the dive clock.
  setWaveEntry(enabled: boolean): void;
  setDiveLaunching(enabled: boolean): void;
  setShipContact(enabled: boolean): void;
  setDiveClock(seconds: number): void;

  // The ship and its cannon.
  setShipX(x: number): void;
  setShipBand(band: Band): void;
  setFireLockout(seconds: number): void;
  setFireCooldown(seconds: number): void;

  // Resonance and the inversion.
  setResonance(value: number): void;
  setInversion(seconds: number): void;

  // The drones.
  addDrone(kind: DroneKind, x: number, y: number): void;
  setDronePosition(id: number, x: number, y: number): void;
  setDroneBand(id: number, band: Band): void;
  setDronePhase(id: number, phase: DronePhase): void;
  setDroneSlot(id: number, x: number, y: number): void;
  setDroneBandClock(id: number, seconds: number): void;
  setDroneShell(id: number, intact: boolean): void;
  setDroneCharge(id: number, charge: number): void;
  setDroneTravel(id: number, enabled: boolean): void;
  setDroneOscillation(id: number, enabled: boolean): void;
  setDroneFire(id: number, enabled: boolean): void;
  removeDrone(id: number): void;
  clearDrones(): void;

  // The bullets.
  addPlayerBullet(x: number, y: number, band: Band): void;
  addEnemyBullet(x: number, y: number, band: Band): void;
  setBulletVelocity(id: number, vx: number, vy: number): void;
  removeBullet(id: number): void;
  clearPlayerBullets(): void;
  clearEnemyBullets(): void;

  // The bursts.
  removeBurst(id: number): void;
  clearBursts(): void;
}

/** A pure read of the whole state, exactly as `specs/instrumentation.md` shapes it. */
export function snapshotOf(state: SpectraState): SpectraSnapshot {
  const inverted = state.inversion > 0;
  return {
    version: SPECTRA_DEBUG_VERSION,
    screen: state.screen,
    phase: state.phase,
    phaseTimer: state.phaseTimer,
    menuIndex: state.menuIndex,
    mode: "overload",
    stage: state.stage,
    // Derived from the stage, so it follows `setStage`.
    isChallenge: isChallengeStage(state.stage),
    score: state.score,
    lives: state.lives,
    extraLifeAwarded: state.extraLifeAwarded,
    challengeHits: state.challengeHits,
    resonance: state.resonance,
    dischargeReady: dischargeReady(state),
    inversion: state.inversion,
    inversionActive: inverted,
    muted: state.muted,
    waveEntry: state.waveEntry,
    diveLaunching: state.diveLaunching,
    diveClock: state.diveClock,
    droneSpeedScale: droneSpeedScale(state.stage),
    bulletSpeedScale: bulletSpeedScale(state.stage),
    diveGapScale: diveGapScale(state.stage),
    fluxHold: fluxHold(state.stage),
    ship: {
      x: state.ship.x,
      band: state.ship.band,
      alive: shipAlive(state),
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
      effectiveBand: droneEffectiveBand(drone, inverted, state.stage),
      phase: drone.phase,
      slotX: drone.slotX,
      slotY: drone.slotY,
      bandClock: drone.kind === "flux" ? drone.bandClock : 0,
      shimmer: shimmering(drone, state.stage),
      shellAlive: drone.kind === "prism" ? drone.shellAlive : true,
      travel: drone.travel,
      oscillation: drone.oscillation,
      fire: drone.fire,
      charge: drone.charge,
    })),
    bullets: state.bullets.map((bullet) => ({
      id: bullet.id,
      x: bullet.x,
      y: bullet.y,
      vx: bullet.vx,
      vy: bullet.vy,
      band: bullet.band,
      effectiveBand: bulletEffectiveBand(bullet, inverted),
      friendly: bullet.friendly,
    })),
    bursts: state.bursts.map((burst) => ({
      id: burst.id,
      x: burst.x,
      y: burst.y,
      size: burst.size,
      elapsed: burst.elapsed,
      particles: burstParticles(burst),
    })),
    simTime: state.simTime,
  };
}

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: SpectraState,
  clock: DebugClock,
): SpectraDebugApi {
  const drone = (id: number) => findDrone(state, id);

  return {
    version: SPECTRA_DEBUG_VERSION,

    /**
     * Take the game off real time, and give it back.
     *
     * Drawing is unaffected either way: the loop keeps rendering, so the canvas
     * shows the state the most recent frame left. It changes no game state, which
     * is why there is no `autoStep` field in the snapshot to read back.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order.
     *
     * Each is a real frame — the same update the loop runs, then a render — and each
     * frame divides into whole sub-steps of at most `SUBSTEP_MAX`, so `advance(1,
     * 1)` and `advance(1, 60)` cover the same second and reach the same state.
     *
     * Advancing while the game is still stepping itself ADDS to what the wall clock
     * is already doing, so call `setAutoStep(false)` first.
     */
    advance(seconds, frames = 1) {
      clock.advance(seconds, frames);
    },

    /**
     * Restore every declared field to its title-screen value and reseed the game's
     * randomness.
     *
     * It does not touch the clock, and it leaves `muted` exactly as it stands.
     */
    reset(options) {
      resetState(state, options?.seed ?? DEFAULT_SEED);
    },

    snapshot() {
      return snapshotOf(state);
    },

    /**
     * A pure read of the hit region of item `index` on the menu the current screen
     * shows, in logical units. It changes nothing.
     *
     * Null on the four screens that show no menu, and null for an index the current
     * menu has no item at (`specs/instrumentation.md`). The region is the one
     * `src/menus.ts` lays out, which is the one the renderer draws the item's plate
     * at and the one the pointer selects on.
     */
    menuItemRect(index) {
      return menuItemRect(state.screen, index);
    },

    setScreen(screen) {
      state.screen = screen;
    },

    setPhase(phase) {
      state.phase = phase;
    },

    setPhaseTimer(seconds) {
      state.phaseTimer = seconds;
    },

    setMenuIndex(index) {
      state.menuIndex = index;
    },

    /**
     * Set the score directly.
     *
     * It grants no extra life, whatever boundary it carries the score across: the
     * award belongs to the scoring path, and this is a precondition. It leaves the
     * latch exactly as it stands, so posing the score down and back up does not
     * re-arm the award.
     */
    setScore(score) {
      poseScore(state, score);
    },

    setLives(lives) {
      state.lives = lives;
    },

    /**
     * Set the stage being played.
     *
     * It spawns nothing and clears nothing. The stage's four derived figures and
     * `isChallenge` all follow it, because each is derived at the call.
     */
    setStage(stage) {
      state.stage = Math.max(1, Math.round(stage));
    },

    setExtraLifeAwarded(awarded) {
      state.extraLifeAwarded = Boolean(awarded);
    },

    /**
     * Set the current challenge stage's tally of drones destroyed.
     *
     * It destroys nothing and pays nothing: it is the latch alone, and the
     * bonus belongs to the scoring path.
     */
    setChallengeHits(hits) {
      state.challengeHits = Math.max(0, Math.round(hits));
    },

    setWaveEntry(enabled) {
      state.waveEntry = Boolean(enabled);
    },

    setDiveLaunching(enabled) {
      state.diveLaunching = Boolean(enabled);
    },

    setShipContact(enabled) {
      state.ship.contact = Boolean(enabled);
    },

    /** Set the wave's own dive timer. It launches nothing itself. */
    setDiveClock(seconds) {
      state.diveClock = Math.max(0, seconds);
    },

    /** Place the ship's centre; the lane's own clamp still applies. */
    setShipX(x) {
      state.ship.x = clampShipX(x);
    },

    /**
     * Set the band the ship holds.
     *
     * It starts no fire lockout: `setFireLockout` is what poses the lockout.
     */
    setShipBand(band) {
      state.ship.band = band;
    },

    setFireLockout(seconds) {
      state.ship.lockout = Math.max(0, seconds);
    },

    setFireCooldown(seconds) {
      state.ship.cooldown = Math.max(0, seconds);
    },

    /** Set the meter. `dischargeReady` follows it. */
    setResonance(value) {
      state.resonance = Math.max(0, Math.min(RESONANCE_MAX, value));
    },

    /** Set the seconds of inversion left. `inversionActive` follows it. */
    setInversion(seconds) {
      state.inversion = Math.max(0, seconds);
    },

    /**
     * Add one drone of `kind` with its centre at a logical stage position.
     *
     * Appended to the roster with a fresh id: band `cyan`, phase `formation`, its
     * slot the position it was placed at, band clock `0`, shell intact, charge `0`,
     * and all three faculties on. It is not one of a stage's wave, so destroying it
     * clears no stage.
     */
    addDrone(kind, x, y) {
      addDrone(state, { kind, x, y });
    },

    setDronePosition(id, x, y) {
      const target = drone(id);
      if (target === undefined) return;
      target.x = x;
      target.y = y;
    },

    /**
     * Set the drone's stored band, on every kind.
     *
     * It moves the band and nothing else: `bandClock` stays exactly where it stands.
     */
    setDroneBand(id, band) {
      const target = drone(id);
      if (target !== undefined) target.band = band;
    },

    /**
     * Set the phase.
     *
     * A drone posed into `diving` flies the dive its own path code builds, which is
     * how every scenario but one reaches a dive; the one whose requirement IS the
     * launch turns `diveLaunching` on instead.
     */
    setDronePhase(id, phase) {
      const target = drone(id);
      if (target === undefined) return;
      target.phase = phase;
      target.phaseTime = 0;
      target.pathDist = 0;
      target.path = null;
      if (phase === "diving") {
        target.diveShots = 0;
        target.fireArmed = false;
        target.invertedThisDive = false;
        target.plunge = false;
      }
    },

    setDroneSlot(id, x, y) {
      const target = drone(id);
      if (target === undefined) return;
      target.slotX = x;
      target.slotY = y;
    },

    /**
     * Set how far a Flux is into its current band window.
     *
     * It moves the clock and nothing else: `shimmer` follows it, and `band` does not
     * change.
     */
    setDroneBandClock(id, seconds) {
      const target = drone(id);
      if (target === undefined) return;
      target.bandClock = Math.max(
        0,
        Math.min(fluxWindow(state.stage), seconds),
      );
    },

    setDroneShell(id, intact) {
      const target = drone(id);
      if (target !== undefined) target.shellAlive = Boolean(intact);
    },

    /** Set the charge a mismatched shot feeds, from `0` to `OVERLOAD_AT`. */
    setDroneCharge(id, charge) {
      const target = drone(id);
      if (target === undefined) return;
      target.charge = Math.max(0, Math.min(OVERLOAD_AT, Math.round(charge)));
    },

    setDroneTravel(id, enabled) {
      const target = drone(id);
      if (target !== undefined) target.travel = Boolean(enabled);
    },

    setDroneOscillation(id, enabled) {
      const target = drone(id);
      if (target !== undefined) target.oscillation = Boolean(enabled);
    },

    setDroneFire(id, enabled) {
      const target = drone(id);
      if (target !== undefined) target.fire = Boolean(enabled);
    },

    removeDrone(id) {
      removeDroneById(state, id);
    },

    /** Remove every drone, leaving the bullets and bursts standing. */
    clearDrones() {
      state.drones = [];
    },

    addPlayerBullet(x, y, band) {
      addPlayerBullet(state, x, y, band);
    },

    addEnemyBullet(x, y, band) {
      addEnemyBullet(state, x, y, band);
    },

    setBulletVelocity(id, vx, vy) {
      const target = findBullet(state, id);
      if (target === undefined) return;
      target.vx = vx;
      target.vy = vy;
    },

    removeBullet(id) {
      removeBulletById(state, id);
    },

    clearPlayerBullets() {
      state.bullets = state.bullets.filter((bullet) => !bullet.friendly);
    },

    clearEnemyBullets() {
      state.bullets = state.bullets.filter((bullet) => bullet.friendly);
    },

    removeBurst(id) {
      state.bursts = state.bursts.filter((burst) => burst.id !== id);
    },

    clearBursts() {
      state.bursts = [];
    },
  };
}

/**
 * Install the surface on `window.__spectra` and return the function that removes it
 * again, while the installed object is still the one this call published.
 */
export function installDebugApi(
  state: SpectraState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[SPECTRA_HANDLE] = api;
  return () => {
    if (target[SPECTRA_HANDLE] === api) delete target[SPECTRA_HANDLE];
  };
}
