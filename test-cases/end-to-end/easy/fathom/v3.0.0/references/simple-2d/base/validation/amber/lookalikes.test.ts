// amber/lookalikes — a drifter and a Lanternjaw's bulb read alike.
//
// specs/gameplay.md: "A drifter shows in the dark as a single glowing amber mote.
// A wandering Lanternjaw's bulb-light is drawn as the same mote ... so the two are
// alike in look and in motion and one glimmer cannot be told from the other at a
// glance." specs/predators/lanternjaw.md says it in the other direction: "The bulb
// is drawn identically to the bonus drifter's: the same amber glow at the same
// place on the body." specs/overview.md fixes what an amber light reads as: "a
// warm amber light, red-leaning and clearly warmer than the water, the rock, and
// the forager's own light. The two read as near-identical lights."
//
// BOTH ARE POSED OUT IN THE FOG, AT THE SAME DISTANCE. The fixture puts the
// forager alone on its own tile and the two lights on two sealed tiles five tiles
// away — exactly `5 * TILE` (160 units) from the forager in both cases. Five tiles
// is past the widest the forager's light reaches at the brightness this scenario
// holds it at, so neither light is being read over a lit pocket, and it is inside
// the kindle dive's vision circle at that same brightness, so the comparison is
// like for like in both dives. The two sit four tiles apart from each other, far
// enough that neither neighbourhood can pick up the other's glow.
//
// EACH CREATURE'S MIND IS OFF, AND THERE ARE ONLY THE TWO OF THEM.
// `poseMaze` clears the roster, the drifters and the plankton, so the board holds
// the forager, the one Lanternjaw this check spawns and the one drifter it spawns.
// `setPredatorMind(index, false)` and `setDrifterMind(index, false)` each hold
// their own creature "exactly where it stands, keeping the tile, facing and state
// it was posed with" (specs/instrumentation.md) while everything else runs, so the
// Lanternjaw stays a wandering Lanternjaw on the tile the comparison was set up on
// and the drifter stays beside it. What is being compared is how the two are
// DRAWN, and nothing about that needs either of them to move.
//
// EACH MOTE IS SEARCHED FOR, NOT SAMPLED AT A POINT. Where on a body the glow sits
// is the build's art — one draws it on the creature's center, another as a bulb at
// the top of a bell — so each reading is the brightest WARM pixel within
// `MOTE_SEARCH` of the position the snapshot reports, which is the reading the
// review item states. Warm rather than merely brightest, because an amber core
// blows out toward white by design and the hue reads in the halo around it: the
// brightest pixel of a perfectly good amber mote is often a neutral white one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { poseMaze, spawnDrifter, spawnPredator } from "../fixtures";
import {
  brightestWarmNear,
  captureStill,
  centerOf,
  colorDistance,
  createHarness,
  MOTE_SEARCH,
  sampleRing,
  startPlaying,
  visibilityOf,
  type Harness,
  type Rgb,
} from "../harness";
import { Tile } from "../maze";
import {
  fromForager,
  parkForager,
  requireSceneHeld,
  sceneGuard,
} from "../scene";

/**
 * The board: the forager alone on `F`, the Lanternjaw's tile `A` five tiles due
 * right of it, and the drifter's tile `B` five tiles away on the diagonal, four
 * tiles from `A`. Every tile is sealed off by rock, so nothing can travel.
 */
const ART = ["    B ", "      ", "      ", "F    A"] as const;

/** How far below the Lanternjaw's tile the fog is sampled, in tiles. */
const FOG_BELOW = 2;

/** Ticks run after the pose, so there is a painted frame to read. */
const SETTLE_TICKS = 2;

/**
 * How far apart the two amber lights may be drawn, as an RGB distance.
 *
 * The review item's own bound: `40` of the `441` (`sqrt(3) * 255`) that separates
 * black from white. specs/gameplay.md fixes only that "one glimmer cannot be told
 * from the other at a glance", so the figure is the point's, not the
 * specification's, and it is wide enough for a build that draws the two on
 * slightly different bodies.
 */
