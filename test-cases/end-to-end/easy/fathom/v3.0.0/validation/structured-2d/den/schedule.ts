// den/schedule.ts — what the two den checks share.
//
// Both items read the SAME clock: `specs/predators.md`'s staggered release, whose
// times are `0 s`, `DEN_RELEASE_GAP` and `2 * DEN_RELEASE_GAP` "measured from the
// moment live play begins". So both need the same three things, and they live
// here rather than being written twice:
//
//   * the board they run on, which carries a den for the roster and, across
//     solid rock, a corridor for the forager;
//   * a watch that dates each predator's release; and
//   * the tolerance the two items state.
//
// THE SCHEDULE IS READ OFF `released`, NEVER OFF `state` OR A TILE.
// `specs/predators.md` is explicit: "`DEN_RELEASE_GAP` is the spacing between
// release times, not between arrivals in the corridor. `released` is the schedule
// itself, and `state` leaving `"den"` is the swim that follows it." The chamber is
// several tiles wide and `specs/maze.md` fixes neither its interior nor which tile
// a hunter waits on, so timing the stagger from the moment a hunter clears the
// gate charges every gap the difference between two swims: a build releasing
// exactly `5 s` apart from tiles one and three would report gaps of four and six.
//
// THE BOARD IS POSED, like every other board in this suite. `setMaze` sets the
// layout and nothing else (`specs/instrumentation.md`), so a posed fixture runs
// the release schedule exactly as a laid-out maze does — and `setDepth` puts "the
// roster ... laid out in the den with every `released` flag false, exactly as a
// maze at that depth lays it out" onto it.
//
// AND EVERY HUNTER'S BODY IS HELD, because neither item exercises one. The
// schedule is the `released` flag and nothing else, and `setPredatorTravel` leaves
// that flag turning over on its own slot while the body holds in the den, since
// crossing the chamber to the gate is travel (`specs/instrumentation.md`). So the
// one thing these items must not be at the mercy of — a hunter reaching the
// forager, taking a life, re-denning the roster and restarting the very clock
// being read — cannot happen, because nothing on the board travels at all.

import { assertEqual, assertLength } from "../assert";
import { DEN_ORDER, DEN_RELEASE_GAP } from "../constants";
import { poseMaze } from "../fixtures";
import { parkForager } from "../scene";
import type { Harness } from "../harness";
import type { FathomSnapshot } from "../surface";
import type { Tile } from "../maze";

/**
 * THE BOARD BOTH ITEMS RUN ON.
 *
 * A three-tile den chamber with its gate above the middle tile and a short pocket
 * of corridor above that, so a released hunter has somewhere to swim out to — and,
 * on the top row, a separate corridor for the forager with a full band of rock
 * between the two. `specs/instrumentation.md` exempts a posed layout from every
 * rule in `specs/maze.md`, disconnected regions included, and requires the game to
 * keep running on one.
 *
 * The board carries no plankton, so nothing can clear it and no bonus drifter is
 * admitted (`specs/gameplay.md`), and it carries no creature at all until
 * `setDepth` lays the depth's own roster into the den.
 */
export const DEN_BOARD: readonly string[] = [
  "F..........",
  "",
  "    ...",
  "     g",
  "    ddd",
];

/** The depth both items read the schedule at, whose roster is one of each kind. */
export const DEN_DEPTH = 1;

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
 * Pose the board, lay the depth's roster into its den, and park the forager in
 * the corridor across the rock.
 *
 * Nothing is playing yet: the caller opens the screen it wants, so `den/stagger`
 * can watch a countdown first and both items can pin release time `0` to the
 * moment they choose.
 */
export async function poseDenBoard(h: Harness): Promise<Tile> {
  const board = await poseMaze(h, DEN_BOARD);
  const home = board.mark("F");
  await parkForager(h, home);
  h.debug.setDepth(DEN_DEPTH);
  h.debug.setBrightness(0);
  holdRoster(h);
  return home;
}

/**
 * Hold every hunter of the laid-out roster where it stands, minds running.
 *
 * Called after `setDepth` has laid the roster in, and again after a catch has
 * re-denned it: `specs/progression.md` restores the arrangement an attempt starts
 * from, and neither item reads anything a fresh body would carry over.
 */
export function holdRoster(h: Harness): void {
  const roster = h.snapshot().predators;
  for (let index = 0; index < roster.length; index += 1) {
    h.debug.setPredatorTravel(index, false);
  }
}

/**
 * The roster the posed board carries is the one the schedule is written about, or
 * this check FAILS.
 *
 * `setDepth` lays out "the roster specs/predators.md gives for depth `d`", which
 * at depth 1 is one of each of the three kinds. A build that answers with fewer
 * has no staggered schedule to read, and a check that decided nothing over it
 * would leave the point to a person to settle by hand.
 */
export function assertRoster(snapshot: FathomSnapshot): void {
  assertLength(
    snapshot.predators,
    DEN_ORDER.length,
    `the predators setDepth(${DEN_DEPTH}) laid into the den, which ` +
      `specs/predators.md gives as one of each of ` +
      `${DEN_ORDER.length} kinds (${DEN_ORDER_LINE})`,
  );
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
 * Every predator reports `released` as a boolean, or this check FAILS.
 *
 * specs/state.md requires `released` of every predator and specs/predators.md
 * dates the whole staggered schedule from it, so a roster that does not report it
 * leaves both den points measuring nothing: no release ever arrives, and a den
 * that never opened is indistinguishable from a field that was never there. That
 * is a missing deliverable rather than an undecidable point, so it fails here as
 * well as at `instrumentation/snapshot-shape`.
 */
export function assertReleasedFlag(watch: DenWatch): void {
  assertEqual(
    watch.missingFlag,
    null,
    "`released` reported as a boolean on every predator, which is what the " +
      "staggered schedule specs/predators.md fixes is dated from; " +
      "specs/state.md requires the field",
  );
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
