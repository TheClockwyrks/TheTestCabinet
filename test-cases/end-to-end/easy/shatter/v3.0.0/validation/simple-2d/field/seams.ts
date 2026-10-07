// field — running one body up to one seam and reading the pair of ticks the wrap
// lies between. Local to this group.
//
// WHY THE READING IS A PAIR AND NOT A POSITION. `specs/field.md` states the wrap
// as an arithmetic rule over a coordinate — `x` modulo `FIELD_W` and `y` modulo
// `FIELD_H` — so what decides it is the relation between the tick before the
// crossing and the tick after it, not where the body ended up. A check that only
// asked "is it near the far edge" would pass a build that snapped the coordinate
// to the edge, one that reflected it, and one that re-entered a radius late; the
// pair separates all three, because the tick's own motion says exactly how far
// past the seam the body went and the modulus says exactly where that lands.
//
// WHY THE RUN-UP IS SHORT AND THE READING IS TAKEN OFF THE SNAPSHOT. The body is
// posed half a tick's travel short of the seam plus a counted run-up, so the
// crossing falls on a known tick and the overshoot the wrap has to carry across
// is half a tick's travel rather than whatever an unplanned approach happened to
// leave. Half a tick's travel is the middle of the band an overshoot can fall in,
// so no wrong model reads as the right number by luck. The prediction itself is
// then made from the body's OWN reported position and velocity on the tick before
// the crossing, not from the posed figures, so nothing a legitimate build does to
// the velocity on the way — the well's pull on a ballistic body, the ship's drag
// — is charged to the wrap.
//
// WHY IT LIVES HERE AND NOT IN THE HARNESS. Only the six `field` wrap items ask
// this question, and `validation/simple-2d/harness.ts` owns the compounds the
// WHOLE project shares. The primitives it takes are already there — `h.advance`,
// `h.snapshot`, and `geometry.ts`'s modulus — so what is left is the arithmetic
// that turns one approach into a pair of ticks, and that belongs beside the
// checks that read it.
//
// NO THRESHOLD LIVES HERE. Every tolerance, every speed and every line a crossing
// is flown along is the caller's; this file poses the run and reports the pair.

import { FIELD_H, FIELD_W, TICK_DT } from "../constants";
import { fail } from "../assert";
import { wrapX, wrapY } from "../geometry";
import type { Harness } from "../harness";
import type { ShatterSnapshot } from "../surface";

/** The four edges a body can leave the field through. */
export type Seam = "right" | "left" | "bottom" | "top";

/** The edge a body leaving through each seam re-enters at (`specs/field.md`). */
export const OPPOSITE: Readonly<Record<Seam, Seam>> = {
  right: "left",
  left: "right",
  bottom: "top",
  top: "bottom",
};

/** Anything the snapshot reports with a centre and a velocity. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The run one crossing is flown as: which axis, from where, at what velocity. */
export interface Approach {
  /** `"x"` for the left and right seams, `"y"` for the top and bottom. */
  axis: "x" | "y";
  /** The field's size on that axis: the modulus the wrap is taken against. */
  size: number;
  /** Where on that axis the body is posed. */
  start: number;
  /** Its velocity on that axis, signed toward the seam. */
  velocity: number;
}

/** The coordinate a body carries on one axis. */
export function coordinateOn(body: Body, axis: "x" | "y"): number {
  return axis === "x" ? body.x : body.y;
}

/** The velocity a body carries on one axis. */
export function velocityOn(body: Body, axis: "x" | "y"): number {
  return axis === "x" ? body.vx : body.vy;
}

/** The other axis: the one a crossing must leave alone. */
export function otherAxis(axis: "x" | "y"): "x" | "y" {
  return axis === "x" ? "y" : "x";
}

/** A coordinate brought back onto the field, on the axis it belongs to. */
export function wrapOn(axis: "x" | "y", value: number): number {
  return axis === "x" ? wrapX(value) : wrapY(value);
}

/**
 * The run that carries a body at `speed` up to `seam` and over it on the tick
 * after `approachTicks`.
 *
 * The start is `approachTicks + 0.5` ticks of travel short of the seam, so the
 * body crosses on the tick after the run-up and lands half a tick's travel past
 * it. Half is deliberate: an overshoot at either end of the band is a value some
 * wrong model also produces (nothing past the seam is what a build that snaps to
 * the edge reads, and a whole tick's travel is what a build that wraps a tick
 * late reads), and the middle is the one value none of them reaches.
 */
export function approachTo(
  seam: Seam,
  speed: number,
  approachTicks: number,
): Approach {
  const axis = seam === "right" || seam === "left" ? "x" : "y";
  const size = axis === "x" ? FIELD_W : FIELD_H;
  const step = speed * TICK_DT;
  const run = (approachTicks + 0.5) * step;
  const outward = seam === "right" || seam === "bottom";
  return {
    axis,
    size,
    start: outward ? size - run : run,
    velocity: outward ? speed : -speed,
  };
}

/** Where a run poses the body, given the line it is flown along. */
export function posedAt(
  run: Approach,
  line: number,
  crossVelocity = 0,
): { x: number; y: number; vx: number; vy: number } {
  return run.axis === "x"
    ? { x: run.start, y: line, vx: run.velocity, vy: crossVelocity }
    : { x: line, y: run.start, vx: crossVelocity, vy: run.velocity };
}

/** The two ticks a wrap lies between, and what the rule says it leaves behind. */
export interface Crossing<T extends Body> {
  /** The body on the last tick before the wrap. */
  before: T;
  /** The body on the tick the wrap ran. */
  after: T;
  /** Where that tick's own motion carried it, before the modulus was taken. */
  unwrapped: number;
  /** Where `specs/field.md`'s modulo leaves it. */
  expected: number;
}

/**
 * Fly the run to the seam, cross it, and hand back the pair.
 *
 * It fails, with what the scenario needed named, in the two cases where there is
 * no crossing to read: the body was gone before it reached the seam, and the
 * tick's own motion did not carry it past. Both are the build's — nothing is ever
 * removed for leaving the field and a body posed with a velocity travels at it
 * (`specs/field.md`) — so each is a verdict on the item rather than a hole in it.
 * A body that left and never came back fails on `after` for the same reason.
 */
export async function crossSeam<T extends Body>(
  h: Harness,
  run: Approach,
  read: (snapshot: ShatterSnapshot) => T | undefined,
  approachTicks: number,
  what: string,
): Promise<Crossing<T>> {
  if (approachTicks > 0) await h.advance(approachTicks);

  const before = read(h.snapshot());
  if (before === undefined) {
    fail(
      `the ${what} still on the field on its run up to the seam, since nothing ` +
        "is removed for leaving one (specs/field.md)",
      `it was gone after ${approachTicks} ticks of its approach`,
    );
  }

  const at = coordinateOn(before, run.axis);
  const unwrapped = at + velocityOn(before, run.axis) * TICK_DT;
  if (unwrapped >= 0 && unwrapped < run.size) {
    fail(
      `the ${what} to travel at the velocity it was posed with and reach the ` +
        "seam on the next tick (specs/field.md)",
      `${run.axis} was ${at} moving at ${velocityOn(before, run.axis)}, which ` +
        `one tick carries to ${unwrapped}`,
    );
  }

  await h.advance(1);
  const after = read(h.snapshot());
  if (after === undefined) {
    fail(
      `the ${what} to re-enter at the opposite edge, since the field has no ` +
        "outer walls and nothing is removed for leaving it (specs/field.md)",
      "it was gone from the field on the tick it crossed the seam",
    );
  }

  return { before, after, unwrapped, expected: wrapOn(run.axis, unwrapped) };
}
