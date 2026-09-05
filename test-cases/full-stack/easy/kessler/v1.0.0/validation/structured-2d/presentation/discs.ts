// presentation/discs — reading whether a produced particle system composited
// this frame.
//
// specs/assets.md fixes HOW every effect is played: "Play them through
// `@clockwyrks/particle-runtime` ... using its `./canvas` binding: a player
// is constructed over a parsed system and a 2D rendering context ... and it
// simulates the system and composites the particles itself", its output put on
// the field by a draw component. The player is a vendored, case-supplied
// library, so the raster path a playing system takes is part of the contract
// rather than a build's choice: it composites each particle as a soft
// radial-gradient disc, building each with
// `createRadialGradient(px, py, 0, px, py, r)` — a point gradient, its two
// centers the same and its inner radius zero.
//
// This reads that call shape off a frame's recorded operations. WHAT IT NEVER
// READS is where a disc landed: the player draws under whatever transform the
// build placed the instance with, and the recorded arguments are in that
// local space, so a disc's stage position is not recoverable here. Each
// particle suite therefore decides THAT its system played on its event's tick
// — an isolated world, a posed event, and a rise in gradient discs against
// the frame before — and shows the placement in the captured media.
//
// The count is compared against the frame BEFORE the event rather than
// against zero, so a build whose own chrome uses radial gradients — a glow, a
// star — is measured on the rise its event caused, not on its style; a
// chrome gradient is an annulus with a nonzero inner radius and does not
// match the disc shape at all.

import type { DrawCall } from "../harness";

/**
 * How many particle discs the frame's operations painted: the player's
 * point-gradient calls, `createRadialGradient(px, py, 0, px, py, r)`.
 */
export function gradientDiscs(calls: readonly DrawCall[]): number {
  let count = 0;
  for (const call of calls) {
    if (call.kind !== "call" || call.method !== "createRadialGradient")
      continue;
    const a = call.args;
    if (
      a.length >= 6 &&
      a[2] === 0 &&
      a[0] === a[3] &&
      a[1] === a[4] &&
      typeof a[5] === "number" &&
      a[5] > 0
    ) {
      count += 1;
    }
  }
  return count;
}
