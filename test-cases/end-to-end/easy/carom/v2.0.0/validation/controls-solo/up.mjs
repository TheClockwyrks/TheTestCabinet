// Automated validation for the Single Player Controls sub-item `up`.
//
// In Solo the human controls player one (the left paddle). Holding the Up arrow
// must move that paddle UP (its center y decreases). The match is started from the
// title with injected keys — so the game stays under normal keyboard control — then
// the Up arrow is held and the real update moves the paddle, which the snapshot
// reads back. See validation/_helpers.mjs.

import { startWithKeys, holdMove } from "../_helpers.mjs";

const MOVE_MIN = 40; // a clearly non-trivial displacement, in logical px

export default async function drive(api) {
  await startWithKeys(api, "solo");
  const r = await holdMove(api, "left", "ArrowUp");
  const pass = r.delta < -MOVE_MIN;
  return {
    verdicts: { "controls-solo.up": pass },
    notes: {
      "controls-solo.up": `left paddle cy ${r.start.toFixed(0)} -> ${r.end.toFixed(0)} (delta ${r.delta.toFixed(0)}, expected up/negative)`,
    },
  };
}
