// Kessler — the debug and automation surface, as types. CASE-PROVIDED.
//
// This file is the ONLY description of the surface this project holds, and it
// is declared from `specs/instrumentation.md` rather than imported from
// anything a build wrote. A check that reached into the build's own module for
// the shape of the thing it is grading would grade the build against itself,
// and would pass a build whose surface disagreed with the specification as
// long as it disagreed consistently. The build declares its own
// `KesslerDebugApi` in `src/game.ts`; nothing here imports it, and the harness
// reaches the object itself through `engine.debug` alone.
//
// WHERE THE SURFACE LIVES. There is no page handle: `specs/instrumentation.md`
// states that the game instance's `initialize` returns the finished surface,
// the engine holds it, and it is reached through `engine.debug` alone —
// nothing is installed on the page. So under this engine the "handle" is
// `engine.debug`, and the harness reads it off the engine it constructed.
//
// HOW THE SURFACE IS DRIVEN. Directly. Every operation is a method that takes
// only the parameters its own heading names: a POSE arranges the running game
// through the same systems play uses and returns nothing
// (`setPaddleAngle(180)`), and a READING takes no parameters and returns plain
// data built at the call (`snapshot()`). The harness's `h.debug` IS this
// object rather than a driver over it.
//
// There is NO clock operation and NO key operation here, and that is
// deliberate rather than an omission: the engine owns the frame loop and the
// keyboard, so a check steps the game with `engine.advance` under a
// `ConstantClock(1000 / 60)` — one frame, one tick — and dispatches
// keyboard-shaped events at the surface's own listener.

/** Every screen the state machine moves between. The game opens on `title`. */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "waveclear"
  | "paused"
  | "gameover";

/** The five salvage pod kinds, as `specs/pods.md` names them. */
export type PodKind = "widen" | "narrow" | "multiball" | "shield" | "pierce";

/** What `setNextPod` poses for the next draw: a kind, `none`, or nothing. */
export type PodPose = PodKind | "none" | null;

/** The three TIMED effects `setEffectTicks` takes. Shield is its own pose. */
export type EffectKind = "widen" | "narrow" | "pierce";

/**
 * Every operation the surface carries, in the order
 * `specs/instrumentation.md` states them, so a build's surface can be read
 * against the file that specifies it without hunting.
 */
export const REQUIRED_OPS = [
  "reset",
  "reconcile",
  "snapshot",
  "menuItemRect",
  "setScreen",
  "setScore",
  "setLives",
  "setMenuIndex",
  "setInterstitialTicks",
  "setWave",
  "setPaddleAngle",
  "launchBall",
  "clearBalls",
  "spawnBall",
  "parkBall",
  "clearTargets",
  "spawnTarget",
  "setRingAngle",
  "setRingSpeed",
  "clearPods",
  "spawnPod",
  "setNextPod",
  "drawPod",
  "setEffectTicks",
  "setShield",
  "setWaveAdvance",
  "setPodSpawn",
] as const;

/** The name of one operation the surface carries. */
export type OperationName = (typeof REQUIRED_OPS)[number];

/**
 * The operations that READ the running game rather than pose it. The shape
 * alone cannot say at runtime which members return a value, so the
 * specification names them.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/**
 * The hit region `menuItemRect` reports, in the stage's logical units, with
 * `(x, y)` the region's top-left corner.
 */
export interface MenuItemRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One live ball, the parked ball included, as the snapshot reports it. */
export interface SnapshotBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  parked: boolean;
  piercing: boolean;
}

/** One live target: the slot it occupies and the hit points it has left. */
export interface SnapshotTarget {
  slot: number;
  hp: number;
}

/** One ring: its angle, its orbital speed, and its live targets by slot. */
export interface SnapshotRing {
  angleDeg: number;
  speedDegPerSec: number;
  targets: SnapshotTarget[];
}

/** One falling pod, in spawn order. */
export interface SnapshotPod {
  kind: PodKind;
  x: number;
  y: number;
}

/** The effect timers, in whole ticks; `0` is not in force. */
export interface SnapshotEffects {
  widenTicks: number;
  narrowTicks: number;
  pierceTicks: number;
  shieldActive: boolean;
}

