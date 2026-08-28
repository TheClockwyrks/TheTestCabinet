// kindle/flare-second-circle — a flare is a second window onto the maze.
//
// `specs/sensing.md`, in the Kindle dive: the Flarefish's bloom "lights the full
// disc of the flare radius ... rock and floor alike and straight through rock",
// "It is full vision, so it draws even ground that has never been explored, and
// it is drawn over the vision-circle mask, so a flare beyond the circle still
// reads. When the bloom ends the disc goes with it: everything it lit that lies
// outside the vision circle is painted back to the flat fog, still remembered
// underneath." `specs/predators/flarefish.md` fixes the disc at `FLARE_RADIUS`
// (`192`) and the bloom at `FLARE_BLOOM` (`1 s`) after a `FLARE_CHARGE` (`0.5 s`)
// charge-up, on a `FLARE_INTERVAL` (`7 s`) timer that runs while it wanders.
//
// So the point is a pair of readings on ONE tile: lit while the bloom burns, back
// to the flat fog once it is over. The second reading is what makes this a check
// of the flare rather than of the mask — a build that simply draws the whole maze
// lights the tile during the bloom too, and only the fade separates them.
//
// THE FLAREFISH IS SEALED IN A ROOM OF ITS OWN, twenty-five tiles from the
// forager. `specs/maze.md` requires one connected region and a fixture is exempt
// (`specs/instrumentation.md`), so the two are in different rooms rather than
// merely far apart: the hunter patrols for the seven seconds its timer takes
// without ever arriving, and every tile of its room lies beyond the forager's
// circle at any brightness. Its own light-sense reaches at most `320` units
// (`specs/predators/flarefish.md`) and the rock between blocks the line, so it
// keeps wandering and the timer keeps running.
//
// THE TILE IS CHOSEN WHEN THE BLOOM FIRES, as the tile of that room furthest from
// the Flarefish that still lies inside the disc — as far from the bloom art drawn
// on the creature itself as the room allows, and it is the MAZE being drawn that
// is read there.
//
// THE WAIT HAS A CEILING. A build whose Flarefish never blooms fails here rather
// than hanging: the sweep is bounded at the interval, the charge and the bloom
// with a second's margin, and the check asserts the bloom actually arrived. It is
// run on `skipUntil`, so the seven seconds of wandering cost the clip nothing and
// the recording is the bloom itself.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import {
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
} from "../constants";
import {
  placePredator,
  poseMaze,
  predatorIndex,
  tileCenterOf,
  visibilityAt,
} from "../fixtures";
import {
  captureReplay,
  colorDistance,
  createHarness,
  ticks,
  tileColor,
  windowRadius,
  type Harness,
  type Rgb,
} from "../harness";
import {
  clearUnderfoot,
  denAllExcept,
  parkForager,
  sceneGuard,
  sceneHeld,
  startPlaying,
} from "../scene";
import type { TileRef } from "../maze";
import { FOG_MATCH } from "./_kindle";

/**
 * The board, stamped at the grid's own origin so both rooms sit where this
 * scenario needs them: the forager's three-tile corridor at the top left, the
 * Flarefish's sealed six-by-three ring at the top right, and a sealed three-tile
 * pocket thirteen rows down for the fog reference.
 *
 * `F` the forager, `R` every tile of the ring, `S` the fog reference.
 */
const ROCK = " ".repeat(36);
const ART = [
  ROCK,
  " F.." + " ".repeat(22) + "RRRRRR" + " ".repeat(4),
  " ".repeat(26) + "R" + " ".repeat(4) + "R" + " ".repeat(4),
  " ".repeat(26) + "RRRRRR" + " ".repeat(4),
  ROCK,
  ROCK,
  ROCK,
  ROCK,
  ROCK,
  ROCK,
  ROCK,
  ROCK,
  ROCK,
  ROCK,
  " S.." + " ".repeat(32),
  ROCK,
] as const;

/**
 * How far inside the disc the sampled tile's center must lie, in logical units.
 *
 * Half a tile in from `FLARE_RADIUS`, so the tile is inside the disc under any
 * reading of where a disc's edge falls across a tile.
 */
const DISC_MARGIN = 16;

/** The review item's bounds, as RGB distances out of `441`. */
const DRAWN_MIN = FOG_MATCH;
const FADED_MAX = FOG_MATCH;

/**
 * How long the scenario will wait for a bloom, in ticks.
 *
 * `FLARE_INTERVAL` for the timer, `FLARE_CHARGE` for the charge-up, and a second
 * of margin. A build slower than that FAILS here rather than leaving the point
 * undecided; the cadence itself is `flarefish/flare-cadence`'s to grade.
 */
const BLOOM_DEADLINE = ticks(FLARE_INTERVAL + FLARE_CHARGE + 1);

/** How long it will then wait for that bloom to end, in ticks. */
const END_DEADLINE = ticks(FLARE_BLOOM + 1);

/** Ticks into the bloom before it is read, so the build has drawn the disc. */
const BLOOM_SETTLE = 6;

/**
 * Ticks after the bloom ends before the tile is read again.
 *
 * `specs/predators/flarefish.md` has "a short fade of the bloom art" play out
 * from that moment, "lighting nothing"; a second is comfortably past it and
 * still far inside the `FLARE_INTERVAL` before the next charge-up.
 */
