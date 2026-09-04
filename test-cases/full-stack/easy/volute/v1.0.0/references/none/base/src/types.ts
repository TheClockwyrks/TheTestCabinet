// Volute — the game's whole state (specs/state.md).
//
// One value carries the game: the frame loop advances it, the renderer reads it,
// and the debug surface reads and poses it. Nothing the game carries from one
// tick to the next lives anywhere else. Loaded images, decoded audio, and live
// particle players are the one exception — they are not game state, and the
// renderer holds them.
//
// The state is held BY REFERENCE and mutated in place, because this build owns
// its own loop and there is no engine holding it by value. What that costs is
// discipline: `render`, `snapshot`, and every diagnostic source take it as a
// read-only view, so nothing but a tick or a pose can move the game.

import type { ChargeId, MachineryKind, ScreenName } from "./constants";

/** One core standing on the channel. */
export interface Core {
  /** The charge it carries. */
  charge: ChargeId;
  /** Its arc position, the distance from the inlet walked along the channel. */
  s: number;
  /** The machinery extracting it grants, or `null` on an unmarked core. */
  mark: MachineryKind | null;
  /**
   * The seconds of recoil hold this core stands under.
   *
   * The specification carries the hold on the SEGMENT; a segment's boundaries,
   * though, follow from the spacing and so change under every insertion,
   * extraction and merge. Holding it per core and reading a segment's hold off
   * its head is the same rule with nothing to keep in step: a merge takes the
   * hold of the segment ahead because the merged segment's head IS that
   * segment's head, and {@link import("./train").resegment} normalizes the rest.
   */
  hold: number;
}

/** One segment: a maximal run of cores exactly one spacing apart. */
export interface Segment {
  /** How many consecutive cores of the train it covers, at least `1`. */
  count: number;
  /** The seconds of recoil hold it has left; `0` on a segment that advances. */
  hold: number;
}

/** One core in flight, between the injector and what it meets. */
export interface Projectile {
  /** The charge it carries and seats. */
  charge: ChargeId;
  /** Its center, in logical units. */
  x: number;
  y: number;
  /** The heading it was fired along, in degrees, in `[0, 360)`. */
  angle: number;
}

/** The timed machinery in force. */
export interface Machinery {
  /** `choke`, `backflow`, or `sightline`; `bore` resolves at once. */
  kind: MachineryKind;
  /** The seconds it has left, counting down to `0`. */
  remaining: number;
}

/** The whole of Volute's state. */
export interface VoluteState {
  /** The screen the game is showing. */
  screen: ScreenName;

  /** The run's score. */
  score: number;
  /** The level in play, from `1` to `LEVEL_COUNT`. */
  level: number;
  /** The cells remaining, from `CELLS` down to `0`. */
  cells: number;
  /** How many more cores the inlet emits this level. */
  quotaRemaining: number;

  /** The pressure, from `PRESSURE_MIN` to `PRESSURE_MAX`. */
  pressure: number;
  /** The chain step an extraction scores at, at least `1`. */
  chainStep: number;
  /** The seconds left before the chain step returns to `1`. */
  chainTimer: number;
  /** The timed machinery in force, or `null` when none is. */
  machinery: Machinery | null;

  /** The train, head first, so arc positions descend along it. */
  cores: Core[];
  /** The train's segments, the lead segment first; the counts partition `cores`. */
  segments: Segment[];
  /** The projectiles in flight, oldest first. */
  projectiles: Projectile[];

  /** The charge the injector fires next; `null` while no level is open. */
  loaded: ChargeId | null;
  /** The charge that becomes `loaded` on the next firing. */
  queued: ChargeId | null;
  /** The direction the injector points, in degrees, in `[0, 360)`. */
  aim: number;
  /** The seconds until the injector may fire again. */
  fireCooldown: number;

  /** The seconds left of the interlude `cleared` and `setback` hold. */
  interlude: number;
  /** The simulation time the run has accumulated, in seconds. */
  simTime: number;
  /** The frame time waiting for the next whole tick, in `[0, TICK_DT)`. */
  accumulator: number;
  /** Whether the simulation advances on its own each frame. */
  autoStep: boolean;
  /**
   * Whether the inlet emits, and whether the train advances.
   *
   * Both hold in play, and neither is restored by a `reset` or a level opening:
   * they are the debug surface's two faculty gates, and they belong to the
   * caller driving the game rather than to the run being played.
   */
  emission: boolean;
  feed: boolean;
  /** The game's readable copy of the runtime's mute bit. */
  muted: boolean;
  /** The state of the seeded generator every random draw comes from. */
  rngState: number;
}

/**
 * A deeply read-only view of a value.
 *
 * What `render`, `snapshot`, and every diagnostic source are handed. The type is
 * the guarantee that drawing changes nothing and that nothing but a tick or a
 * pose advances the game.
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** The game as everything that only reads it sees it. */
export type ReadonlyState = DeepReadonly<VoluteState>;
