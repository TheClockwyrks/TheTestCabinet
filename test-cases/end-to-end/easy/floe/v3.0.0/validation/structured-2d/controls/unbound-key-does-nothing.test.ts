// Floe — controls/unbound-key-does-nothing: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `controls.unbound-key-does-nothing` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   An unbound key changes nothing
//
//   A key bound to no action, driven during a live crossing on a strait posed
//   with no lane items, leaves every snapshot field but simTime exactly as it
//   was.
//
// Its declared media: image `after`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("controls/unbound-key-does-nothing has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});
