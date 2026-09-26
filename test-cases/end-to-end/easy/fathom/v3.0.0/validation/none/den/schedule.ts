// den/schedule.ts — what the two den checks share.
//
// Both items read the SAME clock: `specs/predators.md`'s staggered release, whose
// times are `0 s`, `DEN_RELEASE_GAP` and `2 * DEN_RELEASE_GAP` "measured from the
// moment live play begins". So both need the same three things, and they live
// here rather than being written twice:
//
//   * a parking spot for the forager that is clear of the den, because a forager
//     caught mid-measurement re-dens every predator and restarts the very
//     schedule being read;
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
// THE WORLD THESE TWO POSE IS THE ROSTER AND NOTHING ELSE. Both items are ABOUT
// several predators existing at once, so the roster is what {@link poseDenBoard}
// puts back: a fixture carrying one den chamber and, across solid rock, a room
// for the forager, with `setDepth` laying the depth's own roster into that
// chamber unreleased, "exactly as a maze at that depth lays it out"
// (`specs/instrumentation.md`). Nothing else is on the board — no plankton, no
// drifters, no fog — so nothing but the schedule can move while it is read.
//
// AND EVERY HUNTER'S BODY IS HELD, because neither item exercises one. The
// schedule is the `released` flag and nothing else, and `setPredatorTravel` leaves
// that flag turning over on its own slot while the body holds in the den, since
// crossing the chamber to the gate is travel (`specs/instrumentation.md`). So the
// one thing these items must not be at the mercy of — a hunter reaching the
// forager, taking a life, re-denning the roster and restarting the very clock
// being read — cannot happen, because nothing on the board travels at all.
//
// THE FORAGER IS A BYSTANDER AND IT IS THE ONE THING THAT CANNOT BE REMOVED, so
// the fixture gives it a room of its own besides, no corridor joining it to the
// den's.

import { DEN_ORDER, DEN_RELEASE_GAP } from "../constants";
import { holdPredators, poseMaze } from "../fixtures";
import { parkForager } from "../scene";
import type { FathomSnapshot, Harness } from "../harness";
import type { Tile } from "../maze";

/**
 * How far a measured release may sit from the time the schedule gives it, in
 * seconds.
 *
 * Both items state it: "within a tenth of a second". The watch below resolves an
 * event to its own poll, which is {@link WATCH_POLL} ticks — a thirtieth of a
 * second — so two thirds of this band is room for the build.
 */
export const RELEASE_TOLERANCE = 0.1;

/**
 * How often the den is read, in ticks: a thirtieth of a second.
 *
 * A third of the band {@link RELEASE_TOLERANCE} states, which leaves the rest to
 * the build. It is not finer because `specs/instrumentation.md` has `advance`
 * REDRAW, so every sample costs the build a whole frame of its own rendering — a
 * few milliseconds on an idle machine and tens of times that on a busy one — and
 * a schedule of three releases `DEN_RELEASE_GAP` (`5 s`) apart is eighteen
 * seconds of game. Sampled every other tick that is a thousand renders spent on a
 * measurement that reads none of them, which turns a schedule a build either keeps
 * or does not into a reading of how busy the host was.
 */
export const WATCH_POLL = 4;

/** How many samples one crossing into the page carries. */
export const WATCH_CHUNK = 30;

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
 * The board both items are read on: a sealed room for the forager, and across
 * eight tiles of rock a corridor with a three-tile den chamber under it.
 *
 * Six letters do the work. `N` is the forager's tile, at the closed end of its
 * own room. `g` is the den gate, on the chamber's top edge with corridor above
 * it, so a released hunter swims up through the gate and out into a hallway that
 * goes nowhere near the forager.
 */
const DEN_ART: readonly string[] = [
  "N....",
  "",
  "                  ..........",
  "                     g",
  "                    ddd",
];

/** Where the fixture put the forager. */
export interface DenBoard {
  /** The tile the forager is parked on, in its own sealed room. */
  forager: Tile;
}

/**
 * Pose the den board, park the forager in its own room, and lay the depth-`1`
 * roster into the chamber.
 *
 * `setDepth(1)` is what puts the roster there: it "becomes the one
 * specs/predators.md gives for depth `d`, laid out in the den with every
 * `released` flag false, exactly as a maze at that depth lays it out"
 * (`specs/instrumentation.md`). That is the roster whose staggered schedule both
 * items read, and it is the only thing on the board besides the forager.
 *
 * Every hunter it lays in is left with its mind running and its travel held.
 *
 * The screen is left where the caller put it, because both items pin the
 * schedule's origin themselves: the schedule starts from the moment `screen`
 * becomes `"playing"`, so the check that reads it decides when that moment is.
 */
export async function poseDenBoard(h: Harness): Promise<DenBoard> {
  const posed = await poseMaze(h, DEN_ART);
  const home = posed.mark("N");
  await parkForager(h, home);
  await h.debug.setDepth(1);
  await holdPredators(h);
  await h.debug.setBrightness(0);
  return { forager: home };
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
  let last = await h.snapshot();
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
  // A chunk of samples per crossing into the page rather than one apiece: the
  // ticks are stepped the same way, one `advance(WATCH_POLL)` per sample, and what
  // is saved is the round trip between them. The watch can run up to a chunk past
  // the release that satisfies it, which the schedule this reads is indifferent to
  // — every release is recorded from the samples either way.
  while (releases.length < options.count && last.simTime < deadline) {
    for (const reading of await h.scan(WATCH_POLL * WATCH_CHUNK, WATCH_POLL)) {
      last = reading.snapshot;
      note(last);
    }
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
  let last = await h.snapshot();
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
    last = await h.snapshot();
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
