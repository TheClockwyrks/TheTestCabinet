// lanternjaw/bulb-visible — its bulb shows at any distance.
//
// specs/predators/lanternjaw.md: the bulb "is one of the amber lights of the maze,
// shown under the amber-light rule `specs/sensing.md` fixes, so it shows in the
// dark even while the Lanternjaw's body is unlit and its tile is unrevealed".
// specs/sensing.md fixes that rule for this dive: the two amber lights "are drawn
// at all times and at any distance, across unrevealed fog and through rock".
// specs/overview.md says how one reads: "a warm amber light, red-leaning and
// clearly warmer than the water, the rock, and the forager's own light".
//
// So the scenario has to put a Lanternjaw somewhere nothing is drawing it, confirm
// from the snapshot that nothing is, and then read the pixels off the frame the
// build painted.
//
// FIVE TILES APART, AND THE DISTANCE IS THE WHOLE POINT. The pair used to be stood
// two tiles apart with rock between, taking its darkness from occlusion alone. Two
// tiles is 64 units, well inside the forager's own light pocket (`V` is
// `VISION_MIN` (96) at `G = 0`), and specs/overview.md entitles a build to paint
// that pocket as "a cool glow around it" rather than a hard disc. One build's glow
// washed over the bulb and the sample came back green, so a build drawing a
// perfectly good amber bulb was failed for the trench around it. Five tiles is 160
// units: past the pocket at any brightness this scenario uses, and still inside the
// `KINDLE_VISION_MIN` (192) circle the kindle dive carries, so the bulb is drawn in
// both dives and read over ground nothing else is lighting.
//
// AND THE READING IS RELATIVE TO A FOG SAMPLE THE CHECK TOOK ITSELF. The palette is
// the build's, so what "well above the surrounding fog" means is measured against
// this build's own fog, three tiles along the same sealed corridor.
//
// WHAT THIS DOES NOT DECIDE. Whether the bulb reads the SAME as a drifter's is
// `amber/lookalikes`'s; what the body does when the light reaches it is
// `lanternjaw/additive-reveal`'s.

import { afterEach, beforeEach } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import { poseOccludedPair } from "../fixtures";
import {
  captureStill,
  createHarness,
  luminance,
  sampleMoteProfile,
  sampleTile,
  startPlaying,
  visibilityOf,
  type Harness,
} from "../harness";
import {
  check,
  clearUnderfoot,
  denAll,
  parkForager,
  requireKind,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import { brightestWarm, warm } from "./motes";
import type { Tile } from "../maze";

/** How far apart the pair stands, in tiles. See the header. */
const GAP_TILES = 5;

/** How much corridor each of them stands on, in tiles. */
const RUN_TILES = 5;

/** How far along the hunter's own corridor the fog is sampled, in tiles. */
const FOG_OFFSET = 3;

/**
 * How far above the surrounding fog the bulb must read, as a mean channel out of
 * 255.
 *
 * specs/overview.md caps unrevealed fog at "a tenth of full brightness", which is
 * 25.5 of 255, and leaves everything else about the palette to the build. So the
 * fog this check sampled sits somewhere in `[0, 25.5]`, and a light that clears it
 * by that whole permitted range cannot be one shade of fog against another however
 * a build tints its dark. That is the margin: a bulb the fog could not account for.
 */
const ABOVE_FOG = 25.5;

/** Ticks run before the reading, so the posed board has been painted. */
const SETTLE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check("Its bulb shows at any distance", async () => {
  await startPlaying(h);
  const pair = await poseOccludedPair(h, {
    tiles: GAP_TILES,
    len: RUN_TILES,
  });
  const index = requireKind(h.snapshot(), "lanternjaw");
  const quiet = await denAll(h, [index]);
  await h.debug.setPredatorTile(index, pair.pred.tx, pair.pred.ty);
  await h.debug.setPredatorState(index, "wander");
  await parkForager(h, pair.forager);
  // The pellet the pose left under the forager is settled and `G` put back to
  // zero, so the light pocket is the narrowest a dive ever carries and the
  // reading is taken over ground nothing has touched.
  await clearUnderfoot(h);
  // Held exactly where it was posed for the one frame that is read: this point
  // is about what is DRAWN at a reported position, and a hunter that drifted
  // between the snapshot and the sample would be read half a body away from
  // where it said it was.
  await h.debug.setCreatureAI(false);
  const watch = await sceneGuard(h, quiet);

  await h.advance(SETTLE_TICKS);
  const snapshot = h.snapshot();
  const bulb = snapshot.predators[index];
  const fogTile: Tile = { tx: pair.pred.tx + FOG_OFFSET, ty: pair.pred.ty };
  const fog = sampleTile(h, snapshot, fogTile);
  const profile = sampleMoteProfile(h, bulb.x, bulb.y);
  const found = brightestWarm(profile);
  // Before the assertions, so a check that fails still leaves the picture that
  // shows the reviewer what was and was not drawn out there.
  captureStill(h, "bulb");

  requireSceneHeld(snapshot, watch);

  // The fixture's own claim: the hunter stands on ground nothing has revealed,
  // and the fog it is read against is equally untouched.
  assertEqual(
    visibilityOf(snapshot, { tx: bulb.tx, ty: bulb.ty }),
    "u",
    `the visibility of the tile the Lanternjaw stands on, (${bulb.tx}, ${bulb.ty}), ` +
      "which no light, pulse or flare has reached",
  );
  assertEqual(
    visibilityOf(snapshot, fogTile),
    "u",
    `the visibility of the tile the fog is sampled from, (${fogTile.tx}, ${fogTile.ty})`,
  );
  assertEqual(
    bulb.lit,
    false,
    "whether the Lanternjaw's body is being drawn this instant, which nothing " +
      "out here is doing (specs/predators.md)",
  );

  // And what the build DREW there.
  assertNotNull(
    found,
    "a warm sample somewhere in the Lanternjaw's mote profile — its red channel " +
      `above its blue — searched within 12 units of the (${bulb.x.toFixed(0)}, ` +
      `${bulb.y.toFixed(0)}) it reports itself at`,
  );
  const sample = found as NonNullable<typeof found>;
  assertEqual(
    warm(sample.color),
    true,
    `the brightest warm sample of the bulb's profile reads red-leaning: ` +
      `r ${sample.color.r.toFixed(0)} against b ${sample.color.b.toFixed(0)}`,
  );
  assertGreaterThanOrEqual(
    luminance(sample.color) - luminance(fog),
    ABOVE_FOG,
    `the mean channels the bulb stands above the unrevealed fog beside it: ` +
      `${luminance(sample.color).toFixed(1)} at radius ${sample.radius} against ` +
      `${luminance(fog).toFixed(1)} of fog, out of 255`,
  );
});
