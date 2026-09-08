// Kessler — the debugging and automation surface (specs/instrumentation.md).
//
// `createDebugApi()` builds it, `initialize` returns it beside the state it
// built as `[state, createDebugApi()]`, and the engine hands that same object
// back from `engine.debug` — the one way a caller reaches it. It holds no
// state, reaches nothing global, and is inert during normal play: nothing
// below runs until something calls it.
//
// Every operation is written in the shape of `update`. A POSE takes the
// current state and returns the next — `setScore(state, 500)` — and a caller
// drives it through `engine.apply((s) => debug.setScore(s, 500))`; a READING
// takes the state and returns what it read — `debug.snapshot(engine.state)`.
// A pose sets ONE thing and leaves the rest of the game as it stands, no pose
// decides an outcome, and no pose sounds a cue; the game's own tick, paddle
// motion, ring orbits, reflections, pod draws, and scoring run from there
// exactly as they do in play. An argument outside the domain its operation
// states fails loudly, except where the specification says the operation
// normalizes the call.
//
// NO OPERATION DECLINES. The screen showing, the entry highlighted, and where
// the deflector and the balls sit are how a PLAYER reaches a thing; they are
// not an operation's conditions, and nothing here inspects them before acting.
// A call the field has no state for — a launch with nothing parked, a second
// parked ball, a seventh ball where six is the whole capacity, a menu entry on
// a screen carrying no menu — throws, so a caller never reads a call that did
// nothing as a call that did. The one thing never done is refusing quietly.
//
// There is no clock operation and no key operation, because the engine owns
// both: a caller steps the game with `engine.advance` under a clock of its
// own, and dispatches a keyboard event at the engine's own listener. There is
// no overlay operation either, for the same reason.

import {
  BALL_CAP,
  PADDLE_CONTACT_RADIUS,
  POD_KINDS,
  RINGS,
  SCREENS,
  type PodKind,
  type ScreenName,
} from "./figures";
import {
  cloneState,
  poseScreenDraft,
  resetState,
  type KesslerState,
  type View,
} from "./flow";
import {
  menuEntries,
  menuItemRect as menuItemRectOf,
  type MenuItemRect,
} from "./menus";
import { normalizeDeg, pointAt, polarOf } from "./polar";
import { launchParkedBall, rollPod, type PodPose } from "./sim";
import { piercingNow, spanOf } from "./state";

