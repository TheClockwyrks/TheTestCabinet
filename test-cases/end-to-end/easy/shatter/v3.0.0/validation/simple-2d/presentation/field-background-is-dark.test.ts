// presentation/field-background-is-dark — the field reads as deep space.
//
// THE RULE. `specs/overview.md`: "The field is dark. Sampled clear of every body,
// its background reads as deep space: the luminance of that background is below a
// quarter of full." It is the one colour bound the specification states as a
// requirement in its own right, and the only one this whole group asserts: every
// other item here measures a distance FROM whatever background the build chose, so
// this is the one that has to pin the background down.
//
// WHERE IT IS SAMPLED. `BARE_POINTS` (`scene.ts`): five points spread across the
// field, all clear of the star's whole drawn extent (nothing of it is drawn beyond
// `1.5 x HALO_R`, `specs/field.md`), clear of the safe point the ship sits at, and
// clear of the upper portion the HUD is drawn in (`specs/ui.md`). A field posed by
// `startPlaying` holds no rock, no shot and no saucer, so those five points are bare
// in the sense the rule means.
//
// AND WHY THE MIDDLE READING DECIDES IT. `specs/overview.md` leaves what the field
// looks like behind the bodies to the build — a starfield, a nebula, a watermark are
// all its to draw — so one bright decoration falling on one of five points must not
// fail a field that is otherwise deep space. The median is what survives that and
// still fails the thing the rule is against: a field that simply is not dark reads
// bright at every one of the five and has no darker point to hide behind.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { luminance, readPainted } from "./ink";
import { medianField } from "./scene";

/**
 * A quarter of full luminance, out of the 255 a channel spans.
 *
 * The specification's own figure, converted once: "below a quarter of full" over a
 * reading whose channels run `0` to `255`. No tolerance is added — a bound the
 * specification states as a number is asserted as that number.
 */
const DARK_LIMIT = 0.25 * 255;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a field whose background is below a quarter of full luminance", async () => {
  startPlaying(h);
  // One tick, so what the canvas holds is the posed, emptied field.
  await h.advance(1);

  const field = medianField(readPainted(h));
  captureStill(h, "field");

  assertLessThan(
    luminance(field),
    DARK_LIMIT,
    "the luminance of the field's background, out of 255, sampled clear of every body (specs/overview.md)",
  );
});