/**
 * The plain object `snapshot()` returns, field for field as
 * `specs/instrumentation.md` states it.
 *
 * The shape is fixed and every field is present on every screen. `balls` and
 * `pods` run in spawn order, oldest first. `rings` always holds three
 * entries, ring 1 (the innermost) first, and a slot with no `targets` entry
 * holds no target. `paddle.angleDeg` and every ring's `angleDeg` are
 * normalized into `[0, 360)`.
 */
export interface KesslerSnapshot {
  screen: Screen;
  /** Ticks resolved since the last reset; frozen screens still count them. */
  ticks: number;
  wave: number;
  score: number;
  lives: number;
  /** Ticks left of the interstitial; counts down on `waveclear` alone. */
  interstitialTicks: number;
  /** Driver switch: whether the clearing event fires. */
  waveAdvance: boolean;
  /** Driver switch: whether a destruction makes the pod draw. */
  podSpawn: boolean;
  /** The outcome `setNextPod` posed for the next draw; `null` once consumed. */
  nextPod: PodPose;
  paddle: { angleDeg: number; spanDeg: number };
  balls: SnapshotBall[];
  rings: [SnapshotRing, SnapshotRing, SnapshotRing];
  pods: SnapshotPod[];
  effects: SnapshotEffects;
  /** The highlighted item, `0` on a screen with no menu. */
  menu: { index: number };
}

/**
 * The surface the game instance's `initialize` returns, which the engine
 * hands back from `engine.debug`.
 *
 * Each pose sets ONE thing on the live game through the same systems play
 * uses and leaves the rest as it stands; no pose decides an outcome — every
 * bounce, hit, destruction, catch, burn-up, life loss, and clearing comes
 * from the ticks run after the pose. Kessler runs in one level for the whole
 * session and every screen is a value of the state's screen field, so a pose
 * that changes the screen takes effect at the call. A pose changes the state
 * alone and sounds nothing; the cues a scenario hears come from the ticks run
 * after it. An argument outside its stated domain fails loudly, except where
 * an operation states that it normalizes the call.
 *
 * No operation declines. The screen showing, the entry
 * highlighted, and where the deflector and the balls sit are how a PLAYER
 * reaches a thing and are not an operation's conditions, so an operation acts
 * from wherever the game stands; a call the field has no state for — a launch
 * with nothing parked, a second parked ball, a seventh ball where six is the
 * whole capacity, a menu entry on a screen carrying no menu — fails loudly
 * rather than passing quietly.
 */
export interface KesslerDebugApi {
  /**
   * Restores the boot state: `title` with `menu.index` `0`, score `0`, `3`
   * lives, wave `1`, `ticks` `0`, the deflector at angle `90` span `48`,
   * every ring slot filled at full hit points with every ring angle `0` and
   * wave-1 speeds, no balls, no pods, no timed effect, no shield, both
   * driver switches on, the interstitial timer at `0`, and no posed pod
   * outcome.
   */
  reset(): void;

  /**
   * Brings every value the surface reports into agreement with the field as it
   * stands, without advancing anything. A build that works its derived
   * readings out at the read has nothing to do; one that keeps any of them as
   * a stored copy rewrites that copy from its source.
   */
  reconcile(): void;

  /** A pure read of the state; changes nothing. */
  snapshot(): KesslerSnapshot;

  /**
   * Where the build drew menu entry `index` on the current screen, or `null`
   * off a menu and for an `index` outside the menu's entries. It changes
   * nothing.
   */
  menuItemRect(index: number): MenuItemRect | null;

  /**
   * Sets `screen` to `name` and changes nothing else: the score, the lives,
   * the wave, the deflector, the balls, the rings, the pods, the timed
   * effects, the shield, the interstitial timer, the menu highlight, and
   * both driver switches all stand exactly as they stood. No cue sounds at
   * the call.
   */
  setScreen(name: Screen): void;

