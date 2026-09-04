// Orrery — the reference solution for each of the thirteen campaign challenges
// (specs/modes/campaign.md).
//
// The course is this build's own, so these are answers to challenges it wrote
// itself, and the pair has to hold together: the part counts below are what
// makes the course's difficulty rise, and each comment says which idea the
// machine turns on. `src/solutions.test.ts` proves that each one completes and
// that the course as a whole meets every requirement the mode file states.
//
// One rule runs through nearly every layout here. A mote swept 60 degrees at
// radius one passes within 35 units of the six ring-two hexes that sit BETWEEN
// spokes, which is inside the collision threshold of 38 — so an arc is planned
// to leave those hexes empty, and the hexes on the spokes themselves, a clear
// 48 away, are where anything is left to rest.

import { rest, run, tape } from "./tapes";
import type { TapeCell } from "./types";

/** The track arm carries one dust from the rise to the staging hex and returns. */
const FERRY: TapeCell[] = ["grab", "advance", "drop", "recede"];
/** The lifting arm swings that dust from the staging hex onto the mirror's target. */
const LIFT: TapeCell[] = ["grab", "rotate-cw", "drop", "rotate-ccw"];
/** The hexarm walks the whole ring one spoke round. */
const WALK: TapeCell[] = ["grab", "rotate-cw", "drop"];

/**
 * The thirteen challenges of the campaign course, in order. The part counts
 * rise across the course as specs/modes/campaign.md requires: three parts in
 * challenge 1, never fewer than the solution two challenges earlier, and
 * eleven in the finale.
 */
