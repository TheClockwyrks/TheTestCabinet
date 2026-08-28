// fog/unrevealed-black — unrevealed maze is flat dark fog.
//
// specs/sensing.md gives an unrevealed tile one drawing: "the flat unrevealed fog
// specs/overview.md fixes, which reads the same over rock as over open water".
// Two things follow, and this check reads both off the canvas the build actually
// painted. The fog is DARK, and it does not LEAK THE LAYOUT: a rock tile and a
// corridor tile that are both unrevealed are drawn alike, so a player cannot see
// the shape of a passage it has never lit.
//
// The pair is POSED. On a build's own maze there is no telling which tiles the
// forager's spawn already lit, nor whether a rock tile and a corridor tile can be
// found side by side outside that pocket. `poseDarkPatch` stamps a small room for
// the forager and, across eight tiles of solid rock, a sealed three-tile corridor
// nothing can ever reach: the corridor tile at its middle and the rock tile
// directly above it are both a long way outside every light in the game, and
// `setMaze` puts the fog back to fully unrevealed (specs/instrumentation.md), so
// their visibility is `u` by construction and the check confirms it before it
// reads a pixel.
//
// THE PALETTE IS NOT ASSERTED. specs/overview.md leaves the colors to the build;
// what is fixed is that the fog is flat and dark, and both bounds below are the
// review item's own: no brighter than a tenth of full brightness, and the two
// samples within 25 of the 441 an RGB distance can reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertNull } from "../assert";
import { poseDarkPatch } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  luminance,
  sampleTile,
  startPlaying,
  visibilityOf,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  graded,
  sceneGuard,
  sceneHeld,
} from "../scene";

/** The review item's ceiling: a tenth of full brightness, per channel. */
const DARK_MAX = 0.1 * 255;

/** The review item's bound on how far apart the two fogged tiles may be drawn. */
const ALIKE_MAX = 25;

/**
 * Tiles of solid rock between the forager's room and the fogged pocket.
 *
 * Eight tiles is `8 * TILE` (256 logical units), past the largest circle the
 * forager carries at any brightness: `V` reaches `VISION_MIN + VISION_GAIN`
 * (160) at `G = 1` (specs/sensing.md), and under `kindle` the outer vision circle
 * reaches `KINDLE_VISION_MIN + KINDLE_VISION_GAIN`. The pocket is sealed off by
 * rock as well, so no light travels to it however the build traces one.
 */
const SEALED_GAP = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Unrevealed maze is flat dark fog", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const patch = await poseDarkPatch(h, { gap: SEALED_GAP });
    const quiet = await denAll(h);
    // The pellet the pose left under the forager is eaten off camera and the
    // brightness put back to zero, so the light pocket around the forager is the
    // one a dive opens with rather than one this scenario's setup widened.
    await clearUnderfoot(h);
    const watch = await sceneGuard(h, quiet);

    // One frame, so there is a painted picture to read. The fogged pocket is
    // sealed and eight tiles of rock away, so nothing about this frame reaches it.
    await h.advance(1);
    const after = h.snapshot();
    captureStill(h, "fog");

    assertNull(sceneHeld(after, watch), "the scenario held to the end");

    assertEqual(
      visibilityOf(after, patch.dark),
      "u",
      `the corridor tile at (${patch.dark.tx}, ${patch.dark.ty}), which no light reaches`,
    );
    assertEqual(
      visibilityOf(after, patch.darkRock),
      "u",
      `the rock tile at (${patch.darkRock.tx}, ${patch.darkRock.ty}), which no light reaches`,
    );

    const corridor = sampleTile(h, after, patch.dark);
    const rock = sampleTile(h, after, patch.darkRock);
    assertLessThanOrEqual(
      luminance(corridor),
      DARK_MAX,
      "the unrevealed corridor tile's drawn brightness",
    );
    assertLessThanOrEqual(
      luminance(rock),
      DARK_MAX,
      "the unrevealed rock tile's drawn brightness",
    );
    assertLessThanOrEqual(
      colorDistance(corridor, rock),
      ALIKE_MAX,
      "how far apart the two unrevealed tiles are drawn",
    );
  });
});
