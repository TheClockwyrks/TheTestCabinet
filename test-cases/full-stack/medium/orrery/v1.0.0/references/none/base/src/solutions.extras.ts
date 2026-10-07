// Orrery — the reference solution for each of the ten Extras
// (specs/challenges.md, specs/modes/extras.md).
//
// The shelf is fixed, so these ten are answers to challenges this build did not
// author. Each comment says what the machine's idea is; `src/solutions.test.ts`
// proves that each one completes.

import { rest, run, tape } from "./tapes";

/**
 * The ten Extras of specs/challenges.md, in order.
 */
export const EXTRA_SOLUTIONS: unknown[] = [
  // 1. First Light — one arm swings a `sol` from the rise round to the set.
  {
    parts: [
      { kind: "rise", index: 0, q: -1, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 1, r: 0, rotation: 0 },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 3,
        length: 1,
        tape: tape("grab", run(3, "rotate-cw"), "drop", run(3, "rotate-ccw")),
      },
    ],
  },
  // 2. Twin Moons — a feeder lays two `luna` on the `bind`, and a second arm
  //    swings the bound pair onto the set as one rigid body.
  {
    parts: [
      { kind: "rise", index: 0, q: 3, r: -2, rotation: 0 },
      { kind: "bind", q: 1, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 0, r: 1, rotation: 1 },
      {
        kind: "arm",
        q: 2,
        r: -1,
        rotation: 5,
        length: 1,
        tape: tape(
          "grab",
          run(3, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(2, "rotate-ccw"),
        ),
      },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 0,
        length: 1,
        tape: tape(rest(12), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
  // 3. Waning Crescent — the comet is set down on a `wane` on the way, so what
  //    reaches the `bind` is a pair of dust; the carrier swings it onto the set.
  {
    parts: [
      { kind: "rise", index: 0, q: 3, r: -2, rotation: 0 },
      { kind: "wane", q: 3, r: -1, rotation: 0 },
      { kind: "bind", q: 1, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 0, r: 1, rotation: 1 },
      {
        kind: "arm",
        q: 2,
        r: -1,
        rotation: 5,
        length: 1,
        tape: tape(
          "grab",
          "rotate-cw",
          "drop",
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
          "grab",
          "rotate-cw",
          "drop",
          "grab",
          "rotate-cw",
          "drop",
          run(2, "rotate-ccw"),
        ),
      },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 0,
        length: 1,
        tape: tape(rest(18), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
  // 4. Mirrorwright — the pair is BOUND as two dust, swung onto the two mirror
  //    targets where the wheel's `nova` and `comet` fixtures paint it in one
  //    boundary, and swung on again onto the set. Every arc is kept clear of
  //    the wheel's other four fixtures.
  {
    parts: [
      { kind: "rise", index: 0, q: 3, r: 2, rotation: 0 },
      { kind: "wheel", q: 1, r: -1, rotation: 0, length: 1, tape: [] },
      { kind: "mirror", q: 0, r: 0, rotation: 1 },
      { kind: "mirror", q: 1, r: 0, rotation: 1 },
      { kind: "bind", q: 2, r: 1, rotation: 2 },
      { kind: "set", index: 0, q: 0, r: 2, rotation: 1 },
      {
        kind: "arm",
        q: 2,
        r: 2,
        rotation: 0,
        length: 1,
        tape: tape(
          "grab",
          run(3, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
          "grab",
          run(2, "rotate-ccw"),
          "drop",
          run(2, "rotate-cw"),
        ),
      },
      {
        kind: "arm",
        q: 2,
        r: 0,
        rotation: 1,
        length: 1,
        tape: tape(rest(12), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
      {
        kind: "arm",
        q: -1,
        r: 2,
        rotation: 5,
        length: 1,
        tape: tape(rest(15), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
  // 5. Ascendant — one arm does the whole round: the `saturn` onto the crown,
  //    the `mercury` onto the prime, and the `jupiter` the `ascend` leaves
  //    behind on round to the set.
  {
    parts: [
      { kind: "rise", index: 1, q: 0, r: -1, rotation: 0 },
      { kind: "rise", index: 0, q: 1, r: -1, rotation: 0 },
      { kind: "ascend", q: 0, r: 1, rotation: 3 },
      { kind: "set", index: 0, q: -1, r: 0, rotation: 0 },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 4,
        length: 1,
        tape: tape(
          "grab",
          run(2, "rotate-ccw"),
          "drop",
          run(3, "rotate-ccw"),
          "grab",
          run(2, "rotate-cw"),
          "drop",
          "rotate-cw",
          "grab",
          "rotate-cw",
          "drop",
          "rotate-cw",
        ),
      },
    ],
  },
  // 6. Great Conjunction — the feeder lays two `venus` on the two founts, and
  //    the carrier lifts the `luna` off the crown.
  {
    parts: [
      { kind: "rise", index: 0, q: 0, r: -1, rotation: 0 },
      { kind: "conjoin", q: -1, r: 1, rotation: 0 },
      { kind: "set", index: 0, q: -2, r: 2, rotation: 0 },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 4,
        length: 1,
        tape: tape(
          "grab",
          run(3, "rotate-ccw"),
          "drop",
          run(3, "rotate-cw"),
          "grab",
          run(2, "rotate-ccw"),
          "drop",
          run(2, "rotate-cw"),
        ),
      },
      {
        kind: "arm",
        q: -2,
        r: 3,
        rotation: 5,
        length: 1,
        tape: tape(rest(12), "grab", "rotate-ccw", "drop", "rotate-cw"),
      },
    ],
  },
  // 7. Syzygy — the `eclipse` throws its two crowns apart, so the lumen goes
  //    first, the umbra follows onto the `bind`, and a fourth arm swings the
  //    bound pair clear onto the set.
  {
    parts: [
      { kind: "rise", index: 0, q: 1, r: -2, rotation: 0 },
      { kind: "eclipse", q: 0, r: 0, rotation: 0 },
      { kind: "bind", q: 1, r: 1, rotation: 5 },
      { kind: "set", index: 0, q: 2, r: 1, rotation: 0 },
      {
        kind: "arm",
        q: 1,
        r: -1,
        rotation: 4,
        length: 1,
        tape: tape(
          "grab",
          run(3, "rotate-ccw"),
          "drop",
          run(3, "rotate-cw"),
          "grab",
          run(2, "rotate-ccw"),
          "drop",
          run(2, "rotate-cw"),
        ),
      },
      {
        kind: "arm",
        q: 2,
        r: -1,
        rotation: 3,
        length: 1,
        tape: tape(
          rest(12),
          "grab",
          run(2, "rotate-ccw"),
          "drop",
          run(2, "rotate-cw"),
        ),
      },
      {
        kind: "arm",
        q: 1,
        r: 0,
        rotation: 2,
        length: 1,
        tape: tape(rest(16), "grab", "rotate-ccw", "drop", "rotate-cw"),
      },
      {
        kind: "arm",
        q: 1,
        r: 2,
        rotation: 4,
        length: 1,
        tape: tape(rest(19), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
  // 8. Aetherfall — four arms lay one essence each on the `confluence`, and a
  //    fifth lifts the `aether` out through the one free neighbour of the crown.
  {
    parts: [
      { kind: "rise", index: 0, q: 2, r: -1, rotation: 0 },
      { kind: "rise", index: 1, q: 1, r: 1, rotation: 0 },
      { kind: "rise", index: 2, q: -2, r: 1, rotation: 0 },
      { kind: "rise", index: 3, q: -1, r: -1, rotation: 0 },
      { kind: "confluence", q: 0, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: -1, r: 1, rotation: 0 },
      {
        kind: "arm",
        q: 2,
        r: 0,
        rotation: 4,
        length: 1,
        tape: ["grab", "rotate-ccw", "drop", "rotate-cw"],
      },
      {
        kind: "arm",
        q: 0,
        r: 2,
        rotation: 5,
        length: 1,
        tape: ["grab", "rotate-ccw", "drop", "rotate-cw"],
      },
      {
        kind: "arm",
        q: -2,
        r: 0,
        rotation: 1,
        length: 1,
        tape: ["grab", "rotate-ccw", "drop", "rotate-cw"],
      },
      {
        kind: "arm",
        q: 0,
        r: -2,
        rotation: 2,
        length: 1,
        tape: ["grab", "rotate-ccw", "drop", "rotate-cw"],
      },
      {
        kind: "arm",
        q: 0,
        r: 1,
        rotation: 4,
        length: 1,
        tape: tape(rest(3), "grab", "rotate-ccw", "drop", "rotate-cw"),
      },
    ],
  },
  // 9. Trine — Twin Moons with the heavy filament: the `triune` writes weight
  //    three between the two `nova` the feeder lays on it.
  {
    parts: [
      { kind: "rise", index: 0, q: 3, r: -2, rotation: 0 },
      { kind: "triune", q: 1, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 0, r: 1, rotation: 1 },
      {
        kind: "arm",
        q: 2,
        r: -1,
        rotation: 5,
        length: 1,
        tape: tape(
          "grab",
          run(3, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(2, "rotate-ccw"),
        ),
      },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 0,
        length: 1,
        tape: tape(rest(12), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
  // 10. Procession — the set takes chains, so each delivery of a bound pair is
  //     worth two: three passes reach the target of six.
  {
    parts: [
      { kind: "rise", index: 0, q: 3, r: -2, rotation: 0 },
      { kind: "bind", q: 1, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 0, r: 1, rotation: 1 },
      {
        kind: "arm",
        q: 2,
        r: -1,
        rotation: 5,
        length: 1,
        tape: tape(
          "grab",
          run(3, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(2, "rotate-ccw"),
        ),
      },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 0,
        length: 1,
        tape: tape(rest(12), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
];
