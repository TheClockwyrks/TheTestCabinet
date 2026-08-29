// standard/amber-any-distance — the amber lights show at any distance.
//
// `specs/sensing.md`, in the Standard dive: the bonus drifter and the
// Lanternjaw's bulb-light "are the maze's two amber lights, and both are drawn at
// all times and at any distance, across unrevealed fog and through rock".
// `specs/overview.md` fixes what one looks like: "a warm amber light, red-leaning
// and clearly warmer than the water, the rock, and the forager's own light".
//
// The claim has two halves and this reads both off the canvas: the mote is THERE
// at a distance no light of the forager's reaches, and it is WARM. The Kindle
// dive clips exactly this to its vision circle, so a build that carried that mask
// into the Standard dive would draw nothing here while reporting the drifter in
// `drifters` exactly as the specification asks — which is why the reading is a
// pixel one.
//
// THE MOTE IS SEARCHED FOR, NOT SAMPLED AT A POINT. A mote is drawn on a body,
// and where on that body the light sits is the build's own art: one centers the
// glow, another puts it a few units off. So the review item asks for "the
// brightest warm pixel within 12 units of its reported center", and that is what
// is read. The core of an amber light blows out toward white by design, so the
// hue test is the item's own — red above blue — rather than a match against a
// palette `specs/overview.md` leaves to the build.
//
// HOW FAR ABOVE THE FOG is the item's bound too, and it is the same `25` of `441`
// its Kindle mirror `kindle/beyond-circle` uses for the opposite verdict: a mote
// within `25` of the surrounding fog has been clipped away, and one further off
// than that is drawn. The fog it is measured against is sampled from a sealed
// pocket of this same fixture, so the reading holds whatever palette a build chose.
//
// THE DRIFTER IS HELD STILL. `setCreatureAI(false)` holds every creature exactly
// where it stands and leaves the rest of the simulation running
// (`specs/instrumentation.md`), so the mote is read where the snapshot says it is
// and this point turns on the drawing rather than on a wander it does not claim.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { VISION_GAIN, VISION_MIN } from "../constants";
import { poseMaze, visibilityAt } from "../fixtures";
import {
  MOTE_SEARCH,
  brightestWarmNear,
  captureStill,
  colorDistance,
  createHarness,
  tileColor,
  type Harness,
  type NearSample,
} from "../harness";
import {
  clearUnderfoot,
  denAllExcept,
  parkForager,
  requireSceneHeld,
  sceneGuard,
  startPlaying,
} from "../scene";

/**
 * The board: the forager's corridor, the drifter's berth `FAR_TILES` along it,
 * and across eight tiles of solid rock a sealed three-tile pocket nothing can
 * ever reach or light.
 *
 * `F` the forager, `D` the drifter, `S` the fog reference.
 */
const ART = ["F" + ".".repeat(15) + "D" + " ".repeat(8) + "S.."] as const;

/** How far the drifter is posed from the forager, in tiles. */
const FAR_TILES = 16;

/** The widest the light pocket ever opens, in logical units: `V` at `G = 1`. */
const VISION_MAX = VISION_MIN + VISION_GAIN;

/**
 * How far from the surrounding fog the mote must be drawn, as an RGB distance out
 * of `441`.
 *
 * The bound `kindle/beyond-circle` states for the same reading in the other
 * direction — "within an RGB distance of 25 of 441 of the surrounding flat fog"
 * is a light that has been clipped away — so anything further off than that is a
 * light that is drawn.
 */
const DRAWN_MIN = 25;

/** Ticks run before the reading, so the build has drawn the posed board. */
const SETTLE_TICKS = 2;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("draws a drifter's warm mote out in unrevealed fog, far past every light", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  const berth = board.mark("D");
  const unlit = board.mark("S");
  const quiet = await denAllExcept(h);

  await parkForager(h, home);
  await clearUnderfoot(h);
  await h.debug.spawnDrifter(berth.tx, berth.ty);
  // Held exactly where it was posed, so the mote is read at the position the
  // snapshot reports and nothing wanders between the two.
  await h.debug.setCreatureAI(false);
  const guard = await sceneGuard(h, quiet);

  await h.advance(SETTLE_TICKS);
  const after = await h.snapshot();
  const drifter = after.drifters[0];
  const fog = await tileColor(h, after, unlit);
  const mote =
    drifter === undefined
      ? null
      : await brightestWarmNear(h, drifter.x, drifter.y);
  // Before the assertions, so a check that fails still leaves the picture.
  await captureStill(h, "amber");

  requireSceneHeld(h, after, guard);

  assertEqual(
    after.drifters.length,
    1,
    "the drifters the maze holds after one was spawned far across the board",
  );

  // The fixture's own geometry: the drifter stands past every light the forager
  // carries at any brightness, on ground nothing has ever revealed.
  assertGreaterThan(
    Math.hypot(drifter.x - after.forager.x, drifter.y - after.forager.y),
    VISION_MAX,
    `the logical units between the forager and the drifter ${FAR_TILES} tiles ` +
      `off, which must exceed V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
  );
  assertEqual(
    visibilityAt(after, berth),
    "u",
    `the drifter's tile at (${berth.tx}, ${berth.ty}), which no light has touched`,
  );

  // And the mote itself, against this build's own fog.
  assertNotNull(
    mote,
    `a red-leaning pixel within ${MOTE_SEARCH} units of the drifter's reported ` +
      "center: the amber lights are drawn at any distance, across unrevealed fog",
  );
  assertGreaterThan(
    colorDistance((mote as NearSample).color, fog),
    DRAWN_MIN,
    "the RGB distance out of 441 between the brightest warm pixel at the distant " +
      "drifter and the unrevealed fog around it",
  );
});