export const CAMPAIGN_SOLUTIONS: unknown[] = [
  // 1. Meridian — the whole game in three parts: a rise, an arm, a set.
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
  // 2. Emberfall — the `nova` is set down on the `wane` half way round, picked
  //    up again as dust, and carried on to the set.
  {
    parts: [
      { kind: "rise", index: 0, q: -1, r: 0, rotation: 0 },
      { kind: "wane", q: 0, r: -1, rotation: 0 },
      { kind: "set", index: 0, q: 1, r: 0, rotation: 0 },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 3,
        length: 1,
        tape: tape(
          "grab",
          "rotate-cw",
          "drop",
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
        ),
      },
    ],
  },
  // 3. The Bound Pair — the feeder lays two dust on the `bind`, and the carrier
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
  // 4. The Zodiac Wheel — the arm parks a dust beside the wheel's `nova`
  //    fixture, the `mirror` paints it, and the same arm carries it on. The
  //    base is set two hexes out along the fixture's own spoke, so the arc
  //    never passes close to the ring of fixtures.
  {
    parts: [
      { kind: "rise", index: 0, q: -4, r: 3, rotation: 0 },
      { kind: "wheel", q: 0, r: 0, rotation: 0, length: 1, tape: [] },
      { kind: "mirror", q: -1, r: 1, rotation: 2 },
      { kind: "set", index: 0, q: -2, r: 3, rotation: 0 },
      {
        kind: "arm",
        q: -3,
        r: 3,
        rotation: 3,
        length: 1,
        tape: tape(
          "grab",
          run(2, "rotate-cw"),
          "drop",
          "grab",
          "rotate-cw",
          "drop",
          run(3, "rotate-ccw"),
        ),
      },
    ],
  },
  // 5. The Long Reach — one piston reaches both rises, at one radius and at
  //    two, and a second lifts the bound pair clear.
  {
    parts: [
      { kind: "rise", index: 0, q: 0, r: -1, rotation: 0 },
      { kind: "rise", index: 1, q: 0, r: -2, rotation: 0 },
      { kind: "bind", q: 1, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 3, r: -1, rotation: 1 },
      {
        kind: "piston",
        q: 0,
        r: 0,
        rotation: 4,
        length: 1,
        tape: tape(
          "grab",
          run(2, "rotate-cw"),
          "drop",
          "extend",
          run(2, "rotate-ccw"),
          "grab",
          run(2, "rotate-cw"),
          "drop",
          "retract",
          run(2, "rotate-ccw"),
        ),
      },
      {
        kind: "piston",
        q: 2,
        r: 1,
        rotation: 4,
        length: 1,
        tape: tape(rest(11), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
  // 6. The Carriage — a chain of three cannot be turned into place, so the
  //    track arm TRANSLATES the bound pair one hex east and the `bind` writes
  //    the third link behind it, onto the hex the feeder has just refilled.
  {
    parts: [
      { kind: "rise", index: 0, q: -1, r: 1, rotation: 0 },
      { kind: "bind", q: 0, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 2, r: 0, rotation: 0 },
      {
        kind: "track",
        cells: [
          { q: 0, r: -1 },
          { q: 1, r: -1 },
          { q: 2, r: -1 },
          { q: 3, r: -1 },
          { q: 4, r: -1 },
        ],
        closed: false,
      },
      {
        kind: "arm",
        q: 0,
        r: 1,
        rotation: 3,
        length: 1,
        tape: tape(
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(2, "rotate-ccw"),
          "grab",
          "rotate-cw",
          "drop",
          "rotate-ccw",
          "grab",
          "rotate-cw",
          "drop",
          "rotate-ccw",
        ),
      },
      {
        kind: "arm",
        q: 0,
        r: -1,
        rotation: 1,
        length: 1,
        tape: tape(
          rest(10),
          "grab",
          "advance",
          null,
          run(2, "advance"),
          "drop",
          run(3, "recede"),
        ),
      },
    ],
  },
  // 7. Quicksilver Ladder — one `ascend` climbed twice. The biarm spends a
  //    `mercury` on each rung and lifts the `mars` off the crown itself; the
  //    plain arm only ever brings the `saturn` in.
  {
    parts: [
      { kind: "rise", index: 0, q: 1, r: 0, rotation: 0 },
      { kind: "rise", index: 1, q: -2, r: 2, rotation: 0 },
      { kind: "ascend", q: 0, r: 1, rotation: 3 },
      { kind: "set", index: 0, q: -1, r: 0, rotation: 0 },
      {
        kind: "biarm",
        q: 0,
        r: 0,
        rotation: 0,
        length: 1,
        tape: tape(
          "grab",
          "rotate-cw",
          "drop",
          "rotate-ccw",
          "grab",
          "rotate-cw",
          "drop",
          "rotate-cw",
          "grab",
          "rotate-cw",
          "drop",
          run(3, "rotate-ccw"),
        ),
      },
      {
        kind: "arm",
        q: -1,
        r: 2,
        rotation: 3,
        length: 1,
        tape: ["grab", "rotate-cw", "drop", "rotate-ccw"],
      },
    ],
  },
  // 8. The Second Rung — the piston fills the far fount at length two and the
  //    near one at length one, so the two `saturn` never share an approach.
  {
    parts: [
      { kind: "rise", index: 0, q: -2, r: 2, rotation: 0 },
      { kind: "conjoin", q: 1, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 2, r: 1, rotation: 0 },
      {
        kind: "piston",
        q: 0,
        r: 0,
        rotation: 3,
        length: 1,
        tape: tape(
          "grab",
          "extend",
          run(3, "rotate-cw"),
          "drop",
          "retract",
          run(3, "rotate-ccw"),
          "grab",
          run(3, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
        ),
      },
      {
        kind: "arm",
        q: -1,
        r: 1,
        rotation: 2,
        length: 1,
        tape: tape(
          rest(5),
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(2, "rotate-ccw"),
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(2, "rotate-ccw"),
        ),
      },
      {
        kind: "arm",
        q: 1,
        r: 2,
        rotation: 4,
        length: 1,
        tape: tape(rest(6), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
  // 9. Umbra and Lumen — the `eclipse` throws its two products onto two crowns
  //    that are not adjacent, so each gets its own arm and its own set, and the
  //    feeder only fills the founts once both crowns are clear again.
  {
    parts: [
      { kind: "rise", index: 0, q: 2, r: -1, rotation: 0 },
      { kind: "eclipse", q: 0, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 0, r: 2, rotation: 0 },
      { kind: "set", index: 1, q: 1, r: -2, rotation: 0 },
      {
        kind: "arm",
        q: 1,
        r: 1,
        rotation: 3,
        length: 1,
        tape: ["grab", "rotate-ccw", "drop", "rotate-cw"],
      },
      {
        kind: "arm",
        q: 2,
        r: -2,
        rotation: 2,
        length: 1,
        tape: ["grab", "rotate-cw", "drop", "rotate-ccw"],
      },
      {
        kind: "arm",
        q: 1,
        r: -1,
        rotation: 0,
        length: 1,
        tape: tape(
          rest(2),
          "grab",
          run(2, "rotate-cw"),
          "drop",
          run(2, "rotate-ccw"),
          "grab",
          "rotate-cw",
          "drop",
          "rotate-ccw",
        ),
      },
    ],
  },
  // 10. Chaff and Grain — the reagent arrives already bound. One arm swings the
  //     whole pair onto the `sunder`, and the halves then part company: the
  //     `nova` to the set, the dust to the maw of the `void`.
  {
    parts: [
      { kind: "rise", index: 0, q: 1, r: 0, rotation: 0 },
      { kind: "sunder", q: 0, r: 1, rotation: 1 },
      { kind: "set", index: 0, q: -1, r: 1, rotation: 0 },
      { kind: "void", q: 2, r: 2, rotation: 0 },
      {
        kind: "arm",
        q: 0,
        r: 0,
        rotation: 0,
        length: 1,
        tape: ["grab", "rotate-cw", "drop", "rotate-ccw"],
      },
      {
        kind: "arm",
        q: -1,
        r: 2,
        rotation: 5,
        length: 1,
        tape: tape(rest(3), "grab", "rotate-ccw", "drop", "rotate-cw"),
      },
      {
        kind: "arm",
        q: 1,
        r: 2,
        rotation: 3,
        length: 1,
        tape: tape(
          rest(3),
          "grab",
          run(3, "rotate-ccw"),
          "drop",
          run(3, "rotate-cw"),
        ),
      },
    ],
  },
  // 11. Threefold Cord — no two sigils may share a hex, so the heavy filament
  //     cannot be written where the star is assembled. The `triune` writes it
  //     on two hexes of its own; a three-hex arm swings the bound pair half the
  //     field onto the `manifold`'s centre and first reach; the triarm lays the
  //     other two reaches in one turn; and the `manifold` closes the star in a
  //     single boundary. Every arc is kept off the ring-two hexes that sit
  //     between spokes, which are the ones a swept mote passes closest to.
  {
    parts: [
      { kind: "rise", index: 0, q: -2, r: 1, rotation: 0 },
      { kind: "triune", q: -3, r: 0, rotation: 5 },
      { kind: "manifold", q: 0, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: 3, r: 0, rotation: 1 },
      {
        kind: "arm",
        q: -2,
        r: 0,
        rotation: 1,
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
        q: -3,
        r: 3,
        rotation: 4,
        length: 3,
        tape: tape(rest(12), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
      {
        kind: "arm",
        q: -1,
        r: 1,
        rotation: 3,
        length: 1,
        tape: tape(
          rest(16),
          "grab",
          run(3, "rotate-ccw"),
          "drop",
          run(3, "rotate-cw"),
          "grab",
          "rotate-cw",
          "drop",
          "rotate-ccw",
        ),
      },
      {
        kind: "triarm",
        q: 0,
        r: 0,
        rotation: 1,
        length: 1,
        tape: tape(rest(28), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
      {
        kind: "arm",
        q: 0,
        r: 3,
        rotation: 4,
        length: 3,
        tape: tape(rest(32), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
    ],
  },
  // 12. Aether Undone — one `aether` becomes four motes on four crowns, and all
  //     four must be gone before the next one can disperse. The biarm clears
  //     the crowns in opposite pairs, one pair per turn, into the two hexes the
  //     `dispersion` does not use; the two arms then sort them, `nova` and
  //     `comet` to their sets and the rest to the maw.
  {
    parts: [
      { kind: "rise", index: 0, q: 2, r: 0, rotation: 0 },
      { kind: "dispersion", q: 0, r: 0, rotation: 0 },
      { kind: "set", index: 0, q: -2, r: 3, rotation: 0 },
      { kind: "set", index: 1, q: -2, r: 2, rotation: 0 },
      { kind: "void", q: 1, r: -3, rotation: 0 },
      {
        kind: "arm",
        q: 2,
        r: -2,
        rotation: 1,
        length: 2,
        tape: ["grab", "rotate-cw", "drop", "rotate-ccw"],
      },
      {
        kind: "biarm",
        q: 0,
        r: 0,
        rotation: 1,
        length: 1,
        tape: tape(
          rest(4),
          "grab",
          "rotate-cw",
          "drop",
          rest(4),
          run(2, "rotate-ccw"),
          "grab",
          "rotate-ccw",
          "drop",
          run(2, "rotate-cw"),
        ),
      },
      {
        kind: "arm",
        q: -1,
        r: 2,
        rotation: 4,
        length: 1,
        tape: tape(
          rest(7),
          "grab",
          "rotate-ccw",
          "drop",
          "rotate-cw",
          rest(5),
          "grab",
          run(2, "rotate-ccw"),
          "drop",
          run(2, "rotate-cw"),
        ),
      },
      {
        kind: "arm",
        q: 1,
        r: -2,
        rotation: 1,
        length: 1,
        tape: tape(
          rest(7),
          "grab",
          run(3, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
          "grab",
          run(3, "rotate-cw"),
          "drop",
          run(3, "rotate-ccw"),
        ),
      },
    ],
  },
  // 13. The Great Work — the whole machine at once, and the course's largest.
  //     One wheel turns through its ring so that a single `mirror` paints a
  //     different essence onto each dust that reaches its target; the hexarm
  //     standing on the `confluence`'s crown takes the whole ring in one grab
  //     and walks each painted mote round to a fount of its own; and when the
  //     four founts are full the quintessence appears under the hexarm's own
  //     base, where a two-hex arm lifts it out to the set. The track ferries
  //     the raw dust in.
  {
    parts: [
      { kind: "rise", index: 0, q: -1, r: -2, rotation: 0 },
      { kind: "confluence", q: 0, r: 0, rotation: 0 },
      { kind: "mirror", q: 2, r: -2, rotation: 2 },
      { kind: "set", index: 0, q: 0, r: 2, rotation: 0 },
      {
        kind: "track",
        cells: [
          { q: 0, r: -3 },
          { q: 0, r: -2 },
        ],
        closed: false,
      },
      {
        kind: "arm",
        q: 0,
        r: -3,
        rotation: 2,
        length: 1,
        tape: tape(FERRY, rest(8), FERRY, rest(11), FERRY, rest(8), FERRY),
      },
      {
        kind: "arm",
        q: -1,
        r: 1,
        rotation: 4,
        length: 2,
        tape: tape(rest(4), LIFT, rest(8), LIFT, rest(11), LIFT, rest(8), LIFT),
      },
      {
        kind: "hexarm",
        q: 0,
        r: 0,
        rotation: 0,
        length: 1,
        tape: tape(
          rest(8),
          WALK,
          rest(9),
          WALK,
          rest(1),
          WALK,
          rest(8),
          WALK,
          rest(9),
          WALK,
        ),
      },
      {
        kind: "arm",
        q: -2,
        r: 2,
        rotation: 5,
        length: 2,
        tape: tape(rest(51), "grab", "rotate-cw", "drop", "rotate-ccw"),
      },
      {
        kind: "wheel",
        q: 3,
        r: -3,
        rotation: 0,
        length: 1,
        tape: tape(
          rest(11),
          "rotate-cw",
          rest(11),
          "rotate-cw",
          rest(16),
          run(3, "rotate-cw"),
          rest(12),
          "rotate-cw",
        ),
      },
    ],
  },
];