  /** Sets the score to `n`, a whole number of at least `0`. */
  setScore(n: number): void;
  /** Sets the lives to `n`, a whole number of at least `0`. */
  setLives(n: number): void;
  /**
   * Sets the highlighted menu entry to `n`, a whole number from `0` to the
   * current screen's entry count minus `1`. No cue sounds; off a menu the
   * call fails loudly.
   */
  setMenuIndex(n: number): void;
  /** Sets the interstitial timer to `ticks`, a whole number of at least `0`. */
  setInterstitialTicks(ticks: number): void;

  /**
   * Sets the wave counter to `n` (whole, at least `1`) and puts the wave-`n`
   * figures in force: ring speeds from the wave formulas (overwriting any
   * `setRingSpeed`) and the wave-`n` ball speed for serves, launches, and
   * paddle bounces. Rings keep targets and angles; balls keep their velocity.
   */
  setWave(n: number): void;

  /**
   * Sets the deflector's center angle to `deg`, normalized into `[0, 360)`.
   * A parked ball follows it; the span is untouched.
   */
  setPaddleAngle(deg: number): void;

  /**
   * Acts exactly as `Space` on a parked ball: it launches radially outward
   * at the current wave's ball speed. With no parked ball, fails loudly.
   */
  launchBall(): void;

  /** Removes every ball, parked included. No burn-up, cue, or particle. */
  clearBalls(): void;

  /**
   * Adds one unparked ball at `(x, y)` with velocity `(vx, vy)`, appended in
   * spawn order, piercing exactly when `pierceTicks > 0` at the call. At the
   * 6-ball cap, fails loudly.
   */
  spawnBall(x: number, y: number, vx: number, vy: number): void;

  /**
   * Parks one ball on the deflector at the serve position, following it
   * until launched. While a parked ball exists, or at the cap, fails
   * loudly.
   */
  parkBall(): void;

  /**
   * Removes every target from all three rings. Not a destruction and not a
   * clearing: nothing scores, no draw, no cue, and the screen stays.
   */
  clearTargets(): void;

  /**
   * Places a target with `hp` (whole, at least `1`) in slot `slot` of ring
   * `ring` (`1` to `3`; `slot` `0` to the ring's slot count minus `1`),
   * replacing whatever the slot holds.
   */
  spawnTarget(ring: number, slot: number, hp: number): void;

  /** Sets ring `ring`'s angle to `deg`, normalized into `[0, 360)`. */
  setRingAngle(ring: number, deg: number): void;

  /**
   * Sets ring `ring`'s orbital speed to `degPerSec`, signed as
   * `specs/rings.md` signs it, holding until the next `setWave` or wave
   * transition restores the formula.
   */
  setRingSpeed(ring: number, degPerSec: number): void;

  /** Removes every falling pod. No catch, burn, score, cue, or effect. */
  clearPods(): void;

  /**
   * Adds one pod of `kind` at `(x, y)`, falling radially inward at the fixed
   * fall speed; catching or burning resolves as for a drawn pod. No draw is
   * made.
   */
  spawnPod(kind: PodKind, x: number, y: number): void;

  /**
   * Poses the outcome of the next pod draw: a kind, or `none`. The next
   * destruction that makes a draw sheds it in place of the random outcome and
   * consumes the pose.
   */
  setNextPod(kind: PodKind | "none"): void;

  /**
   * Performs one pod draw alone and returns its outcome, a kind name or
   * `null`; nothing spawns and nothing else changes.
   */
  drawPod(): PodKind | null;

  /**
   * Sets the timer of timed effect `kind` to `ticks` (whole, at least `0`).
   * Above `0` puts the effect in force exactly as catching its pod would
   * (span change and widen/narrow mutual cancel included; no catch score);
   * `0` ends it and restores the baseline exactly as expiry does.
   */
  setEffectTicks(kind: EffectKind, ticks: number): void;

  /**
   * `true` raises the shield ring exactly as catching a shield pod does,
   * `false` removes it. Neither scores; a raised shield is consumed by its
   * first reflection.
   */
  setShield(active: boolean): void;

  /** Driver switch: whether the clearing event fires. On after `reset`. */
  setWaveAdvance(on: boolean): void;
  /** Driver switch: whether a destruction draws a pod. On after `reset`. */
  setPodSpawn(on: boolean): void;
}
