// kindle/flare-second-circle — a flare is a second window onto the maze.
//
// specs/sensing.md, in the Kindle dive: the Flarefish's bloom "lights the full
// disc of the flare radius ... rock and floor alike and straight through rock",
// "It is full vision, so it draws even ground that has never been explored, and
// it is drawn over the vision-circle mask, so a flare beyond the circle still
// reads. When the bloom ends the disc goes with it: everything it lit that lies
// outside the vision circle is painted back to the flat fog, still remembered
// underneath." specs/predators/flarefish.md fixes the disc at `FLARE_RADIUS`
// (`192`) and the bloom at `FLARE_BLOOM` (`1 s`) after a `FLARE_CHARGE` (`0.5 s`)
// charge-up, on a `FLARE_INTERVAL` (`7 s`) timer that runs while it wanders.
//
// So the point is a pair of readings on ONE tile: lit while the bloom burns, back
// to the flat fog once it is over. The second reading is what makes this a check
// of the flare rather than of the mask — a build that simply draws the whole maze
// lights the tile during the bloom too, and only the fade separates them.
//
// AND WHAT IS DRAWN THERE HAS TO BE THE MAZE. "Lit" read as "brighter than the
// flat fog" is satisfied by the bloom ART alone: specs/assets.md draws that from
// the seeded flare-bloom sheet composited as light, so a build that leaves the
// mask closed over the disc and lets the glow show through paints a bright patch
// over ground it never drew. What separates the two is STRUCTURE — the disc draws
// "rock and floor alike", and specs/assets.md draws rock from the wall autotile
// and the corridor from the floor frame, so under a real second window the two
// read differently and under a glow alone they read the same. The reading is
// therefore taken on a rock tile and the corridor tile directly beneath it, one
// tile apart so the bloom falls on both alike, and they must not match.
//
// THE FLAREFISH IS SEALED IN A ROOM OF ITS OWN, twenty-five tiles from the
// forager. specs/maze.md requires one connected region and a fixture is exempt
// (specs/instrumentation.md), so the two are in different rooms rather than
// merely far apart: the hunter patrols for the seven seconds its timer takes
// without ever arriving, and every tile of its room lies beyond the forager's
// circle at any brightness. Its own light-sense reaches at most `320` units
// (specs/predators/flarefish.md) and the rock between blocks the line, so it
// keeps wandering and the timer keeps running.
//
// THE TILE IS CHOSEN WHEN THE BLOOM FIRES, as the tile of that room furthest from
// the Flarefish that still lies inside the disc — as far from the bloom art drawn
// on the creature itself as the room allows, and it is the MAZE being drawn that
// is read there.
//
// THE WAIT HAS A CEILING. A build whose Flarefish never blooms fails here rather
// than hanging: the sweep is bounded at the interval, the charge and the bloom
// with a second's margin, and the check asserts the bloom actually arrived.

