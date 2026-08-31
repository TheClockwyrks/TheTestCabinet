// controls — holding a key down, and reading what the hold did. LOCAL TO THIS GROUP.
//
// `validation/simple-2d/harness.ts` presses keys (`hold`, `release`, `tap`) and
// nothing more, which is right: a key press is an atom and the harness owns atoms.
// What is here is the two shapes of HOLD the six held-key items in this group
// need — a hold that runs for a stated span, and a turn accumulated across one —
// plus the one reading their assertions are taken along. Nothing else in the suite
// wants them, so they live beside the checks that do rather than in the shared file
// every other group agent is also editing.
//
// THEY MEASURE AND ASSERT NOTHING. How long a key is held, what counts as having
// turned, and how far a released ship may still drift are each item's own figures,
// derived in the item that holds them. (Harness rule 2: helpers fix geometry and
// drives, never thresholds.)

import { angleBetween, type Velocity } from "../geometry";
import type { Harness } from "../harness";

/**
 * Hold `code` down for `ticks` real ticks, then let it up.
 *
 * The key goes down through the event target the engine listens on — which
 * `specs/controls.md` and the engine's input contract make indistinguishable from
 * a player's own key — and comes up in a `finally`, so a check that failed
 * mid-hold does not leave a key down for whatever the harness does next.
 *
 * The release is dispatched before the caller's next `advance`, so the first tick
 * after this returns is already a tick with nothing held.
 */
export async function holdFor(
  h: Harness,
  code: string,
  ticks: number,
): Promise<void> {
  h.hold(code);
  try {
    await h.advance(ticks);
  } finally {
    h.release(code);
  }
}

/** What a held turn came to: the winding-aware total, and the facing it ended on. */
export interface HeldTurn {
  /** The signed turn accumulated across the hold, in radians, clockwise positive. */
  turned: number;
  /** The facing the last sample read, in radians. */
  angle: number;
}

/**
 * Hold `code` down for `ticks` real ticks, sampling the facing every `sample`
 * ticks, and hand back the turn those samples add up to.
 *
 * WHY AN ACCUMULATION RATHER THAN A SUBTRACTION. `specs/ship.md` turns the ship at
 * `SHIP_TURN` (`300` degrees per second) while a turn key is held, so the second
 * the two arrow items hold a key for is three hundred degrees of turn. A facing is
 * an ANGLE, and `snapshot` reports it in radians with no winding attached, so the
 * facing at the end of that second sits sixty degrees the OTHER side of where it
 * began. Subtracting one reading from the other and normalizing would therefore
 * read a conformant counter-clockwise turn as a clockwise one and grade all four
 * rotation items backwards.
 *
 * So the turn is accumulated out of the short-way-round step between CONSECUTIVE
 * samples, taken often enough that no one step can be mistaken for its opposite:
 * at `SHIP_TURN` a four-tick step is ten degrees, and a step would have to reach a
 * hundred and eighty before the short way round is the wrong way round.
 */
export async function heldTurn(
  h: Harness,
  code: string,
  ticks: number,
  sample: number,
): Promise<HeldTurn> {
  h.hold(code);
  let angle = h.snapshot().ship.angle;
  let turned = 0;
  try {
    for (let done = 0; done < ticks; done += sample) {
      await h.advance(Math.min(sample, ticks - done));
      const now = h.snapshot().ship.angle;
      turned += angleBetween(angle, now);
      angle = now;
    }
  } finally {
    h.release(code);
  }
  return { turned, angle };
}

/**
 * The component of `v` along the direction `angle` points, in units per second.
 *
 * `specs/ship.md` adds the thrust "along the current facing", so this is the
 * reading the two thrust items take: a build shoving the ship in some fixed screen
 * direction, or thrusting in reverse, gains SPEED just as surely as a conformant
 * one, and only the signed component along the facing separates them.
 */
export function alongFacing(v: Velocity, angle: number): number {
  return v.vx * Math.cos(angle) + v.vy * Math.sin(angle);
}
