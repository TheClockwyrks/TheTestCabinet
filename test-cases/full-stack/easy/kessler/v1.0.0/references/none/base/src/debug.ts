// Kessler — the state half of `window.__kessler` (specs/instrumentation.md).
//
// Every operation here is a read of the game's state or a pose of one part of
// it: each pose sets one thing and leaves the rest as it stands, no pose
// decides an outcome, and no pose sounds a cue. An argument outside the
// domain its operation states fails loudly, except where the specification
// says the operation normalizes the call.
//
// NO OPERATION DECLINES. The screen showing, the entry highlighted, and where
// the deflector and the balls sit are how a PLAYER reaches a thing; they are
// not an operation's conditions, and nothing here inspects them before acting.
// A call the field has no state for — a launch with nothing parked, a second
// parked ball, a seventh ball where six is the whole capacity, a menu entry on
// a screen carrying no menu — throws, so a caller never reads a call that did
// nothing as a call that did. The one thing never done is refusing quietly.
// The two clock
// operations, `setAutoStep` and `step`, belong to the runtime's frame loop;
// it spreads these operations and adds its own two when it installs the
// surface.

import {
  BALL_CAP,
  PADDLE_CONTACT_RADIUS,
  POD_KINDS,
  RINGS,
  SCREENS,
  type PodKind,
  type ScreenName,
} from "./constants";
import type { Game, Snapshot } from "./game";
import type { MenuItemRect } from "./menus";
import { normalizeDeg, pointAt, polarOf } from "./polar";
import { launchParkedBall } from "./sim";

/** The reads and poses of the debug surface, minus the runtime's clock pair. */
export interface KesslerStateOps {
  reset(seed?: number): void;
  /** Bring every reported reading into agreement with the field as it stands. */
  reconcile(): void;
  snapshot(): Snapshot;
  menuItemRect(index: number): MenuItemRect | null;
  setScreen(name: ScreenName): void;
  setScore(n: number): void;
  setLives(n: number): void;
  setMenuIndex(n: number): void;
  setInterstitialTicks(ticks: number): void;
  setWave(n: number): void;
  setPaddleAngle(deg: number): void;
  launchBall(): void;
  clearBalls(): void;
  spawnBall(x: number, y: number, vx: number, vy: number): void;
  parkBall(): void;
  clearTargets(): void;
  spawnTarget(ring: number, slot: number, hp: number): void;
  setRingAngle(ring: number, deg: number): void;
  setRingSpeed(ring: number, degPerSec: number): void;
  clearPods(): void;
  spawnPod(kind: PodKind, x: number, y: number): void;
  setEffectTicks(kind: "widen" | "narrow" | "pierce", ticks: number): void;
  setShield(active: boolean): void;
  setWaveAdvance(on: boolean): void;
  setPodSpawn(on: boolean): void;
}

function mustWhole(name: string, value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(
      `${name} must be a whole number of at least ${min}; got ${String(value)}`,
    );
  }
  return value;
}

function mustFinite(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number; got ${String(value)}`);
  }
  return value;
}

function mustBoolean(name: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean; got ${String(value)}`);
  }
  return value;
}

function mustRingIndex(ring: unknown): number {
  const value = mustWhole("ring", ring, 1);
  if (value > RINGS.length) {
    throw new Error(`ring must be 1 to ${RINGS.length}; got ${value}`);
  }
  return value - 1;
}

