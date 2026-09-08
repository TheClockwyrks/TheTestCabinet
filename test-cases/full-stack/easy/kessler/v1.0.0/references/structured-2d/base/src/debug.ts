// Kessler — the debug and automation surface (specs/instrumentation.md).
//
// The game instance's `initialize` returns the surface built here, the engine
// holds it as `engine.debug`, and that is the whole route to it: nothing is
// installed on the page. Every operation is imperative over the LIVE world,
// read off the engine at the moment of the call, so the surface follows the
// one world the game runs in. Each pose sets one thing through the same
// systems play uses and returns nothing; each reading returns plain data
// built at the call; no pose decides an outcome, and no pose sounds a cue —
// the cues a scenario hears come from the ticks run after it. An argument
// outside the domain its operation states fails loudly, except where the
// specification says the operation normalizes the call.
//
// NO OPERATION DECLINES. The screen showing, the entry highlighted, and where
// the deflector and the balls sit are how a PLAYER reaches a thing; they are
// not an operation's conditions, and nothing here inspects them before acting.
// A call the field has no state for — a launch with nothing parked, a second
// parked ball, a seventh ball where six is the whole capacity, a menu entry on
// a screen carrying no menu — throws, so a caller never reads a call that did
// nothing as a call that did. The one thing never done is refusing quietly.

import {
  BALL_CAP,
  DEFLECTOR_BALL_CONTACT_RADIUS,
  POD_KINDS,
  RINGS,
  SCREENS,
  type PodKind,
  type Screen,
} from "./constants";
import { FxActor } from "./actors";
import { ringSpeedForWave } from "./figures";
import { poseScreen, resetState } from "./flow";
import {
  menuEntries,
  menuItemRect as menuItemRectOf,
  type MenuItemRect,
} from "./menus";
import { kesslerState, type KesslerState } from "./state";
import { normalizeDeg, pointAt, polarOf } from "./polar";
import { launchParkedBall, rollPod, type PodPose } from "./sim";
import { spanOf, piercingNow } from "./session";
import type { World } from "@clockwyrks/structured-2d";

/** The snapshot `specs/instrumentation.md` fixes, as a plain object. */
export interface KesslerSnapshot {
  screen: Screen;
  ticks: number;
  wave: number;
  score: number;
  lives: number;
  interstitialTicks: number;
  waveAdvance: boolean;
  podSpawn: boolean;
  nextPod: PodPose;
  paddle: { angleDeg: number; spanDeg: number };
  balls: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    parked: boolean;
    piercing: boolean;
  }[];
  rings: {
    angleDeg: number;
    speedDegPerSec: number;
    targets: { slot: number; hp: number }[];
  }[];
  pods: { kind: string; x: number; y: number }[];
  effects: {
    widenTicks: number;
    narrowTicks: number;
    pierceTicks: number;
    shieldActive: boolean;
  };
  menu: { index: number };
}

