// Automated validation for the Single Player Controls sub-item `w`.
//
// Holding the W key must move the left paddle UP (its center y changes accordingly). The
// match is started from the title with injected keys so the game stays under normal
// keyboard control, then the key is held and the real update moves the paddle, which
// the snapshot reads back. See validation/_helpers.mjs.

import { startWithKeys, holdMove } from "../_helpers.mjs";

const MOVE_MIN = 40; // a clearly non-trivial displacement, in logical px

export default async function drive(api) {
  await startWithKeys(api, "solo");
  const r = await holdMove(api, "left", "KeyW");
  const pass = r.delta < -MOVE_MIN;
  return {
    verdicts: { "controls-solo.w": pass },
    notes: {
      "controls-solo.w": `the left paddle cy ${r.start.toFixed(0)} -> ${r.end.toFixed(0)} (delta ${r.delta.toFixed(0)}, expected up/negative)`,
    },
  };
}
