// Automated validation for the Single Player Controls sub-item `s`.
//
// Holding the S key must move the left paddle DOWN (its center y changes accordingly). The
// match is started from the title with injected keys so the game stays under normal
// keyboard control, then the key is held and the real update moves the paddle, which
// the snapshot reads back. See validation/_helpers.mjs.

import { startWithKeys, holdMove } from "../_helpers.mjs";

const MOVE_MIN = 40; // a clearly non-trivial displacement, in logical px

export default async function drive(api) {
  await startWithKeys(api, "solo");
  const r = await holdMove(api, "left", "KeyS");
  const pass = r.delta > MOVE_MIN;
  return {
    verdicts: { "controls-solo.s": pass },
    notes: {
      "controls-solo.s": `the left paddle cy ${r.start.toFixed(0)} -> ${r.end.toFixed(0)} (delta ${r.delta.toFixed(0)}, expected down/positive)`,
    },
  };
}