import { afterEach, beforeEach, it } from "vitest";
import {
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  centerOf,
  colorDistance,
  createHarness,
  type Harness,
  type Rgb,
  sampleColorAtTile,
  startPlaying,
  ticksFor,
  visibilityAt,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import type { Tile } from "../maze";
import { FOG_MATCH, windowRadius } from "./circle";

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
 * How far apart a rock tile and a corridor tile inside the bloom must read, as an
 * RGB distance out of `441`.
 *
 * The same `25` every other reading here uses, and used the same way: two samples
 * closer together than this are the same color as far as this suite is concerned.
 * A build drawing the trench under the disc separates them by several times it,
 * because they are drawn from different frames of `assets/trench-walls/`; a build
 * showing only the bloom's own glow separates them by the falloff across one
 * tile, which is far under it.
 */
const STRUCTURE_MIN = FOG_MATCH;

/**
 * How long the scenario will wait for a bloom, in ticks.
 *
 * `FLARE_INTERVAL` for the timer, `FLARE_CHARGE` for the charge-up, and a second
 * of margin. A build slower than that FAILS here rather than leaving the point
 * undecided; the cadence itself is `flarefish/flare-cadence`'s to grade.
 */
const BLOOM_DEADLINE = ticksFor(FLARE_INTERVAL + FLARE_CHARGE + 1);

/** How long it will then wait for that bloom to end, in ticks. */
const END_DEADLINE = ticksFor(FLARE_BLOOM + 1);

/** Ticks into the bloom before it is read, so the build has drawn the disc. */
const BLOOM_SETTLE = 6;

/**
 * Ticks after the bloom ends before the tile is read again.
 *
 * specs/predators/flarefish.md has "a short fade of the bloom art" play out from
 * that moment, "lighting nothing"; a second is comfortably past it and still far
 * inside the `FLARE_INTERVAL` before the next charge-up.
 */
const FADE_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A flare is a second window onto the maze", async () => {
  startPlaying(h);
  const board = await poseMaze(h, ART, { at: { tx: 0, ty: 0 } });
  const ring = board.all("R");
  const unlit = board.mark("S");
  // The ring's own pellets are taken off before anything is read. A plankton is
  // drawn on the corridor tile of the pair and never on the rock above it, so the
  // pellet alone would separate the two colors and a build that washed the disc
  // flat under its own plankton would read as the trench.
  // specs/instrumentation.md has `setPlankton` take one off without eating it, so
  // nothing scores and no maze clears.
  for (const tile of ring) {
    h.debug.setPlankton(tile.tx, tile.ty, false);
  }

  // The rock the ring encloses: every tile inside its bounding box that is not a
  // tile of the ring itself, which this fixture leaves solid.
  const inner: Tile[] = [];
  const txs = ring.map((tile) => tile.tx);
  const tys = ring.map((tile) => tile.ty);
  for (let ty = Math.min(...tys) + 1; ty < Math.max(...tys); ty += 1) {
    for (let tx = Math.min(...txs) + 1; tx < Math.max(...txs); tx += 1) {
      if (ring.some((tile) => tile.tx === tx && tile.ty === ty)) continue;
      inner.push({ tx, ty });
    }
  }

  const flarefish = await spawnPredator(h, "flarefish", ring[0], {
    travel: false,
  });
  await parkForager(h, board.mark("F"));
  const guard = await sceneGuard(h);

  // The seven seconds of wandering the timer takes are run before the capture
  // opens, so the clip is the bloom rather than the wait for it.
  const charged = await h.until(
    (snapshot) => snapshot.predators[flarefish]?.flareCharging === true,
    { maxFrames: BLOOM_DEADLINE, poll: 4 },
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
      (snapshot) => snapshot.predators[flarefish]?.flaring === true,
      { maxFrames: ticksFor(FLARE_CHARGE + 1), poll: 1 },
    );
    await h.advance(BLOOM_SETTLE);
    const during = h.snapshot();
    const hunter = during.predators[flarefish];

    // The tile of the ring furthest from the Flarefish that still lies inside the
    // disc: as clear of the bloom art drawn on the creature as this room allows,
    // and beyond the forager's own circle like every tile here.
    let target: Tile | null = null;
    let reach = -1;
    for (const tile of ring) {
      const at = centerOf(during, tile);
      const fromFlare = Math.hypot(at.x - hunter.x, at.y - hunter.y);
      if (fromFlare > FLARE_RADIUS - DISC_MARGIN) continue;
      if (fromFlare <= reach) continue;
      reach = fromFlare;
      target = tile;
    }
    const litColor: Rgb | null =
      target === null ? null : sampleColorAtTile(h, during, target);
    const fog = sampleColorAtTile(h, during, unlit);

    // The structure reading: a rock tile of the ring's own interior and the
    // corridor tile directly beneath it, the furthest such pair that still lies
    // inside the disc, so the bloom falls on the two of them alike.
    let wall: Tile | null = null;
    let floor: Tile | null = null;
    let pairReach = -1;
    for (const rock of inner) {
      const under = ring.find(
        (tile) => tile.tx === rock.tx && tile.ty === rock.ty + 1,
      );
      if (under === undefined) continue;
      const rockAt = centerOf(during, rock);
      const underAt = centerOf(during, under);
      const rockReach = Math.hypot(rockAt.x - hunter.x, rockAt.y - hunter.y);
      const underReach = Math.hypot(underAt.x - hunter.x, underAt.y - hunter.y);
      if (Math.max(rockReach, underReach) > FLARE_RADIUS - DISC_MARGIN)
        continue;
      const nearer = Math.min(rockReach, underReach);
      if (nearer <= pairReach) continue;
      pairReach = nearer;
      wall = rock;
      floor = under;
    }
    const wallColor: Rgb | null =
      wall === null ? null : sampleColorAtTile(h, during, wall);
    const floorColor: Rgb | null =
      floor === null ? null : sampleColorAtTile(h, during, floor);

    const ended = await h.until(
      (snapshot) => snapshot.predators[flarefish]?.flaring === false,
      { maxFrames: END_DEADLINE, poll: 1 },
    );
    await h.advance(FADE_TICKS);
    const after = h.snapshot();
    const fadedColor: Rgb | null =
      target === null ? null : sampleColorAtTile(h, after, target);

    return {
      blooming,
      during,
      hunter,
      target,
      reach,
      litColor,
      fog,
      wall,
      floor,
      wallColor,
      floorColor,
      ended,
      after,
      fadedColor,
    };
  });

  requireSceneHeld(h.snapshot(), guard);

  assertEqual(
    seen.blooming.hit,
    true,
    `the charge-up became a bloom within ${ticksFor(FLARE_CHARGE + 1)} ticks, ` +
      `which is FLARE_CHARGE (${FLARE_CHARGE} s) and a second's margin`,
  );
  if (
    seen.target === null ||
    seen.litColor === null ||
    seen.fadedColor === null
  ) {
    // Every tile of this room stands within `FLARE_RADIUS` of every other, so
    // reaching here means the build's disc is somewhere other than where it says.
    fail(
      `the bloom disc to reach the FLARE_RADIUS (${FLARE_RADIUS}) ` +
        "specs/predators/flarefish.md gives it, so a tile of the Flarefish's own " +
        "room lay inside it while it burned",
      "no tile of that room lay inside the disc",
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
  const fromPlayer = Math.hypot(
    centerOf(seen.during, seen.target).x - seen.during.forager.x,
    centerOf(seen.during, seen.target).y - seen.during.forager.y,
  );
  assertGreaterThan(
    fromPlayer,
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

  // And what is drawn there is the maze, not the bloom's own glow over the mask.
  if (
    seen.wall === null ||
    seen.floor === null ||
    seen.wallColor === null ||
    seen.floorColor === null
  ) {
    fail(
      `the bloom disc to reach the FLARE_RADIUS (${FLARE_RADIUS}) ` +
        "specs/predators/flarefish.md gives it, so a rock tile of the " +
        "Flarefish's own room and the corridor beneath it both lay inside it " +
        "while it burned",
      "no such pair lay inside the disc",
    );
  }
  assertGreaterThan(
    colorDistance(seen.wallColor, seen.floorColor),
    STRUCTURE_MIN,
    `the RGB distance out of 441 between the rock at (${seen.wall.tx}, ` +
      `${seen.wall.ty}) and the corridor at (${seen.floor.tx}, ` +
      `${seen.floor.ty}) directly beneath it, one tile apart and both inside ` +
      "the burning bloom: the disc draws rock and floor alike, so the trench " +
      "itself reads out there rather than a flat wash of the bloom's light",
  );

  // And painted back to the fog once it is over.
  assertEqual(
    seen.ended.hit,
    true,
    `the bloom ended within ${END_DEADLINE} ticks of being read, which is ` +
      `FLARE_BLOOM (${FLARE_BLOOM} s) and a second's margin`,
  );
  assertEqual(
    seen.after.predators[flarefish]?.flaring,
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
