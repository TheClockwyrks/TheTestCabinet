// Automated validation for the Controls sub-item `fire-up`.
//
// The Up arrow fires a bullet of the ship's current band. `specs/controls.md` binds this control to more than
// one key, and each binding is its own sub-item so a build that wires one and
// forgets another fails exactly the binding it missed. The shared item body — and
// why the family is split this way — is `fireItem` in `../_helpers.mjs`.

import { fireItem } from "../_helpers.mjs";

export default fireItem({
  id: "controls.fire-up",
  code: "ArrowUp",
});
