// Automated validation for the Controls sub-item `pause-esc`.
//
// Esc pauses a live wave. `specs/controls.md` binds this control to more than
// one key, and each binding is its own sub-item so a build that wires one and
// forgets another fails exactly the binding it missed. The shared item body — and
// why the family is split this way — is `pauseItem` in `../_helpers.mjs`.

import { pauseItem } from "../_helpers.mjs";

export default pauseItem({
  id: "controls.pause-esc",
  code: "Escape",
});
