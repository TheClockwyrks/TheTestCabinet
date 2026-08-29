// den/schedule.ts — what the two den checks share.
//
// Both items read the SAME clock: `specs/predators.md`'s staggered release, whose
// times are `0 s`, `DEN_RELEASE_GAP` and `2 * DEN_RELEASE_GAP` "measured from the
// moment live play begins". So both need the same three things, and they live
// here rather than being written twice: the board the schedule is watched on, a
// watch that dates each predator's release, and the tolerance the two items
// state.
//
// THE SCHEDULE IS READ OFF `released`, NEVER OFF `state` OR A TILE.
// `specs/predators.md` is explicit: "`DEN_RELEASE_GAP` is the spacing between
// release times, not between arrivals in the corridor. `released` is the schedule
// itself, and `state` leaving `"den"` is the swim that follows it." The chamber is
// several tiles wide and neither the specification nor a fixture fixes which tile
// a hunter waits on, so timing the stagger from the moment a hunter clears the
// gate charges every gap the difference between two swims: a build releasing
// exactly `5 s` apart from tiles one and three would report gaps of four and six.
//
// THE BOARD IS POSED, AND THE HUNTERS CANNOT REACH THE FORAGER. These are the two
// points in this suite whose subject is a roster rather than one creature, so
// {@link poseDenSchedule} poses a fixture carrying a den chamber and then calls
// `setDepth`, which "lays the roster out in the den with every `released` flag
// false, exactly as a maze at that depth lays it out"
// (`specs/instrumentation.md`). The chamber is walled on every side but its gate
// and rock above that, and the forager's own corridor is a separate room across
// solid rock, so the most expensive thing that can happen to either measurement —
// the forager caught, which re-dens every hunter and starts the schedule again —
// cannot happen by accident. `den/re-release` stages that catch itself, on
// purpose, by posing a hunter onto the forager's own tile.
//
// AND THE ORIGIN IS PINNED, NOT GUESSED. `specs/ui.md` lets the dive countdown
// hold anywhere between `1 s` and `3 s`, so a schedule timed from the countdown's
// start would be reading a length the specification deliberately left the build.
// `setScreen("playing")` runs no tick and "the staggered release schedule takes
// its origin from the moment `screen` becomes `"playing"`"
// (`specs/instrumentation.md`), so the `simTime` read straight after that call is
// release time `0` exactly.

import { DEN_ORDER, DEN_RELEASE_GAP } from "../../src/constants";
import { placeForager, poseMaze } from "../fixtures";
import { Harness } from "../harness";
import { FathomSnapshot } from "../surface";
import { Tile } from "../maze";

/**
 * How far a measured release may sit from the time the schedule gives it, in
 * seconds.
 *
 * Both items state it: "within a tenth of a second". The watch below resolves an
 * event to its own poll, which is {@link WATCH_POLL} ticks — a sixtieth of a
 * second — so all but a sixth of this band is room for the build.
 */
export const RELEASE_TOLERANCE = 0.1;

/** How often the den is read, in ticks: a sixtieth of a second. */
export const WATCH_POLL = 2;

/** How long after its due time a release is still waited for, in seconds. */
export const RELEASE_GRACE = 3;

/** One predator's release: which hunter, where on the roster, and when. */
export interface Release {
  kind: string;
  index: number;
  /** The snapshot's `simTime` at the first sample that saw `released` true. */
  t: number;
}

/** What {@link watchReleases} found. */
export interface DenWatch {
  /** The releases seen, in the order they arrived. */
  releases: Release[];
  /** A predator whose `released` is not a boolean, named, or `null`. */
  missingFlag: string | null;
  /** The last state the watch read. */
  last: FathomSnapshot;
}

/**
 * The fixture both items watch the den on.
 *
 * A short corridor for the forager, and two rows of rock below it a den chamber:
 * three den tiles with the gate above the middle one and rock on the gate's other
 * three sides, which is the shape `specs/maze.md` gives a laid-out board's den.
 * Nothing joins the two rooms, so a hunter whose turn has come cannot cross to
 * the forager however long the watch runs.
 */