const ALIKE_MAX = 40;

/**
 * How far each mote must stand from the fog around it, as an RGB distance.
 *
 * The same `40`, used as a floor rather than a ceiling: two colors inside this
 * point's own "alike" bound are, by its own standard, not told apart — so a light
 * that close to the fog it sits in is not a light. specs/overview.md asks for
 * exactly this comparison, "clearly warmer than the water, the rock", and fixes no
 * number for it.
 */
const ABOVE_FOG_MIN = ALIKE_MAX;

/**
 * The brightest WARM pixel within `MOTE_SEARCH` (12) of a reported position,
 * falling back to the pixel at that position when the neighbourhood holds nothing
 * warm — so a build that draws no mote is read exactly where it should have drawn
 * one.
 *
 * The search itself is the harness's, shared with every other reading of an amber
 * light in the suite, so this point and the ones that read the same two motes
 * cannot disagree about where a mote is or what counts as one.
 */
function moteAt(h: Harness, x: number, y: number): Rgb {
  return brightestWarmNear(h, x, y)?.color ?? sampleRing(h, x, y, 0);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A drifter and a Lanternjaw's bulb read alike", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  const bulbTile = board.mark("A");
  const driftTile = board.mark("B");
  await parkForager(h, home);

  // One Lanternjaw and one drifter, each held where it is put: this point reads
  // two lights standing still side by side, and nothing else is on the board.
  const lantern = await spawnPredator(h, "lanternjaw", bulbTile, {
    state: "wander",
    mind: false,
  });
  await spawnDrifter(h, driftTile, { mind: false });
  const watch = await sceneGuard(h);

  await h.advance(SETTLE_TICKS);
  const after = h.snapshot();
  captureStill(h, "amber");

  requireSceneHeld(after, watch);
  assertEqual(
    after.drifters.length,
    1,
    "the bonus drifters on the board, which the pose spawned one of",
  );

  const drifter = after.drifters[0];
  const hunter = after.predators[lantern];
  const fogTile: Tile = { tx: bulbTile.tx, ty: bulbTile.ty + FOG_BELOW };

  // The fixture's own geometry: both lights stand out in fog the forager's
  // light does not reach.
  for (const [name, tile] of [
    ["the Lanternjaw's", bulbTile],
    ["the drifter's", driftTile],
    ["the fog sample's", fogTile],
  ] as const) {
    assertEqual(
      visibilityOf(after, tile),
      "u",
      `${name} tile (${tile.tx}, ${tile.ty}), which no light has touched`,
    );
  }
  for (const [name, body] of [
    ["the Lanternjaw", hunter],
    ["the drifter", drifter],
  ] as const) {
    assertGreaterThan(
      fromForager(after, body.x, body.y),
      after.visionRadius,
      `how far ${name} stands from the forager, against the light radius V it ` +
        `reports`,
    );
  }

  const fogAt = centerOf(after, fogTile);
  const fog = sampleRing(h, fogAt.x, fogAt.y, 0);
  const bulb = moteAt(h, hunter.x, hunter.y);
  const drift = moteAt(h, drifter.x, drifter.y);

  for (const [name, mote] of [
    ["the Lanternjaw's bulb", bulb],
    ["the drifter's mote", drift],
  ] as const) {
    assertGreaterThan(
      mote.r,
      mote.b,
      `the red channel of ${name}, the brightest warm pixel within ` +
        `${MOTE_SEARCH} units of the position the snapshot reports it at`,
    );
    assertGreaterThan(
      colorDistance(mote, fog),
      ABOVE_FOG_MIN,
      `how far ${name} stands from the flat fog around it, of 441`,
    );
  }

  assertLessThanOrEqual(
    colorDistance(bulb, drift),
    ALIKE_MAX,
    "how far the Lanternjaw's bulb and the drifter's mote are drawn apart, " +
      "of 441",
  );
});
