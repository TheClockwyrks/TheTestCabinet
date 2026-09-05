// Volute — the hall's game state (specs/state.md).
//
// The game's state lives in the framework objects the engine owns. Volute maps
// onto them like this:
//
//   * The game INSTANCE (`src/game.ts`) carries only what must survive a level
//     transition: the seeded generator's whole state, the origin the reported
//     simulation time is measured from, and the run a pending transition is
//     opening with.
//   * The open world's GAME STATE — this class — carries the run: the screen,
//     the score, the level, the cells, the quota, the pressure, the chain, the
//     machinery in force, the interlude, and the ORDER of the train and the
//     projectiles.
//   * The ACTORS carry the bodies: each core its charge, arc position, mark and
//     recoil hold (`src/actors.ts`), each projectile its charge and heading, and
//     the injector its aim, cooldown, and loaded and queued charges.
//
// Both levels build this same state, so the title screen holds exactly the
// title-screen values `specs/state.md` fixes — score `0`, level `1`, `CELLS`
// cells, level 1's full quota still to emit, pressure `0`, chain step `1`, no
// machinery, an empty channel — as its field initializers, and every debug pose
// works the same whichever level is open.

import { GameState } from "@clockwyrks/structured-2d";
import { CELLS, LEVELS } from "./constants";
import type { MachineryKind, ScreenName } from "./constants";
import type { Core, Projectile } from "./actors";

/** The timed machinery in force. */
export interface Machinery {
  /** `choke`, `backflow`, or `sightline`; `bore` resolves at once. */
  kind: MachineryKind;
  /** The seconds it has left, counting down to `0`. */
  remaining: number;
}

/** One segment: a maximal run of cores exactly one spacing apart. */
export interface Segment {
  /** How many consecutive cores of the train it covers, at least `1`. */
  count: number;
  /** The seconds of recoil hold it has left; `0` on a segment that advances. */
  hold: number;
}

/** The run, as the open world holds it. */
export class HallState extends GameState {
  /** The screen the game is showing. */
  screen: ScreenName = "title";

  /** The run's score. */
  score = 0;
  /** The level in play, from `1` to `LEVEL_COUNT`. */
  level = 1;
  /** The cells remaining, from `CELLS` down to `0`. */
  cells: number = CELLS;
  /** How many more cores the inlet emits this level. */
  quotaRemaining: number = LEVELS[0].quota;

  /** The pressure, from `PRESSURE_MIN` to `PRESSURE_MAX`. */
  pressure = 0;
  /** The chain step an extraction scores at, at least `1`. */
  chainStep = 1;
  /** The seconds left before the chain step returns to `1`. */
  chainTimer = 0;
  /** The timed machinery in force, or `null` when none is. */
  machinery: Machinery | null = null;

  /** The train, head first, so arc positions descend along it. */
  cores: Core[] = [];
  /** The train's segments, the lead segment first; the counts partition `cores`. */
  segments: Segment[] = [];
  /** The projectiles in flight, oldest first. */
  projectiles: Projectile[] = [];

  /** The seconds left of the interlude `cleared` and `setback` hold. */
  interlude = 0;
}

/**
 * Whether the screen advances the simulation at all (specs/ui.md, "What
 * advances on each screen").
 *
 * The interludes advance their own timer and nothing else, and the title, the
 * pause, and the two endings advance nothing — so a paused hall is drawn
 * exactly as the tick that paused it left it, the effects over it included.
 */
export function advancesSimulation(screen: ScreenName): boolean {
  return screen === "playing" || screen === "cleared" || screen === "setback";
}
