// Automated validation for the Multi Player Controls sub-item `w`.
//
// In Versus, player one drives the left paddle with W/S. Holding the W key must move
// that paddle up (its center y decreases). The match is started from the title with
// injected keys so the game stays under normal keyboard control, then the key is held
// and the real update moves the paddle, read back from the snapshot. See
// validation/_helpers.mjs.

import { moveCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls-versus.w");
  await moveCheck(api, check, {
    mode: "versus",
    side: "left",
    code: "KeyW",
    up: true,
    who: "player one's left paddle",
    isolate: "right",
  });
  return check.verdict();
}
