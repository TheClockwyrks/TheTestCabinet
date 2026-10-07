// simulation/a-rotation-and-a-translation-disagree — a sweep and a slide are never
// the same motion, so a constellation held by one of each tears.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). Each of the three agreeing cases
// is a set of motions of ONE kind, so a rotation beside a translation satisfies
// none of them, whatever the center and whatever the vector. `FAULTS` names the
// outcome: "`torn` — A held constellation's imposed motions disagree."
//
// THE TWO KINDS. "`rotate-cw`, `rotate-ccw` — ... Motion imposed on each held
// constellation: The same rotation about the base"; "`extend`, `retract` — The
// piston's length changes by one, its gripper translating one hex along its
// spoke ... Translation by the same vector, linearly in `t`"; "`advance`, `recede`
// — The base translates to the adjacent track cell ... Translation by the same
// vector, linearly in `t`" (`specs/simulation.md`, Motion and carrying). All four
// translating instructions are set against the rotation, one scenario each.
//
// THE CONFIGURATION. One `dust` mote on `(1, 0)` — "A lone mote with no filaments
// is a constellation of one" (`specs/field.md`) — held by exactly two grippers,
// which may share a hex because "Only motes collide, so a gripper and the drawn
// arm between base and gripper pass over any hex" (`specs/parts.md`).
//
// The rotating holder is the same in every scenario: an `arm` on `(0, 0)` at
// rotation `0`, length `1`, whose one gripper stands at `base + length * DIRS[0]`
// = `(1, 0)` (`specs/parts.md`, `specs/field.md`), with `rotate-cw` on its tape.
//
// The translating holder is one of four, each with its gripper on `(1, 0)` too:
//
//   * `extend` — a `piston` on `(2, 0)` at rotation `3`, length `1`, gripper
//     `(2, 0) + DIRS[3]` = `(1, 0)`. At `ARM_MIN_LEN` (`1`) it cannot raise
//     `overretracted`, and extending from `1` cannot raise `overextended`.
//   * `retract` — a `piston` on `(3, 0)` at rotation `3`, length `2`, gripper
//     `(3, 0) + 2 * DIRS[3]` = `(1, 0)`. At `2` it is clear of `ARM_MIN_LEN`.
//   * `advance` and `recede` — an `arm` on `(1, 1)` at rotation `4`, length `1`,
//     gripper `(1, 1) + DIRS[4]` = `(1, 0)`, mounted on an open track through
//     `(0, 1)`, `(1, 1)`, `(2, 1)` (`specs/parts.md`). Its base is the track's
//     middle cell, so neither direction reaches an end and neither can raise
//     `track-end`.
//
// Four scenarios, each posed on its own emptied field. Every hold is given with
// `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), so no earlier cycle has moved anything, and only
// one mote is ever on the field, so no pair exists for the collision rule to
// sample and the tear is the only fault available.
//
// THE VERDICT. Each scenario faults, and it faults as `torn` rather than as
// anything else: `sim.fault.kind` is `torn` and "A fault freezes the run where it
// stood: the status becomes `faulted`."

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution, trackPart, type SolutionPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The hex the one held mote rests on; both grippers stand there. */
const HELD = at(1, 0);

/** The track the mounted holder rides, entered at its middle cell. */
const TRACK = [at(0, 1), at(1, 1), at(2, 1)] as const;

/** One translating holder: the parts it adds, and where it grips from. */
interface Slider {
  readonly label: string;
  readonly parts: readonly SolutionPart[];
  readonly holder: { index: number; spoke: number };
}

/** Every instruction of `specs/simulation.md`'s two translating rows. */
const SLIDERS: readonly Slider[] = [
  {
    label: "extend",
    parts: [armPart("piston", 2, 0, 3, 1, ["extend"])],
    holder: { index: 1, spoke: 3 },
  },
  {
    label: "retract",
    parts: [armPart("piston", 3, 0, 3, 2, ["retract"])],
    holder: { index: 1, spoke: 3 },
  },
  {
    label: "advance",
    parts: [
      trackPart([...TRACK]),
      armPart("arm", TRACK[1].q, TRACK[1].r, 4, 1, ["advance"]),
    ],
    holder: { index: 2, spoke: 4 },
  },
  {
    label: "recede",
    parts: [
      trackPart([...TRACK]),
      armPart("arm", TRACK[1].q, TRACK[1].r, 4, 1, ["recede"]),
    ],
    holder: { index: 2, spoke: 4 },
  },
];

/** The rotating holder, placed first in every scenario. */
const TURNER_ROTATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("tears a constellation swept by one holder and slid by another", async () => {
  for (const slider of SLIDERS) {
    const where = `rotate-cw against ${slider.label}`;
    await openBareRun(h, {
      challenge: BARE,
      machine: solution([
        armPart("arm", ORIGIN.q, ORIGIN.r, TURNER_ROTATION, 1, ["rotate-cw"]),
        ...slider.parts,
      ]),
    });
    const placed = await partIds(h);
    const turner = placed[0] ?? -1;
    const sliding = placed[slider.holder.index] ?? -1;
    const mote = await spawnMote(h, HELD, "dust");
    await takeGrip(h, turner, TURNER_ROTATION, mote);
    await takeGrip(h, sliding, slider.holder.spoke, mote);

    const posed = await h.snapshot();
    assertLength(
      posed.sim?.grips ?? [],
      2,
      `${where}: the rotating part and the translating part both hold the one mote before the cycle begins`,
    );

    await advanceCycles(h, 1);
    await h.advance(1);
    await captureStill(h, "torn");

    const sim = (await h.snapshot()).sim;
    assertNotNull(sim, `${where}: the run is still live after the cycle`);
    assertEqual(
      sim?.fault?.kind,
      "torn",
      `${where}: a rotation and a translation are never the same motion, so the held constellation's imposed motions disagree`,
    );
    assertEqual(
      sim?.status,
      "faulted",
      `${where}: a fault freezes the run where it stood and the status becomes faulted`,
    );
  }
});
