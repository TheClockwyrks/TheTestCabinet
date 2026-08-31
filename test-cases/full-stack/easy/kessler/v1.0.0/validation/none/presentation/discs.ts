// presentation/discs — reading whether a produced particle system composited
// this frame.
//
// specs/assets.md fixes HOW every effect is played: "Play them through
// `@test-cabinet/particle-runtime` ... using its `./canvas` binding: a player
// is constructed over a parsed system and a 2D rendering context ... and it
// simulates the system and composites the particles itself", and "The build
// hands the player the same context it draws the field into". The player is a
// vendored, case-supplied library, so the raster path a playing system takes
// is part of the contract rather than a build's choice: it composites each
// particle as a soft radial-gradient disc — a gradient `fillStyle`, a fresh
// path, a full-circle `arc`, and a `fill`.
//
// This reads that path off a frame's recorded operations. WHAT IT NEVER READS
// is where a disc landed: the player draws under whatever transform the build
// placed the instance with, and the recorded arguments are in that local
// space, so a disc's stage position is not recoverable here. Each particle
// suite therefore decides THAT its system played on its event's tick — an
// isolated world, a posed event, and a rise in gradient discs against the
// frame before — and shows the placement in the captured media.
//
// The count is compared against the frame BEFORE the event rather than
// against zero, so a build whose own code paints gradient discs — a glow, a
// star — is measured on the rise its event caused, not on its style.

import type { DrawCall } from "../harness";

/** How close a recorded arc must be to a full circle to read as a disc. */
const FULL_CIRCLE_EPSILON = 1e-6;

/**
 * How many radial-gradient discs the frame's operations painted: a `fill` of
 * a full-circle `arc` under a gradient `fillStyle`, the one shape the
 * particle player composites.
 *
 * The gradient itself crosses the recorder as the opaque marker naming its
 * type (`CanvasGradient`), which is exactly what tells a produced gradient
 * from a build's plain color string.
 */
export function gradientDiscs(calls: readonly DrawCall[]): number {
  let gradientFill = false;
  let fullArc = false;
  let count = 0;
  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property !== "fillStyle") continue;
      const value = call.value as { $opaque?: unknown } | string | null;
      gradientFill =
        typeof value === "object" &&
        value !== null &&
        typeof value.$opaque === "string" &&
        value.$opaque.includes("Gradient");
      continue;
    }
    if (call.method === "beginPath") {
      fullArc = false;
    } else if (call.method === "arc") {
      const start = call.args[3];
      const end = call.args[4];
      if (
        typeof start === "number" &&
        typeof end === "number" &&
        Math.abs(end - start - Math.PI * 2) < FULL_CIRCLE_EPSILON
      ) {
        fullArc = true;
      }
    } else if (call.method === "fill" && gradientFill && fullArc) {
      count += 1;
    }
  }
  return count;
}