/** Builds the state operations over `game`. */
export function createStateOps(game: Game): KesslerStateOps {
  return {
    reset(seed) {
      game.reset(seed === undefined ? undefined : mustWhole("seed", seed, 0));
    },

    /**
     * Bring every reported reading into agreement with the field as it stands.
     *
     * Every derived reading this build reports — the deflector's `spanDeg`,
     * each ball's `piercing`, each pod's `(x, y)`, and each ring's list of live
     * targets — is worked out at the read, in `Game.snapshot`, from the effect
     * timers, the pods' polar positions and the ring slots, so nothing is held
     * that a pose can leave behind and there is nothing here to rewrite. The
     * operation is required of every build, including one that keeps those
     * readings as stored copies, and this is what it comes to in a build that
     * does not.
     */
    reconcile() {},

    snapshot() {
      return game.snapshot();
    },

    menuItemRect(index) {
      return game.menuItemRect(index);
    },

    setScreen(name) {
      if (!SCREENS.includes(name)) {
        throw new Error(`setScreen: unknown screen ${String(name)}`);
      }
      game.poseScreen(name);
    },

    setScore(n) {
      game.session.score = mustWhole("setScore n", n, 0);
    },

    setLives(n) {
      game.session.lives = mustWhole("setLives n", n, 0);
    },

    setMenuIndex(n) {
      game.poseMenuIndex(n);
    },

    setInterstitialTicks(ticks) {
      game.interstitialTicks = mustWhole(
        "setInterstitialTicks ticks",
        ticks,
        0,
      );
    },

    setWave(n) {
      const wave = mustWhole("setWave n", n, 1);
      game.session.wave = wave;
      for (let index = 0; index < RINGS.length; index += 1) {
        game.session.rings[index].speedDegPerSec =
          RINGS[index].speedForWave(wave);
      }
    },

    setPaddleAngle(deg) {
      game.session.paddleAngleDeg = normalizeDeg(mustFinite("deg", deg));
      const parked = game.session.balls.find((ball) => ball.parked);
      if (parked) {
        const at = pointAt(PADDLE_CONTACT_RADIUS, game.session.paddleAngleDeg);
        parked.x = at.x;
        parked.y = at.y;
      }
    },

    launchBall() {
      if (!game.session.balls.some((ball) => ball.parked)) {
        throw new Error(
          "launchBall: no ball is parked, so there is none to serve",
        );
      }
      launchParkedBall(game.session);
    },

    clearBalls() {
      game.session.balls = [];
    },

    spawnBall(x, y, vx, vy) {
      mustFinite("x", x);
      mustFinite("y", y);
      mustFinite("vx", vx);
      mustFinite("vy", vy);
      if (game.session.balls.length >= BALL_CAP) {
        throw new Error(
          `spawnBall: the field holds ${BALL_CAP} balls at most and holds that many now`,
        );
      }
      game.session.balls.push({
        x,
        y,
        vx,
        vy,
        parked: false,
        spawnTick: game.simTicks,
      });
    },

    parkBall() {
      const session = game.session;
      if (session.balls.some((ball) => ball.parked)) {
        throw new Error(
          "parkBall: a ball is already parked, and only one may be",
        );
      }
      if (session.balls.length >= BALL_CAP) {
        throw new Error(
          `parkBall: the field holds ${BALL_CAP} balls at most and holds that many now`,
        );
      }
      const at = pointAt(PADDLE_CONTACT_RADIUS, session.paddleAngleDeg);
      session.balls.push({
        x: at.x,
        y: at.y,
        vx: 0,
        vy: 0,
        parked: true,
        spawnTick: game.simTicks,
      });
    },

    clearTargets() {
      for (const ring of game.session.rings) {
        ring.targets = ring.targets.map(() => null);
      }
    },

    spawnTarget(ring, slot, hp) {
      const index = mustRingIndex(ring);
      const slots = RINGS[index].slots;
      const slotValue = mustWhole("slot", slot, 0);
      if (slotValue >= slots) {
        throw new Error(`slot must be 0 to ${slots - 1}; got ${slotValue}`);
      }
      game.session.rings[index].targets[slotValue] = mustWhole("hp", hp, 1);
    },

    setRingAngle(ring, deg) {
      const index = mustRingIndex(ring);
      game.session.rings[index].angleDeg = normalizeDeg(mustFinite("deg", deg));
    },

    setRingSpeed(ring, degPerSec) {
      const index = mustRingIndex(ring);
      game.session.rings[index].speedDegPerSec = mustFinite(
        "degPerSec",
        degPerSec,
      );
    },

    clearPods() {
      game.session.pods = [];
    },

    spawnPod(kind, x, y) {
      if (!POD_KINDS.includes(kind)) {
        throw new Error(`spawnPod: unknown kind ${String(kind)}`);
      }
      const at = polarOf(mustFinite("x", x), mustFinite("y", y));
      game.session.pods.push({
        kind,
        r: at.r,
        angleDeg: at.angleDeg,
        spawnTick: game.simTicks,
      });
    },

    setEffectTicks(kind, ticks) {
      if (kind !== "widen" && kind !== "narrow" && kind !== "pierce") {
        throw new Error(`setEffectTicks: unknown kind ${String(kind)}`);
      }
      const value = mustWhole("ticks", ticks, 0);
      const effects = game.session.effects;
      if (kind === "pierce") {
        effects.pierceTicks = value;
        return;
      }
      if (value === 0) {
        if (kind === "widen") effects.widenTicks = 0;
        else effects.narrowTicks = 0;
        return;
      }
      // A span effect above zero enters force exactly as its catch would,
      // with the same mutual cancel between widen and narrow.
      if (kind === "widen") {
        effects.widenTicks = value;
        effects.narrowTicks = 0;
      } else {
        effects.narrowTicks = value;
        effects.widenTicks = 0;
      }
    },

    setShield(active) {
      game.session.effects.shieldActive = mustBoolean("active", active);
    },

    setWaveAdvance(on) {
      game.waveAdvance = mustBoolean("on", on);
    },

    setPodSpawn(on) {
      game.podSpawn = mustBoolean("on", on);
    },
  };
}
