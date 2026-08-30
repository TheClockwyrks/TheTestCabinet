// Floe — bays/filled-stays-filled: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.filled-stays-filled` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A filled bay stays filled
//
//   A bay filled by a hop is still filled after a second crossing fills a
//   different bay.
//
// Its declared media: replay `fill`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/filled-stays-filled has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});
