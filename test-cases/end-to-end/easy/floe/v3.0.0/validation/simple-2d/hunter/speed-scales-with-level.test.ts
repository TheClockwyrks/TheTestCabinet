// Floe — hunter/speed-scales-with-level: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.speed-scales-with-level` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear speeds up 6% a level
//
//   At levels 1, 4 and 8 both the ice speed and the swim speed are their
//   level-1 figures times 1.06^(level - 1), within 2%.
//
// Its declared media: replay `glide`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/speed-scales-with-level has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});