const BOARD = ["F.......", "", "", "     g", "    ddd"];

/** The depth whose roster the schedule is read on: one of each kind. */
const DEPTH = 1;

/**
 * Pose the board, the roster and the forager, and hand back the forager's tile.
 *
 * Left on the TITLE screen: `reset` opens there and nothing here makes the screen
 * become `"playing"`, because that instant is release time `0` and each item pins
 * it itself.
 */
export async function poseDenSchedule(h: Harness, seed: number): Promise<Tile> {
  h.debug.reset({ seed });
  const board = await poseMaze(h, BOARD);
  // The roster this point is about, laid out in the chamber the fixture carries.
  h.debug.setDepth(DEPTH);
  const home = board.mark("F");
  // Faced into the rock above a corridor one tile wide, so the forager holds the
  // tile it was put on for the whole watch (`specs/movement.md`).
  await placeForager(h, home, "up");
  return home;
}

/**
 * Watch the den for `seconds` of simulated time, dating each predator's release.
 *
 * Stops early once `count` releases are in. `count` is the roster's length rather
 * than a constant, so a build whose depth-`1` roster is not the three
 * `specs/predators.md` gives is reported by the roster's own item instead of
 * stalling this watch.
 *
 * The watch runs on {@link Harness.advance}, so a section captured around it is a
 * recording of the den emptying, which is exactly the evidence both items owe a
 * reviewer.
 */
export async function watchReleases(
  h: Harness,
  options: { seconds: number; count: number },
): Promise<DenWatch> {
  const releases: Release[] = [];
  const seen = new Set<number>();
  let missingFlag: string | null = null;
  let last = h.snapshot();
  const deadline = last.simTime + options.seconds;

  const note = (snap: FathomSnapshot): void => {
    for (const [index, predator] of snap.predators.entries()) {
      if (typeof predator.released !== "boolean") {
        missingFlag ??= `the ${predator.kind} reports \`released\` as ${JSON.stringify(
          predator.released,
        )}`;
        continue;
      }
      if (!seen.has(index) && predator.released) {
        seen.add(index);
        releases.push({ kind: predator.kind, index, t: snap.simTime });
      }
    }
  };

  note(last);
  while (releases.length < options.count && last.simTime < deadline) {
    await h.advance(WATCH_POLL);
    last = h.snapshot();
    note(last);
  }
  return { releases, missingFlag, last };
}

/**
 * Watch the dive countdown for `seconds`, naming any predator released while it
 * runs.
 *
 * `specs/predators.md`: "Release time `0` is the moment the dive countdown ends
 * and `screen` becomes `"playing"`, so the countdown counts against nothing and no
 * predator leaves the den while one is running." Stops the moment the countdown
 * ends, because a release after that is the schedule rather than a breach.
 */
export async function watchCountdown(
  h: Harness,
  seconds: number,
): Promise<{ loose: string[]; last: FathomSnapshot }> {
  const loose: string[] = [];
  let last = h.snapshot();
  const deadline = last.simTime + seconds;
  const note = (snap: FathomSnapshot): void => {
    if (snap.screen !== "countdown") return;
    for (const predator of snap.predators) {
      if (predator.released === true && !loose.includes(predator.kind)) {
        loose.push(predator.kind);
      }
    }
  };

  note(last);
  while (last.screen === "countdown" && last.simTime < deadline) {
    await h.advance(WATCH_POLL);
    last = h.snapshot();
    note(last);
  }
  return { loose, last };
}

/** The time the schedule gives the `slot`-th release, in seconds from play. */
export function dueAt(slot: number): number {
  return slot * DEN_RELEASE_GAP;
}

/** How long a whole roster's schedule is watched for, in seconds. */
export function watchSeconds(count: number): number {
  return dueAt(count - 1) + RELEASE_GRACE;
}

/** The kinds the schedule releases in, as one readable line. */
export function orderLine(kinds: readonly string[]): string {
  return kinds.length > 0 ? kinds.join(" → ") : "(none left the den)";
}

/** The order `specs/predators.md` fixes, as one readable line. */
export const DEN_ORDER_LINE = orderLine(DEN_ORDER as readonly string[]);
