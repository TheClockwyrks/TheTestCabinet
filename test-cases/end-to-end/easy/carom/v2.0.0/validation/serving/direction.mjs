// Automated validation for the base variant's Serving sub-item `direction`.
//
// After a point the next serve travels toward the player who was just scored on
// (the receiver), and the very first serve of a match always goes to the same side
// (player one / left). The shared helper launches real serves and reads the ball's
// horizontal direction; only the verdict id differs from gyre's copy. See
// validation/_helpers.mjs.

import { serveDirectionCheck } from "../_helpers.mjs";

export default async function drive(api) {
  const { pass, note } = await serveDirectionCheck(api);
  return {
    verdicts: { "serving.direction": pass },
    notes: { "serving.direction": note },
  };
}
