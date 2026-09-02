// Spectra — stages/ramps: the four scaling formulas of specs/stages.md, restated
// on the VALIDATOR's side. LOCAL TO THIS GROUP.
//
// WHY THIS FILE EXISTS AT ALL. Every other figure a suite in this project needs is
// imported from the build's seeded `src/constants.ts`, which is the case's own
// file and the one `specs/overview.md` tells the build is authoritative. That is
// the right source for the geometry a scenario is POSED from — a slot's centre,
// the fire line, the field's edges — because nothing there is what the check is
// grading.
//
// It is the wrong source for the four RAMPS. A build is free to leave
// `src/constants.ts` exactly as it was seeded and still run its simulation off a
// formula of its own — one step out, say, `1 + 0.06 * stage` where the
// specification says `1 + 0.06 * (stage - 1)`. A check that read the ramp back off
// the snapshot and compared it against the seeded function would agree with such a
// build twice over: the reported figure IS the seeded formula, and the simulation
// the reviewer cares about is never consulted. That grades nothing, and
// `validation/none/constants.ts` states the same principle for the project next
// door, which has no seeded module to reach for in the first place.
//
// So the four ramps are restated here, from `specs/stages.md`'s own table, and the
// four `stages/scaling-*` suites assert the MEASURED dive speed, enemy-bullet
// speed, dive gap and Flux hold against them. Every literal below is the
// specification's; nothing here is read from a build and nothing here is a
// tolerance — a tolerance belongs in the check that allows it, beside the figure
// it is a tolerance on.

/** What `specs/stages.md` adds to the drone-speed multiplier per stage, and its cap. */
export const DRONE_SPEED_STEP = 0.06;
export const DRONE_SPEED_CAP = 1.5;

/** The same two figures for enemy fire. */
export const BULLET_SPEED_STEP = 0.04;
export const BULLET_SPEED_CAP = 1.4;

/** What a stage takes off the dive-gap multiplier, and the floor it stops at. */
export const DIVE_GAP_STEP = 0.05;
export const DIVE_GAP_FLOOR = 0.55;

/** A Flux's stage-1 hold, what a stage takes off it, and the floor it stops at. */
export const FLUX_HOLD_L1 = 1.6;
export const FLUX_HOLD_STEP = 0.05;
export const FLUX_HOLD_FLOOR = 1.0;

/** `min(1.50, 1 + 0.06 * (stage - 1))` — the entrance and dive speed multiplier. */
export function droneSpeedScale(stage: number): number {
  return Math.min(DRONE_SPEED_CAP, 1 + DRONE_SPEED_STEP * (stage - 1));
}

/** `min(1.40, 1 + 0.04 * (stage - 1))` — the enemy bullet speed multiplier. */
export function bulletSpeedScale(stage: number): number {
  return Math.min(BULLET_SPEED_CAP, 1 + BULLET_SPEED_STEP * (stage - 1));
}

/** `max(0.55, 1 - 0.05 * (stage - 1))` — the drawn dive gap's multiplier. */
export function diveGapScale(stage: number): number {
  return Math.max(DIVE_GAP_FLOOR, 1 - DIVE_GAP_STEP * (stage - 1));
}

/** `max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1))` — the held part of a band window. */
export function fluxHold(stage: number): number {
  return Math.max(FLUX_HOLD_FLOOR, FLUX_HOLD_L1 - FLUX_HOLD_STEP * (stage - 1));
}
