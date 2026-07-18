// Automated validation for the Single Player Controls sub-item `s`.
//
// Holding the S key must move the left paddle down (its center y increases). The
// match is started from the title with injected keys so the game stays under normal
// keyboard control, then the key is held and the real update moves the paddle, which
// the snapshot reads back. See validation/_helpers.mjs.

import { moveCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls-solo.s");
  await moveCheck(api, check, {
    mode: "solo",
    side: "left",
    code: "KeyS",
    up: false,
    who: "the left paddle (player one)",
  });
  return check.verdict();
}
