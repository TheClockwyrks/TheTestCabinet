// Automated validation for the Gameplay sub-item `serve-direction`.
//
// After a point the next serve travels toward the player who was just scored on (the
// receiver), and the very first serve of a match always goes to the same side (player
// one / left). The shared helper launches real serves and reads the ball's horizontal
// direction, recording one assertion per rule. base and gyre both serve toward the
// receiver, so both variants add this point to the common Gameplay category and drive
// this same script; multi (random-angle launches) declares it for neither. See
// validation/_helpers.mjs.

import { asserter, serveDirectionCheck } from "../_helpers.mjs";

export default async function drive(api) {
  const rec = asserter();
  await serveDirectionCheck(api, rec);
  return { verdicts: { "gameplay.serve-direction": rec.assertions } };
}
