// Floe — bays/fish-is-alone: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.fish-is-alone` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   At most one bonus catch is out
//
//   Over sixty seconds of a live crossing with the cadence on, fishBay is
//   never two bays at once and the count of fish on the strait never exceeds
//   one.
//
// Its declared media: image `fish`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/fish-is-alone has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});
