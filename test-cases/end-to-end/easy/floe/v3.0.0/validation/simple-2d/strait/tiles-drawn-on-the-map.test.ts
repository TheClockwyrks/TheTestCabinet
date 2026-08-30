// Floe — strait/tiles-drawn-on-the-map: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `strait.tiles-drawn-on-the-map` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The critter is drawn where the map puts it
//
//   On those same eight tiles the critter is drawn within half a tile of the
//   centre the map gives. Reporting the right centre and drawing at it fail
//   independently, so they are two items: a build that reports correctly and
//   draws a few units off is entirely playable, which is why this half is
//   presentation and scuffed rather than crossing and broken.
//
// Its declared media: image `tiles`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("strait/tiles-drawn-on-the-map has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});
