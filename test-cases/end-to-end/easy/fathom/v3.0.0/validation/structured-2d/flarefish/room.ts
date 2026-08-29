// flarefish/room.ts — the sealed room three of these checks watch a flare cycle
// from, and the figures they share.
//
// WHY A ROOM RATHER THAN A PLACE ON THE BOARD. Three of these items — the tell
// between flares, the cadence, and what the bloom reveals — need a Flarefish that
// keeps WANDERING for tens of seconds. That is the one thing a Flarefish stops
// doing the moment it finds the forager: "A chasing Flarefish neither charges nor
// blooms" (`specs/predators/flarefish.md`), so a scenario that lets the two meet
// has nothing left to watch. And meeting is what happens on any real board: the
// maze is one connected region (`specs/maze.md`) and a Flarefish crosses it at
// `PREDATOR_SPEED` in a few seconds, so "far away" is only ever a head start.
//
// A posed fixture is exempt from `specs/maze.md` (`specs/instrumentation.md`), so
// this simply puts the two in different rooms with no way between them, far
// enough apart that neither of the Flarefish's two reaches arrives:
//
//   * its light-sense, `R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G`, which
//     is `LANTERN_RANGE_BASE` (`128`, four tiles) at the `G = 0` a dive opens on;
//   * its bloom, which locks on through rock inside `FLARE_RADIUS` (`192`, six
//     tiles).
//
// Eleven tiles (`352`) is past both, and it is the CLOSEST the two ever come,
// because the Flarefish's hallway is sealed.
//
// THE BOARD IS EMPTIED OF PLANKTON. `clearPlankton` "is not eating", so it
// "scores nothing and clears no maze" (`specs/instrumentation.md`) and an empty
// maze the forager has not just eaten from stays in live play. Three things
// follow, and every one of them matters to a check that reads pixels or waits
// twenty seconds: the forager's `G` stays at the `0` these distances are computed
// against, no eat can widen the Flarefish's reach mid-watch, and the hallway is
// bare of the faint motes a remembered tile would otherwise be drawn with.
//
// THE HALLWAY IS SIX TILES so that one bloom covers all of it: the furthest two
// of its tiles are five apart (`160`), inside `FLARE_RADIUS`, so after the first
// bloom every tile of it is in the same visibility state and two samples taken
// from it are comparable.

import { FLARE_RADIUS } from "../../src/constants";
import { poseMaze, spawnPredator } from "../fixtures";
import { parkForager } from "../scene";
import type { Harness } from "../harness";
import type { Tile } from "../maze";
import type { FathomSnapshot } from "../surface";
import { fail } from "../assert";

/** How many tiles of corridor the forager's own room holds. */
export const ROOM_TILES = 3;

/** How many tiles of rock separate the two rooms. */
export const ROOM_GAP = 8;

/** How many tiles of corridor the Flarefish's sealed hallway holds. */
export const HALL_TILES = 6;

/**
 * How long a wandering Flarefish is given to reach its first charge-up, in
 * seconds.
 *
 * `specs/predators/flarefish.md` fixes the timer's RELOAD — "the timer restarts at
 * `FLARE_INTERVAL` (`7 s`) as the bloom ends" — and does not fix where in its
 * cycle a Flarefish posed out of the den stands, so nothing here may assume the
 * first flare is a whole interval away. Two full cycles is a ceiling generous to
 * every reading of that and still an explicit one: a build that has not charged up
 * inside it FAILS rather than leaving the point undecided.
 */
export const FIRST_FLARE_MAX = 17;

/**
 * How long a charge-up, once begun, is given to reach its bloom, in seconds, and
 * how long a bloom is given to end.
 *
 * `FLARE_CHARGE` is `0.5 s` and `FLARE_BLOOM` is `1 s`; these are the ceilings a
 * sweep stops at, four times and three times the figure, so a build that is merely
 * slow fails on the measurement below rather than on a sweep that ran out.
 */
export const CHARGE_MAX = 2;
export const BLOOM_MAX = 3;

/**
 * How long the next charge-up is waited for after a bloom ends, in seconds.
 *
 * `FLARE_INTERVAL` is `7 s`, so ten is the interval and three seconds of ceiling.
 */
export const NEXT_FLARE_MAX = 10;

/**
 * How often a flare sweep reads the game, in ticks: a sixtieth of a second.
 *
 * Every beat these checks time is at least `FLARE_CHARGE` (`0.5 s`) long and the
 * tightest band any of them states is a tenth of a second, so a sixtieth resolves
 * each edge to a sixth of the tolerance it is judged against.
 */
export const FLARE_POLL = 2;

/** The room, its hallway, and the Flarefish posed to patrol it. */
export interface FlareRoom {
  /** The tile the forager is parked on, in its own sealed room. */
  forager: Tile;
  /** The hallway's tiles, left to right. */
  hall: Tile[];
  /** The Flarefish's index in the snapshot's roster. */
  index: number;
}

/**
 * Pose the two sealed rooms, park the forager in one and set a wandering
 * Flarefish patrolling the other.
 *
 * The Flarefish starts in the middle of its hallway so the first thing it does is
 * patrol rather than turn around at an end.
 */
export async function poseFlareRoom(h: Harness): Promise<FlareRoom> {
  const art = [
    "N" +
      ".".repeat(ROOM_TILES - 1) +
      " ".repeat(ROOM_GAP) +
      "H" +
      ".".repeat(HALL_TILES - 1),
  ];
  const board = await poseMaze(h, art);
  const home = board.mark("N");
  const start = board.mark("H");
  const hall = Array.from({ length: HALL_TILES }, (_, step) => ({
    tx: start.tx + step,
    ty: start.ty,
  }));

  await parkForager(h, home);
  h.debug.setBrightness(0);

  const index = await spawnPredator(h, "flarefish", hall[2], {
    dir: "right",
    travel: false,
  });

  return { forager: home, hall, index };
}

/**
 * A Flarefish that reports a burning bloom is burning a disc, or the check that
 * wanted one to watch FAILS.
 *
 * specs/predators/flarefish.md ties the two together: through the bloom window
 * "`flaring` is true and `flareRadius` is `FLARE_RADIUS` (`192`, 6 tiles)", and
 * outside a flare "`flaring` is false and `flareRadius` is `0`". So a hunter that
 * raises the flag with no disc under it — over its charge-up, say, which the same
 * file gives `flareCharging` and not `flaring` — hands every check that WAITS for
 * a bloom a moment that is not one, and each of them then reports the flare's
 * light, its cue or its lock against a build whose flare did none of those things
 * yet.
 *
 * `flarefish/flare-reveals` reads the same claim head-on, holding the reported
 * `flareRadius` against `FLARE_RADIUS` through the window it finds. The checks
 * that only needed a bloom to stand in fail here too rather than measuring a
 * moment that was never a bloom.
 */
export function requireBurningDisc(
  snapshot: FathomSnapshot,
  index: number,
): void {
  const fish = snapshot.predators[index];
  if (fish === undefined || fish.flaring !== true) return;
  if (typeof fish.flareRadius === "number" && fish.flareRadius > 0) return;
  fail(
    `a Flarefish reporting flaring to burn a disc of FLARE_RADIUS ` +
      `(${FLARE_RADIUS}), so there was a bloom for this check to stand in; ` +
      "specs/predators/flarefish.md gives the flag and the radius the same " +
      "window",
    `flareRadius was reported as ${JSON.stringify(fish.flareRadius)}`,
  );
}
