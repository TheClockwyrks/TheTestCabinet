// Automated validation for the Single Player Controls sub-item `up`.
//
// In Solo the human controls player one (the left paddle). Holding the Up arrow
// must move that paddle up (its center y decreases). The match is started from the
// title with injected keys — so the game stays under normal keyboard control — then
// the Up arrow is held and the real update moves the paddle, which the snapshot
// reads back. See validation/_helpers.mjs.

import { moveCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls-solo.up");
  await moveCheck(api, check, {
    mode: "solo",
    side: "left",
    code: "ArrowUp",
    up: true,
    who: "the left paddle (player one)",
  });
  return check.verdict();
}
