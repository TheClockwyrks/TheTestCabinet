// kindle/vision-circle — the maze is drawn only inside the circle.
//
// specs/sensing.md: the forager "carries an outer vision circle, and the maze is
// drawn only inside it"; it is "a true circle of radius `R` about the forager's
// center", "terrain, plankton and the amber lights are drawn inside it", and
// "ground beyond `R` is painted with the same flat fog as never-revealed ground,
// and it stays remembered underneath".
//
// So the reading is a PAIR, taken on the same board in the same frame: revealed
// ground just inside `R` is drawn, revealed ground just outside it is fog. Either
// half alone is passed by a build that never draws the maze, or by one that has
// no circle at all; only the pair says the circle is there and is where the build
// says it is.
//
// THE BAND BETWEEN `V` AND `R` IS WHERE THIS POINT LIVES. Inside `V` the tile is
// LIT, and a build with no circle draws that too. So the inside sample is taken
// beyond the light pocket and inside the circle — remembered ground the circle
// alone is drawing. Both readings say so: the tile reports `r` rather than `l`,
// and it stands further off than the `V` the build reports.
//
// REVEALING GROUND THAT FAR OUT. specs/sensing.md has `V` "smaller than `R` at
// every brightness", so the forager's own light can never reach past its own
// circle: the corridor is revealed by RESTING THE FORAGER ALONG IT and then
// bringing it home. Nothing else is involved — no pulse, no flare — so this point
// turns on the mask and not on another system's claim.
//
// NO BERTH RAISES `G`. `poseMaze` empties the board of plankton, so resting the
// forager at a berth eats nothing and `G` stays at the `0` a dive opens on
// (specs/sensing.md) — so `R` and `V` hold still while the pixels are read.
//
// THE SAMPLED TILES KEEP THEIR PLANKTON. The forager grazes only the tile its own
// center is on (specs/gameplay.md), so the berths and the samples are different
// tiles and "drawn" for a corridor tile is its mote against the faint floor, read
// at the tile's center where specs/gameplay.md draws it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { poseMaze } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  visibilityOf,
  type Harness,
} from "../harness";
import { KINDLE_VISION_MIN } from "../constants";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import {
  DRAWN_FLOOR,
  MASKED_MATCH,
  fromFog,
  tileColor,
  tileFromForager,
  windowRadius,
} from "./circle";

/**
 * The board: one long corridor, and across eight tiles of solid rock a sealed
 * three-tile pocket nothing can ever reach.
 *
 * `H` is home, where the reading is taken from. `I` is the inside sample, five
 * tiles out. `M` and `F` are the two berths the forager rests at to reveal the
 * corridor, and `O` is the outside sample, eight tiles out. `S` is the fog
 * reference.
 */
const ART = ["H....IM.O..F" + " ".repeat(8) + "S.."] as const;

/** How far each sample sits from home, in tiles. */
const INSIDE_TILES = 5; // 160 units: past V (96), inside R (192)
const OUTSIDE_TILES = 8; // 256 units: past R (192)

/**
 * The sensing floor a tile inside the circle owes against the unrevealed fog, as
 * an RGB distance out of `441`.
 *
 * `8` of `441` is the level below which a sampling cannot tell a drawing from
 * eight-bit channel rounding and the host's antialiasing. Anything the build
 * painted there clears it, in whatever palette and however dim.
 *
 * What a tile BEYOND the circle owes is the other direction and the other
 * figure, {@link MASKED_MATCH}: it is painted with that fog rather than merely
 * near it.
 */
const DRAWN_MIN = DRAWN_FLOOR;

/** Ticks the forager stands at each berth, so the build has drawn what it lit. */
const SETTLE_TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The maze is drawn only inside the circle", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("H");
  const inside = board.mark("I");
  const outside = board.mark("O");
  const unlit = board.mark("S");
  // A plankton on each of the two tiles that are read, which is what a maze is
  // laid out with on every corridor tile (specs/gameplay.md) and what `poseMaze`
  // emptied the board of. Neither is ever eaten: the forager rests on its own
  // berths and never on these.
  h.debug.setPlankton(inside.tx, inside.ty, true);
  h.debug.setPlankton(outside.tx, outside.ty, true);

  // Reveal the corridor by resting the forager along it, far end first, and
  // bring it home. No berth carries a pellet, so none of them raises `G` and
  // widens the circle the next reading is taken under.
  for (const berth of [board.mark("F"), board.mark("M"), home]) {
    await parkForager(h, berth);
    await h.advance(SETTLE_TICKS);
  }
  const watch = await sceneGuard(h);
  await h.advance(SETTLE_TICKS);

  const after = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture of
  // the circle the reviewer is being told about.
  captureStill(h, "circle");

  requireSceneHeld(after, watch);

  const radius = windowRadius(after);
  const insideAt = tileFromForager(after, inside);
  const outsideAt = tileFromForager(after, outside);
  // The fixture straddles the circle this build reports, which the two assertions
  // below read off the build's own radius rather than off the figure the board was
  // drawn for.
  assertGreaterThan(
    radius,
    0,
    `the vision circle R the build reports at G = 0, which specs/sensing.md ` +
      `gives as KINDLE_VISION_MIN (${KINDLE_VISION_MIN}) and which both samples ` +
      "are judged against",
  );
  assertGreaterThan(
    insideAt,
    after.visionRadius,
    `the logical units between the forager and the inside sample ` +
      `${INSIDE_TILES} tiles out, which must exceed the light pocket V the ` +
      "build reports so that the circle rather than the light is what draws it",
  );

  // Both samples were revealed while the forager stood along the corridor, and
  // neither is lit now, so the only question left is what is DRAWN there.
  assertEqual(
    visibilityOf(after, inside),
    "r",
    `the tile at (${inside.tx}, ${inside.ty}), ${INSIDE_TILES} tiles out and ` +
      "inside the vision circle",
  );
  assertEqual(
    visibilityOf(after, outside),
    "r",
    `the tile at (${outside.tx}, ${outside.ty}), ${OUTSIDE_TILES} tiles out and ` +
      "beyond the vision circle: the circle reveals nothing and forgets nothing",
  );
  assertEqual(
    visibilityOf(after, unlit),
    "u",
    `the sealed tile at (${unlit.tx}, ${unlit.ty}), which nothing has touched`,
  );

  const fog = tileColor(h, after, unlit);
  assertGreaterThan(
    fromFog(tileColor(h, after, inside), fog),
    DRAWN_MIN,
    `the RGB distance out of 441 between the revealed tile ` +
      `${insideAt.toFixed(0)} units from the forager, inside the ` +
      `${radius.toFixed(0)}-unit vision circle, and unrevealed fog`,
  );
  assertLessThanOrEqual(
    fromFog(tileColor(h, after, outside), fog),
    MASKED_MATCH,
    `the RGB distance out of 441 between the revealed tile ` +
      `${outsideAt.toFixed(0)} units from the forager, beyond the ` +
      `${radius.toFixed(0)}-unit vision circle, and unrevealed fog`,
  );
});
