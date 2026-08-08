// Automated validation for the Controls sub-item `flip-shift-right`.
//
// Right Shift flips the ship's band. `specs/controls.md` binds this control to more than
// one key, and each binding is its own sub-item so a build that wires one and
// forgets another fails exactly the binding it missed. The shared item body — and
// why the family is split this way — is `flipItem` in `../_helpers.mjs`.

import { flipItem } from "../_helpers.mjs";

export default flipItem({
  id: "controls.flip-shift-right",
  code: "ShiftRight",
});
