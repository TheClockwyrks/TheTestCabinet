// Deepcore — the camera lead's rates, as specs/world.md states them.
// CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// `specs/world.md` gives the lead two rates and states both as expressions over
// the constants `../constants` carries, rather than as figures of their own:
// the lead moves toward `leadTarget` at `CAM_LEAD_MAX / CAM_LEAD_RAMP` units per
// second while the move takes it AWAY from `0`, and at `CAM_UNWIND_MULT` times
// that while the move takes it TOWARD `0`. Three of the checks beside this file
// need one or both, so the transcription lives here once rather than being
// re-derived in each of them.

import { CAM_LEAD_MAX, CAM_LEAD_RAMP, CAM_UNWIND_MULT } from "../constants";

/** Units per second the lead travels away from `0` at: 212 / 2 = 106. */
export const CAM_LEAD_RATE = CAM_LEAD_MAX / CAM_LEAD_RAMP;

/** Units per second the lead runs back toward `0` at: 4 x 106 = 424. */
export const CAM_UNWIND_RATE = CAM_LEAD_RATE * CAM_UNWIND_MULT;
