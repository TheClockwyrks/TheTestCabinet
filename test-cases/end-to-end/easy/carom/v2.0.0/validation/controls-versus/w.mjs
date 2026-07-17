// Automated validation for the Multi Player Controls sub-item `w`.
//
// Holding the W key must move player one's (left) paddle UP (its center y changes accordingly). The
// match is started from the title with injected keys so the game stays under normal
// keyboard control, then the key is held and the real update moves the paddle, which
// the snapshot reads back. See validation/_helpers.mjs.

import { startWithKeys, holdMove } from "../_helpers.mjs";

const MOVE_MIN = 40; // a clearly non-trivial displacement, in logical px

export default async function drive(api) {
  await startWithKeys(api, "versus");
  const r = await holdMove(api, "left", "KeyW");
  const pass = r.delta < -MOVE_MIN;
  return {
    verdicts: { "controls-versus.w": pass },
    notes: {
      "controls-versus.w": `player one's (left) paddle cy ${r.start.toFixed(0)} -> ${r.end.toFixed(0)} (delta ${r.delta.toFixed(0)}, expected up/negative)`,
    },
  };
}