const FADE_TICKS = ticks(1);

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("draws the maze inside a bloom beyond the vision circle, and fogs it again when the bloom ends", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART, { at: { tx: 0, ty: 0 } });
  const ring = board.all("R");
  const unlit = board.mark("S");

  const flarefish = predatorIndex(await h.snapshot(), "flarefish");
  if (flarefish === null) {
    // Which hunters the depth-1 roster carries is `scoring/depth-scaling`'s
    // verdict; with no Flarefish there is nothing here to pose.
    h.unmet(
      "the roster carries no Flarefish, which is the hunter this scenario poses " +
        "— what the depth-1 roster holds is the progression checks' verdict, " +
        "not this one's",
    );
  }
  const quiet = await denAllExcept(h, [flarefish]);
  await placePredator(h, flarefish, ring[0], { state: "wander" });
  await parkForager(h, board.mark("F"));
  await clearUnderfoot(h);
  const guard = await sceneGuard(h, quiet);

  // The seven seconds of wandering the timer takes are SKIPPED rather than
  // advanced: the same real ticks, closing no recorded frame, so the clip below
  // is the bloom rather than the wait for it.
  const charged = await h.skipUntil(
    (snapshot) => snapshot.predators[flarefish].flareCharging === true,
    { maxTicks: BLOOM_DEADLINE, poll: 4 },
  );
  assertEqual(
    charged.hit,
    true,
    `the Flarefish began a charge-up within ${BLOOM_DEADLINE} ticks of being ` +
      `posed to wander, which is FLARE_INTERVAL (${FLARE_INTERVAL} s) and a ` +
      "second's margin",
  );

  const seen = await captureReplay(h, "second", async () => {
    const blooming = await h.until(
      (snapshot) => snapshot.predators[flarefish].flaring === true,
      { maxTicks: ticks(FLARE_CHARGE + 1), poll: 1 },
    );
    await h.advance(BLOOM_SETTLE);
    const during = await h.snapshot();
    const hunter = during.predators[flarefish];

    // The tile of the ring furthest from the Flarefish that still lies inside the
    // disc: as clear of the bloom art drawn on the creature as this room allows,
    // and beyond the forager's own circle like every tile here.
    let target: TileRef | null = null;
    let reach = -1;
    for (const tile of ring) {
      const at = tileCenterOf(during.grid, tile);
      const fromFlare = Math.hypot(at.x - hunter.x, at.y - hunter.y);
      if (fromFlare > FLARE_RADIUS - DISC_MARGIN) continue;
      if (fromFlare <= reach) continue;
      reach = fromFlare;
      target = tile;
    }
    const litColor: Rgb | null =
      target === null ? null : await tileColor(h, during, target);
    const fog = await tileColor(h, during, unlit);

    const ended = await h.until(
      (snapshot) => snapshot.predators[flarefish].flaring === false,
      { maxTicks: END_DEADLINE, poll: 1 },
    );
    await h.advance(FADE_TICKS);
    const after = await h.snapshot();
    const fadedColor: Rgb | null =
      target === null ? null : await tileColor(h, after, target);

    return {
      blooming,
      during,
      hunter,
      target,
      reach,
      litColor,
      fog,
      ended,
      after,
      fadedColor,
    };
  });

  assertNull(
    sceneHeld(await h.snapshot(), guard),
    "the scenario held to the end",
  );

  assertEqual(
    seen.blooming.hit,
    true,
    `the charge-up became a bloom within ${ticks(FLARE_CHARGE + 1)} ticks, ` +
      `which is FLARE_CHARGE (${FLARE_CHARGE} s) and a second's margin`,
  );
  if (
    seen.target === null ||
    seen.litColor === null ||
    seen.fadedColor === null
  ) {
    // Every tile of this room stands within `FLARE_RADIUS` of every other, so
    // reaching here means the build's disc is somewhere other than where it says
    // it is — which is `flarefish/flare-radius`'s verdict to give.
    h.unmet(
      "no tile of the Flarefish's own room lay inside the bloom disc while it " +
        "burned, so there was no lit ground to read — where the disc reaches is " +
        "the flarefish checks' verdict, not this one's",
    );
  }

  // The fixture's own geometry: the tile is inside the bloom and beyond the
  // forager's circle, which is the whole situation this point describes.
  assertLessThanOrEqual(
    seen.reach,
    FLARE_RADIUS,
    "the logical units between the Flarefish and the tile that is read, against " +
      `FLARE_RADIUS (${FLARE_RADIUS})`,
  );
  const at = tileCenterOf(seen.during.grid, seen.target);
  assertGreaterThan(
    Math.hypot(at.x - seen.during.forager.x, at.y - seen.during.forager.y),
    windowRadius(seen.during),
    "the logical units between the forager and the tile that is read, against " +
      "the vision circle R it must lie beyond",
  );

  // Drawn while the bloom burns.
  assertGreaterThan(
    colorDistance(seen.litColor, seen.fog),
    DRAWN_MIN,
    `the RGB distance out of 441 between the tile at (${seen.target.tx}, ` +
      `${seen.target.ty}), inside the burning bloom and beyond the forager's ` +
      "circle, and unrevealed fog",
  );

  // And painted back to the fog once it is over.
  assertEqual(
    seen.ended.hit,
    true,
    `the bloom ended within ${END_DEADLINE} ticks of being read, which is ` +
      `FLARE_BLOOM (${FLARE_BLOOM} s) and a second's margin`,
  );
  assertEqual(
    seen.after.predators[flarefish].flaring,
    false,
    "the Flarefish's `flaring` at the second reading",
  );
  assertEqual(
    visibilityAt(seen.after, seen.target),
    "r",
    `the tile at (${seen.target.tx}, ${seen.target.ty}) once the bloom is over: ` +
      "what the flare lit stays remembered underneath",
  );
  assertLessThanOrEqual(
    colorDistance(seen.fadedColor, seen.fog),
    FADED_MAX,
    "the RGB distance out of 441 between that same tile a second after the bloom " +
      "ended and unrevealed fog: the disc goes with the bloom",
  );
});