/** The debug and automation surface, exactly as the specification lists it. */
export interface KesslerDebugApi {
  reset(): void;
  /** Bring every reported reading into agreement with the field as it stands. */
  reconcile(): void;
  snapshot(): KesslerSnapshot;
  menuItemRect(index: number): MenuItemRect | null;
  setScreen(name: Screen): void;
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
  setNextPod(kind: PodKind | "none"): void;
  drawPod(): PodKind | null;
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

/** A pure read of `state`, in the fixed shape. */
export function snapshotOf(state: KesslerState): KesslerSnapshot {
  const piercing = piercingNow(state);
  return {
    screen: state.screen,
    ticks: state.ticks,
    wave: state.wave,
    score: state.score,
    lives: state.lives,
    interstitialTicks: state.interstitialTicks,
    waveAdvance: state.waveAdvance,
    podSpawn: state.podSpawn,
    nextPod: state.nextPod,
    paddle: { angleDeg: state.paddleAngleDeg, spanDeg: spanOf(state) },
    balls: state.balls.map((ball) => ({
      x: ball.x,
      y: ball.y,
      vx: ball.vx,
      vy: ball.vy,
      parked: ball.parked,
      piercing,
    })),
    rings: state.rings.map((ring) => ({
      angleDeg: ring.angleDeg,
      speedDegPerSec: ring.speedDegPerSec,
      targets: ring.targets.flatMap((hp, slot) =>
        hp === null ? [] : [{ slot, hp }],
      ),
    })),
    pods: state.pods.map((pod) => {
      const at = pointAt(pod.r, pod.angleDeg);
      return { kind: pod.kind, x: at.x, y: at.y };
    }),
    effects: {
      widenTicks: state.effects.widenTicks,
      narrowTicks: state.effects.narrowTicks,
      pierceTicks: state.effects.pierceTicks,
      shieldActive: state.effects.shieldActive,
    },
    menu: { index: state.menuIndex },
  };
}

/**
 * Build the surface over `worldOf`, the accessor the game instance closes
 * over `this.engine`, so every operation reads the world live at its call.
 */
export function createDebugApi(worldOf: () => World): KesslerDebugApi {
  const stateOf = (): KesslerState => kesslerState(worldOf());
  return {
    reset() {
      resetState(stateOf());
      // A reset wants a bare field, live effects included.
      worldOf().find(FxActor)?.fx.clear();
    },

    /**
     * Bring every reported reading into agreement with the field as it stands.
     *
     * Every derived reading this build reports — the deflector's `spanDeg`,
     * each ball's `piercing`, each pod's `(x, y)`, and each ring's list of live
     * targets — is worked out at the read, in `snapshotOf` above, from the
     * effect timers, the pods' polar positions and the ring slots, so nothing is
     * held that a pose can leave behind and there is nothing here to rewrite.
     * The operation is required of every build, including one that keeps those
     * readings as stored copies, and this is what it comes to in a build that
     * does not.
     */
    reconcile() {},

    snapshot() {
      return snapshotOf(stateOf());
    },

    /**
     * A pure read of where the build drew menu entry `index` on the current
     * screen. `null` on a screen with no menu and past the menu's entries.
     */
    menuItemRect(index) {
      return menuItemRectOf(stateOf().screen, index);
    },

    /** Sets the screen, and changes nothing else. */
    setScreen(name) {
      if (!SCREENS.includes(name)) {
        throw new Error(`setScreen: unknown screen ${String(name)}`);
      }
      poseScreen(stateOf(), name);
    },

    setScore(n) {
      stateOf().score = mustWhole("setScore n", n, 0);
    },

    setLives(n) {
      stateOf().lives = mustWhole("setLives n", n, 0);
    },

    /**
     * Moves the highlight exactly as `up` and `down` move it, silently. A
     * screen with no menu has no entry to highlight, so off a menu the call
     * fails loudly.
     */
    setMenuIndex(n) {
      const state = stateOf();
      const entries = menuEntries(state.screen);
      if (entries === null) {
        throw new Error(
          `setMenuIndex: ${state.screen} carries no menu, so it has no entry to highlight`,
        );
      }
      const value = mustWhole("setMenuIndex n", n, 0);
      if (value >= entries.length) {
        throw new Error(
          `setMenuIndex n must be 0 to ${entries.length - 1}; got ${value}`,
        );
      }
      state.menuIndex = value;
    },

    /** Sets the interstitial timer; it counts down on `waveclear` alone. */
    setInterstitialTicks(ticks) {
      stateOf().interstitialTicks = mustWhole(
        "setInterstitialTicks ticks",
        ticks,
        0,
      );
    },

    setWave(n) {
      const state = stateOf();
      const wave = mustWhole("setWave n", n, 1);
      state.wave = wave;
      for (let index = 0; index < RINGS.length; index += 1) {
        state.rings[index].speedDegPerSec = ringSpeedForWave(
          RINGS[index],
          wave,
        );
      }
    },

    setPaddleAngle(deg) {
      const state = stateOf();
      state.paddleAngleDeg = normalizeDeg(mustFinite("deg", deg));
      const parked = state.balls.find((ball) => ball.parked);
      if (parked) {
        const at = pointAt(DEFLECTOR_BALL_CONTACT_RADIUS, state.paddleAngleDeg);
        parked.x = at.x;
        parked.y = at.y;
      }
    },

    launchBall() {
      const state = stateOf();
      if (!state.balls.some((ball) => ball.parked)) {
        throw new Error(
          "launchBall: no ball is parked, so there is none to serve",
        );
      }
      launchParkedBall(state);
    },

    clearBalls() {
      stateOf().balls = [];
    },

    spawnBall(x, y, vx, vy) {
      mustFinite("x", x);
      mustFinite("y", y);
      mustFinite("vx", vx);
      mustFinite("vy", vy);
      const state = stateOf();
      if (state.balls.length >= BALL_CAP) {
        throw new Error(
          `spawnBall: the field holds ${BALL_CAP} balls at most and holds that many now`,
        );
      }
      state.nextId += 1;
      state.balls.push({
        id: state.nextId,
        x,
        y,
        vx,
        vy,
        parked: false,
        spawnTick: state.simTicks,
      });
    },

    parkBall() {
      const state = stateOf();
      if (state.balls.some((ball) => ball.parked)) {
        throw new Error(
          "parkBall: a ball is already parked, and only one may be",
        );
      }
      if (state.balls.length >= BALL_CAP) {
        throw new Error(
          `parkBall: the field holds ${BALL_CAP} balls at most and holds that many now`,
        );
      }
      const at = pointAt(DEFLECTOR_BALL_CONTACT_RADIUS, state.paddleAngleDeg);
      state.nextId += 1;
      state.balls.push({
        id: state.nextId,
        x: at.x,
        y: at.y,
        vx: 0,
        vy: 0,
        parked: true,
        spawnTick: state.simTicks,
      });
    },

    clearTargets() {
      for (const ring of stateOf().rings) {
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
      stateOf().rings[index].targets[slotValue] = mustWhole("hp", hp, 1);
    },

    setRingAngle(ring, deg) {
      const index = mustRingIndex(ring);
      stateOf().rings[index].angleDeg = normalizeDeg(mustFinite("deg", deg));
    },

    setRingSpeed(ring, degPerSec) {
      const index = mustRingIndex(ring);
      stateOf().rings[index].speedDegPerSec = mustFinite(
        "degPerSec",
        degPerSec,
      );
    },

    clearPods() {
      stateOf().pods = [];
    },

    spawnPod(kind, x, y) {
      if (!POD_KINDS.includes(kind)) {
        throw new Error(`spawnPod: unknown kind ${String(kind)}`);
      }
      const state = stateOf();
      const at = polarOf(mustFinite("x", x), mustFinite("y", y));
      state.nextId += 1;
      state.pods.push({
        id: state.nextId,
        kind,
        r: at.r,
        angleDeg: at.angleDeg,
      });
    },

    /** Poses the outcome the next pod draw sheds: a kind, or `none`. */
    setNextPod(kind) {
      if (kind !== "none" && !POD_KINDS.includes(kind)) {
        throw new Error(`setNextPod: unknown kind ${String(kind)}`);
      }
      stateOf().nextPod = kind;
    },

    /**
     * One pod draw alone: the random outcome a destruction would draw, with
     * nothing spawned and the posed outcome left where it stands.
     */
    drawPod() {
      return rollPod(Math.random);
    },

    setEffectTicks(kind, ticks) {
      if (kind !== "widen" && kind !== "narrow" && kind !== "pierce") {
        throw new Error(`setEffectTicks: unknown kind ${String(kind)}`);
      }
      const value = mustWhole("ticks", ticks, 0);
      const effects = stateOf().effects;
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
      stateOf().effects.shieldActive = mustBoolean("active", active);
    },

    setWaveAdvance(on) {
      stateOf().waveAdvance = mustBoolean("on", on);
    },

    setPodSpawn(on) {
      stateOf().podSpawn = mustBoolean("on", on);
    },
  };
}
