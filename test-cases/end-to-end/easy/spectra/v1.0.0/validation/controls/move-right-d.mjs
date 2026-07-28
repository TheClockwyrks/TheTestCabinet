// Automated validation for the Controls sub-item `move-right-d`.
//
// Holding D moves the ship right. `specs/controls.md` binds this control to more than
// one key, and each binding is its own sub-item so a build that wires one and
// forgets another fails exactly the binding it missed. The shared item body — and
// why the family is split this way — is `moveItem` in `../_helpers.mjs`.

import { moveItem } from "../_helpers.mjs";

export default moveItem({
  id: "controls.move-right-d",
  code: "KeyD",
  direction: "right",
});
