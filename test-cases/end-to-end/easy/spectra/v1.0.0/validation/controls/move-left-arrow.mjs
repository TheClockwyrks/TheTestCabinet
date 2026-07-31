// Automated validation for the Controls sub-item `move-left-arrow`.
//
// Holding the Left arrow moves the ship left. `specs/controls.md` binds this control to more than
// one key, and each binding is its own sub-item so a build that wires one and
// forgets another fails exactly the binding it missed. The shared item body — and
// why the family is split this way — is `moveItem` in `../_helpers.mjs`.

import { moveItem } from "../_helpers.mjs";

export default moveItem({
  id: "controls.move-left-arrow",
  code: "ArrowLeft",
  direction: "left",
});
