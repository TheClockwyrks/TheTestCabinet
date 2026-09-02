// flarefish/room.ts — the sealed room three of these checks watch a flare cycle
// from, and the figures they share.
//
// WHAT THE THREE ITEMS EXERCISE. The tell between flares, the cadence, and what
// the bloom reveals are all the Flarefish's MIND: its flare timer runs, it
// charges, it blooms, and it senses. None of the three is about how it travels,
// so its travel is held and the bloom this poser hands over burns from the tile
// it was stood on. What that removes is a whole class of accident — a hunter that
// wandered out of the frame a pixel was read at, or off the tile a disc was
// measured from — without touching the cadence being watched.
//
// WHY A ROOM RATHER THAN A PLACE ON THE BOARD. All three need a Flarefish that
// stays in `"wander"` for tens of seconds. That is the one thing a Flarefish
// stops doing the moment it finds the forager: "A chasing Flarefish neither
// charges nor blooms" (`specs/predators/flarefish.md`), so a scenario in which it
// senses the forager has nothing left to watch. A posed fixture is exempt from
// `specs/maze.md` (`specs/instrumentation.md`), so this simply puts the two in
// different rooms with no way between them, far enough apart that neither of the
// Flarefish's two reaches arrives:
//
//   * its light-sense, `R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G`, which
//     is `LANTERN_RANGE_BASE` (`128`, four tiles) at the `G = 0` a dive opens on;
//   * its bloom, which locks on through rock inside `FLARE_RADIUS` (`192`, six
//     tiles).
//
// Eleven tiles (`352`) is past both, and it is the separation the two hold for
// the whole watch, because the Flarefish's body does not travel.
//
// THE ROOM HOLDS THE FLAREFISH AND NOTHING ELSE. `poseMaze` empties the board,
// so the other two hunters are off the roster rather than shut in a den, and the
// maze carries no plankton. Three things follow, and every one of them matters to
// a check that reads pixels or waits twenty seconds: the forager's `G` stays at
// the `0` these distances are computed against, no eat can widen the Flarefish's
// reach mid-watch, and the hallway is bare of the faint motes a remembered tile
// would otherwise be drawn with.
//
// THE HALLWAY IS SIX TILES so that one bloom covers all of it: the furthest two
// of its tiles are five apart (`160`), inside `FLARE_RADIUS`, so after the first
// bloom every tile of it is in the same visibility state and two samples taken
// from it are comparable.

import { poseMaze, spawnPredator } from "../fixtures";
import { parkForager } from "../scene";
import type { Harness } from "../harness";
import type { Tile } from "../maze";

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
 * How often a flare sweep reads the game, in ticks: a thirtieth of a second.
 *
 * Every beat these checks time is at least `FLARE_CHARGE` (`0.5 s`) long and the
 * tightest band any of them states is a tenth of a second. An edge is seen at the
 * first sample at or after it, so a beat measured between two of them is under one
 * sample out either way — a third of that band, leaving the other two thirds as
 * room for the build's own rounding.
 *
 * WHY NOT FINER. `specs/instrumentation.md` has `advance` REDRAW, so every sample
 * costs the build a whole frame of its own rendering — a few milliseconds on an
 * idle machine and tens of times that on a busy one. A flare cycle is `8.5 s` of
 * game and these checks watch two of them, so a sixtieth of a second would be a
 * thousand renders spent on a measurement that reads none of them, which turns a
 * cadence a build either keeps or does not into a reading of how busy the host was.
 * A pure WAIT — reaching a flare rather than timing one — takes
 * {@link FLARE_WAIT_POLL} instead.
 */
export const FLARE_POLL = 4;

/**
 * How often a sweep that is only WAITING reads the game, in ticks: a fifth of a
 * second.
 *
 * A wait for a flare to arrive at all decides nothing about when it arrived: the
 * checks that use this read `hit` off it and nothing else, and every beat they go
 * on to time is sampled at {@link FLARE_POLL}. What this has to be fine enough for
 * is only to land INSIDE the phase it is waiting for, and the shortest of those is
 * a `FLARE_CHARGE` (`0.5 s`) charge-up — two and a half times this, so a wait
 * stops at most a fifth of a second into a phase that lasts half of one.
 */
export const FLARE_WAIT_POLL = 24;

/** The room, its hallway, and the Flarefish standing in it. */
export interface FlareRoom {
  /** The tile the forager is parked on, in its own sealed room. */
  forager: Tile;
  /** The hallway's tiles, left to right. */
  hall: Tile[];
  /** The Flarefish's index in the snapshot's roster. */
  index: number;
}

/**
 * Pose the two sealed rooms, park the forager in one and stand a wandering
 * Flarefish in the other with its travel held.
 *
 * It stands in the middle of its hallway, so one bloom from where it stands
 * covers every tile of that hallway.
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
  await h.debug.setBrightness(0);

  const index = await spawnPredator(h, "flarefish", hall[2], {
    dir: "right",
    state: "wander",
    travel: false,
  });

  return { forager: home, hall, index };
}