/** The plain, JSON-serializable read `snapshot` returns. */
export interface KesslerSnapshot {
  screen: ScreenName;
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

/** The reads and poses of the debug surface. */
export interface KesslerDebugApi {
  reset(state: View): KesslerState;
  /** Bring every reported reading into agreement with the field as it stands. */
  reconcile(state: View): KesslerState;
  snapshot(state: View): KesslerSnapshot;
  menuItemRect(state: View, index: number): MenuItemRect | null;
  setScreen(state: View, name: ScreenName): KesslerState;
  setScore(state: View, n: number): KesslerState;
  setLives(state: View, n: number): KesslerState;
  setMenuIndex(state: View, n: number): KesslerState;
  setInterstitialTicks(state: View, ticks: number): KesslerState;
  setWave(state: View, n: number): KesslerState;
  setPaddleAngle(state: View, deg: number): KesslerState;
  launchBall(state: View): KesslerState;
  clearBalls(state: View): KesslerState;
  spawnBall(
    state: View,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): KesslerState;
  parkBall(state: View): KesslerState;
  clearTargets(state: View): KesslerState;
  spawnTarget(
    state: View,
    ring: number,
    slot: number,
    hp: number,
  ): KesslerState;
  setRingAngle(state: View, ring: number, deg: number): KesslerState;
  setRingSpeed(state: View, ring: number, degPerSec: number): KesslerState;
  clearPods(state: View): KesslerState;
  spawnPod(state: View, kind: PodKind, x: number, y: number): KesslerState;
  setNextPod(state: View, kind: PodKind | "none"): KesslerState;
  drawPod(state: View): PodKind | null;
  setEffectTicks(
    state: View,
    kind: "widen" | "narrow" | "pierce",
    ticks: number,
  ): KesslerState;
  setShield(state: View, active: boolean): KesslerState;
  setWaveAdvance(state: View, on: boolean): KesslerState;
  setPodSpawn(state: View, on: boolean): KesslerState;
}

// ---- Argument checking ---------------------------------------------------

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

// ---- Building the surface ------------------------------------------------

/** Build the surface. It holds nothing: every operation is handed its state. */
export function createDebugApi(): KesslerDebugApi {
  return {
    /**
     * The boot state (`specs/instrumentation.md`): the title screen over the
     * boot layout, zero ticks, both driver switches on, and no posed pod
     * outcome.
     */
    reset(state) {
      return resetState(state);
    },

    /**
     * Bring every reported reading into agreement with the field as it stands.
     *
     * Every derived reading this build reports — the deflector's `spanDeg`,
     * each ball's `piercing`, each pod's `(x, y)`, and each ring's list of live
     * targets — is worked out at the read, in `snapshot` below, from the effect
     * timers, the pods' polar positions and the ring slots, so nothing is held
     * that a pose can leave behind and there is nothing here to rewrite. The
     * state that comes back equals the one that was handed in. The operation is
     * required of every build, including one that keeps those readings as
     * stored copies, and this is what it comes to in a build that does not.
     */
    reconcile(state) {
      return cloneState(state);
    },

    /** A pure read of the state. It poses nothing, so it returns no state. */
    snapshot(state) {
      const session = state.session;
      const piercing = piercingNow(session);
      return {
        screen: state.screen,
        ticks: state.ticks,
        wave: session.wave,
        score: session.score,
        lives: session.lives,
        interstitialTicks: state.interstitialTicks,
        waveAdvance: state.waveAdvance,
        podSpawn: state.podSpawn,
        nextPod: state.nextPod,
        paddle: { angleDeg: session.paddleAngleDeg, spanDeg: spanOf(session) },
        balls: session.balls.map((ball) => ({
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy,
          parked: ball.parked,
          piercing,
        })),
        rings: session.rings.map((ring) => ({
          angleDeg: ring.angleDeg,
          speedDegPerSec: ring.speedDegPerSec,
          targets: ring.targets.flatMap((hp, slot) =>
            hp === null ? [] : [{ slot, hp }],
          ),
        })),
        pods: session.pods.map((pod) => {
          const at = pointAt(pod.r, pod.angleDeg);
          return { kind: pod.kind, x: at.x, y: at.y };
        }),
        effects: {
          widenTicks: session.effects.widenTicks,
          narrowTicks: session.effects.narrowTicks,
          pierceTicks: session.effects.pierceTicks,
          shieldActive: session.effects.shieldActive,
        },
        menu: { index: state.menuIndex },
      };
    },

    /**
     * A pure read of where the build drew menu entry `index` on the current
     * screen. `null` on a screen with no menu and past the menu's entries.
     */
    menuItemRect(state, index) {
      return menuItemRectOf(state.screen, index);
    },

    /** Sets the screen, and changes nothing else. */
    setScreen(state, name) {
      if (!SCREENS.includes(name)) {
        throw new Error(`setScreen: unknown screen ${String(name)}`);
      }
      const draft = cloneState(state);
      poseScreenDraft(draft, name);
      return draft;
    },

    setScore(state, n) {
      const value = mustWhole("setScore n", n, 0);
      const draft = cloneState(state);
      draft.session.score = value;
      return draft;
    },

    setLives(state, n) {
      const value = mustWhole("setLives n", n, 0);
      const draft = cloneState(state);
      draft.session.lives = value;
      return draft;
    },

    /**
     * Moves the highlight exactly as `up` and `down` move it, silently. A
     * screen with no menu has no entry to highlight, so off a menu the call
     * fails loudly.
     */
    setMenuIndex(state, n) {
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
      const draft = cloneState(state);
      draft.menuIndex = value;
      return draft;
    },

    /** Sets the interstitial timer; it counts down on `waveclear` alone. */
    setInterstitialTicks(state, ticks) {
      const value = mustWhole("setInterstitialTicks ticks", ticks, 0);
      const draft = cloneState(state);
      draft.interstitialTicks = value;
      return draft;
    },

    /**
     * Sets the wave counter and puts the wave figures in force: the ring
     * speeds from the wave formulas, overwriting any `setRingSpeed`, and the
     * ball speed a serve, a launch, and a paddle bounce use.
     */
    setWave(state, n) {
      const wave = mustWhole("setWave n", n, 1);
      const draft = cloneState(state);
      draft.session.wave = wave;
      for (let index = 0; index < RINGS.length; index += 1) {
        draft.session.rings[index].speedDegPerSec =
          RINGS[index].speedForWave(wave);
      }
      return draft;
    },

    /** Normalizes into `[0, 360)`; a parked ball follows to the new angle. */
    setPaddleAngle(state, deg) {
      const value = normalizeDeg(mustFinite("deg", deg));
      const draft = cloneState(state);
      draft.session.paddleAngleDeg = value;
      const parked = draft.session.balls.find((ball) => ball.parked);
      if (parked) {
        const at = pointAt(PADDLE_CONTACT_RADIUS, value);
        parked.x = at.x;
        parked.y = at.y;
      }
      return draft;
    },

    /** Acts exactly as `Space` does; with no parked ball, fails loudly. */
    launchBall(state) {
      if (!state.session.balls.some((ball) => ball.parked)) {
        throw new Error(
          "launchBall: no ball is parked, so there is none to serve",
        );
      }
      const draft = cloneState(state);
      launchParkedBall(draft.session);
      return draft;
    },

    clearBalls(state) {
      const draft = cloneState(state);
      draft.session.balls = [];
      return draft;
    },

    /** Appends one unparked ball in spawn order; at the cap, fails loudly. */
    spawnBall(state, x, y, vx, vy) {
      mustFinite("x", x);
      mustFinite("y", y);
      mustFinite("vx", vx);
      mustFinite("vy", vy);
      if (state.session.balls.length >= BALL_CAP) {
        throw new Error(
          `spawnBall: the field holds ${BALL_CAP} balls at most and holds that many now`,
        );
      }
      const draft = cloneState(state);
      draft.session.balls.push({
        x,
        y,
        vx,
        vy,
        parked: false,
        spawnTick: draft.simTicks,
      });
      return draft;
    },

    /** Parks one ball; while one is parked, or at the cap, fails loudly. */
    parkBall(state) {
      if (state.session.balls.some((ball) => ball.parked)) {
        throw new Error(
          "parkBall: a ball is already parked, and only one may be",
        );
      }
      if (state.session.balls.length >= BALL_CAP) {
        throw new Error(
          `parkBall: the field holds ${BALL_CAP} balls at most and holds that many now`,
        );
      }
      const draft = cloneState(state);
      const session = draft.session;
      const at = pointAt(PADDLE_CONTACT_RADIUS, session.paddleAngleDeg);
      session.balls.push({
        x: at.x,
        y: at.y,
        vx: 0,
        vy: 0,
        parked: true,
        spawnTick: draft.simTicks,
      });
      return draft;
    },

    /** Not a destruction and not a clearing: nothing scores or sounds. */
    clearTargets(state) {
      const draft = cloneState(state);
      for (const ring of draft.session.rings) {
        ring.targets = ring.targets.map(() => null);
      }
      return draft;
    },

    spawnTarget(state, ring, slot, hp) {
      const index = mustRingIndex(ring);
      const slots = RINGS[index].slots;
      const slotValue = mustWhole("slot", slot, 0);
      if (slotValue >= slots) {
        throw new Error(`slot must be 0 to ${slots - 1}; got ${slotValue}`);
      }
      const points = mustWhole("hp", hp, 1);
      const draft = cloneState(state);
      draft.session.rings[index].targets[slotValue] = points;
      return draft;
    },

    setRingAngle(state, ring, deg) {
      const index = mustRingIndex(ring);
      const value = normalizeDeg(mustFinite("deg", deg));
      const draft = cloneState(state);
      draft.session.rings[index].angleDeg = value;
      return draft;
    },

    setRingSpeed(state, ring, degPerSec) {
      const index = mustRingIndex(ring);
      const value = mustFinite("degPerSec", degPerSec);
      const draft = cloneState(state);
      draft.session.rings[index].speedDegPerSec = value;
      return draft;
    },

    clearPods(state) {
      const draft = cloneState(state);
      draft.session.pods = [];
      return draft;
    },

    /** No draw is made, so a posed outcome stays where it stands. */
    spawnPod(state, kind, x, y) {
      if (!POD_KINDS.includes(kind)) {
        throw new Error(`spawnPod: unknown kind ${String(kind)}`);
      }
      const at = polarOf(mustFinite("x", x), mustFinite("y", y));
      const draft = cloneState(state);
      draft.session.pods.push({
        kind,
        r: at.r,
        angleDeg: at.angleDeg,
        spawnTick: draft.simTicks,
      });
      return draft;
    },

    /** Poses the outcome the next pod draw sheds: a kind, or `none`. */
    setNextPod(state, kind) {
      if (kind !== "none" && !POD_KINDS.includes(kind)) {
        throw new Error(`setNextPod: unknown kind ${String(kind)}`);
      }
      const draft = cloneState(state);
      draft.nextPod = kind;
      return draft;
    },

    /**
     * One pod draw alone: the random outcome a destruction would draw, with
     * nothing spawned and the posed outcome left where it stands. A reading,
     * so it returns what it drew rather than a state.
     */
    drawPod() {
      return rollPod(Math.random);
    },

    setEffectTicks(state, kind, ticks) {
      if (kind !== "widen" && kind !== "narrow" && kind !== "pierce") {
        throw new Error(`setEffectTicks: unknown kind ${String(kind)}`);
      }
      const value = mustWhole("ticks", ticks, 0);
      const draft = cloneState(state);
      const effects = draft.session.effects;
      if (kind === "pierce") {
        effects.pierceTicks = value;
        return draft;
      }
      if (value === 0) {
        if (kind === "widen") effects.widenTicks = 0;
        else effects.narrowTicks = 0;
        return draft;
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
      return draft;
    },

    setShield(state, active) {
      const value = mustBoolean("active", active);
      const draft = cloneState(state);
      draft.session.effects.shieldActive = value;
      return draft;
    },

    setWaveAdvance(state, on) {
      const value = mustBoolean("on", on);
      const draft = cloneState(state);
      draft.waveAdvance = value;
      return draft;
    },

    setPodSpawn(state, on) {
      const value = mustBoolean("on", on);
      const draft = cloneState(state);
      draft.podSpawn = value;
      return draft;
    },
  };
}
