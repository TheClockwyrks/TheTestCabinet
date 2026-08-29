// kindle/predators-by-light — predators are drawn by the light, not the circle.
//
// specs/sensing.md, of the vision circle: "Predators are not governed by it. A
// predator is drawn by the light pocket below, by a sonar mark, by a flare and by
// its own detection alert, and the vision circle draws none." specs/state.md:
// `lit` is "true while its body is being drawn this instant, whether by the
// forager's light, a sonar mark, a flare, or its own alert."
//
// So the circle governs the maze and the light governs the hunters, and the one
// place those two answers differ is the band between `V` and `R`. A hunter posed
// there is inside the circle and outside the light: it must report `lit` false
// and draw nothing. Then the same hunter is brought inside `V` with the corridor
// straight between them, and must report `lit` true.
//
// BOTH HALVES ARE REQUIRED. On its own "it is not drawn" is satisfied by a build
// that never draws a predator at all — including one whose snapshot simply always
// reports `lit: false` — so the point could be earned for the wrong reason. The
// second reading is what says the LIGHT is what decides.
//
// THE GLOAMFIN IS THE HUNTER for this, and the choice matters. The Lanternjaw
// carries a bulb-light, which is one of the two amber lights and IS clipped to
// the circle rather than to the light pocket (specs/sensing.md), so a Lanternjaw
// standing in this band draws an amber mote legitimately. The Flarefish blooms.
// The Gloamfin produces no light of its own, so what is drawn where it stands is
// exactly what this point is asking about.
//
// THE ONE HUNTER'S MIND IS OFF. `setPredatorMind(index, false)` holds that
// predator exactly where it stands, "keeping the tile, facing and `state` it was
// posed with", and leaves everything else in the game running
// (specs/instrumentation.md) — so the hunter is read at the distance it was posed
// at rather than wherever a chase took it, and the forager's light still falls
// where it falls.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  brightestNear,
  captureStill,
  colorDistance,
  createHarness,
  type Harness,
  sampleColorAtTile,
  startPlaying,
  visibilityAt,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { FOG_MATCH, windowRadius } from "./circle";

/**
 * The board: one straight corridor, and across eight tiles of solid rock a sealed
 * three-tile pocket nothing can ever reach.
 *
 * `F` is the forager, `P` the far berth `BAND_TILES` along the corridor, `N` the
 * near berth inside the light pocket, and `S` the fog reference.
 */
const ART = [".FN..P." + " ".repeat(8) + "S.."] as const;

/** How far the far berth stands from the forager, in tiles. */
const BAND_TILES = 4; // 128 units: past V (96), inside R (192)

/** How far the near berth stands from it, in tiles. */
const LIT_TILES = 1; // 32 units, well inside V

/** The review item's bound on "draws no body", as an RGB distance out of `441`. */
const NO_BODY_MAX = FOG_MATCH;

/** Ticks between posing the hunter and reading what the build drew for it. */
const SETTLE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Predators are drawn by the light, not the circle", async () => {
  startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  const band = board.mark("P");
  const close = board.mark("N");
  const unlit = board.mark("S");

  // One hunter, held where it was posed: this point is about what is DRAWN at a
  // distance, not about where a hunter goes next.
  const gloamfin = await spawnPredator(h, "gloamfin", band, { mind: false });
  await parkForager(h, home);
  const guard = await sceneGuard(h);

  await h.advance(SETTLE_TICKS);
  const beyondLight = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture of the
  // hunter that should not be there.
  captureStill(h, "bylight");

  requireSceneHeld(beyondLight, guard);

  const hunter = beyondLight.predators[gloamfin];
  const gap = Math.hypot(
    hunter.x - beyondLight.forager.x,
    hunter.y - beyondLight.forager.y,
  );
  const radius = windowRadius(beyondLight);
  // The band this point lives in has to exist on this build, or there is nothing
  // here to decide.
  if (gap >= radius || gap <= beyondLight.visionRadius) {
    fail(
      "the two radii to take the values specs/sensing.md gives them, so a hunter " +
        `${BAND_TILES} tiles off stands inside the vision circle R and beyond the ` +
        "light pocket V",
      `the hunter stood ${gap.toFixed(1)} units off, with V reported as ` +
        `${beyondLight.visionRadius.toFixed(1)} and R as ${radius.toFixed(1)}`,
    );
  }
  assertLessThan(
    gap,
    radius,
    "the logical units between the forager and the hunter, against the vision " +
      "circle R it stands inside",
  );
  assertGreaterThan(
    gap,
    beyondLight.visionRadius,
    "the same distance against the light pocket V it stands outside",
  );

  // Inside the circle, outside the light: nothing of it is drawn.
  assertEqual(
    hunter.lit,
    false,
    `the Gloamfin's \`lit\` while it stands ${gap.toFixed(0)} units off, inside ` +
      "the vision circle and beyond the light pocket",
  );
  assertEqual(
    visibilityAt(beyondLight, band),
    "u",
    `the hunter's tile at (${band.tx}, ${band.ty}), which no light has revealed`,
  );
  const fog = sampleColorAtTile(h, beyondLight, unlit);
  assertLessThanOrEqual(
    colorDistance(brightestNear(h, hunter.x, hunter.y).color, fog),
    NO_BODY_MAX,
    "the RGB distance out of 441 between the brightest pixel drawn where the " +
      "hunter stands and the unrevealed fog around it: the circle draws no predator",
  );

  // And inside the light, with the corridor straight between them, it is.
  h.debug.setPredatorTile(gloamfin, close.tx, close.ty);
  await h.advance(SETTLE_TICKS);
  const inLight = h.snapshot();
  const near = inLight.predators[gloamfin];
  const closeGap = Math.hypot(
    near.x - inLight.forager.x,
    near.y - inLight.forager.y,
  );
  assertLessThan(
    closeGap,
    inLight.visionRadius,
    `the logical units between the forager and the hunter brought back to ` +
      `${LIT_TILES} tile, against the light pocket V`,
  );
  assertEqual(
    near.lit,
    true,
    "the Gloamfin's `lit` inside the light pocket with clear line of sight: the " +
      "light is what draws a hunter",
  );
});
