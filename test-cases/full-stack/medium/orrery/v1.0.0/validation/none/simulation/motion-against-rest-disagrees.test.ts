// simulation/motion-against-rest-disagrees — a moving holder and a resting holder
// are not the same motion, so the constellation between them tears.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`. Motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction"
// (`specs/simulation.md`, Held more than once). No motion is one of the three
// agreeing cases and a motion is another, so a motion beside a rest satisfies
// none of them. `FAULTS` names the outcome: "`torn` — A held constellation's
// imposed motions disagree."
//
// WHAT IMPOSES NOTHING. "`grab`, `drop`, blank — Motion of the part: None. Motion
// imposed on each held constellation: None" (`specs/simulation.md`, Motion and
// carrying), and "A blank cell is a rest on every part, a wheel included, and
// never faults."
//
// WHAT IMPOSES SOMETHING. Each of the three kinds of motion the table gives, so
// the rest is set against a rotation and against both ways a translation is
// reached: `rotate-cw` on an arm ("The same rotation about the base"), `extend` on
// a piston ("Translation by the same vector"), and `advance` on a mounted arm
// ("Translation by the same vector").
//
// THE CONFIGURATION. One `dust` mote on `(1, 0)` — "A lone mote with no filaments
// is a constellation of one" (`specs/field.md`) — held by exactly two grippers.
//
// The resting holder is the same in every scenario: an `arm` on `(2, 0)` at
// rotation `3`, length `1`, whose one gripper stands at `base + length * DIRS[3]`
// = `(1, 0)` (`specs/parts.md`, `specs/field.md`). Its tape is blank in one
// scenario and `grab` in the other; a `grab` gripper "over a mote that is not a
// fixture takes hold of that mote's constellation", so it is still a holder when
// the motion step begins.
//
// The moving holder is one of three, each with its gripper on `(1, 0)` too:
//
//   * an `arm` on `(0, 0)` at rotation `0`, gripper `(0, 0) + DIRS[0]` = `(1, 0)`,
//     with `rotate-cw`;
//   * a `piston` on `(0, 0)` at rotation `0`, the same gripper hex, with `extend`;
//   * an `arm` on `(1, 1)` at rotation `4`, gripper `(1, 1) + DIRS[4]` = `(1, 0)`,
//     mounted on an open track through `(0, 1)`, `(1, 1)`, `(2, 1)`
//     (`specs/parts.md`), with `advance`.
//
// Six scenarios, each posed on its own emptied field. Every hold is given with
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
import { type InstructionName } from "../constants";
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

/** The hex the one held mote rests on; every gripper below stands there. */
const HELD = at(1, 0);

/** The track the mounted mover rides. */
const TRACK = [at(0, 1), at(1, 1), at(2, 1)] as const;

/** A part of a posed machine that is holding the mote, by placement index. */
interface Holder {
  readonly index: number;
  readonly spoke: number;
}

/** One moving holder: the parts it needs, and where it grips from. */
interface Mover {
  readonly label: string;
  readonly parts: readonly SolutionPart[];
  readonly holder: Holder;
}

/** The three kinds of motion the table gives, each imposed on the one mote. */
const MOVERS: readonly Mover[] = [
  {
    label: "rotate-cw",
    parts: [armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"])],
    holder: { index: 0, spoke: 0 },
  },
  {
    label: "extend",
    parts: [armPart("piston", ORIGIN.q, ORIGIN.r, 0, 1, ["extend"])],
    holder: { index: 0, spoke: 0 },
  },
  {
    label: "advance",
    parts: [
      trackPart([...TRACK]),
      armPart("arm", TRACK[1].q, TRACK[1].r, 4, 1, ["advance"]),
    ],
    holder: { index: 1, spoke: 4 },
  },
];

/** The two ways the other holder's cell imposes no motion. */
const RESTS: readonly { label: string; tape: readonly InstructionName[] }[] = [
  { label: "blank", tape: [] },
  { label: "grab", tape: ["grab"] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("tears a constellation held by a moving part and a resting one", async () => {
  for (const mover of MOVERS) {
    for (const rest of RESTS) {
      const where = `${mover.label} against ${rest.label}`;
      await openBareRun(h, {
        challenge: BARE,
        machine: solution([
          ...mover.parts,
          armPart("arm", 2, 0, 3, 1, [...rest.tape]),
        ]),
      });
      const placed = await partIds(h);
      const moving = placed[mover.holder.index] ?? -1;
      const resting = placed[mover.parts.length] ?? -1;
      const mote = await spawnMote(h, HELD, "dust");
      await takeGrip(h, moving, mover.holder.spoke, mote);
      await takeGrip(h, resting, 3, mote);

      const posed = await h.snapshot();
      assertLength(
        posed.sim?.grips ?? [],
        2,
        `${where}: the moving part and the resting part both hold the one mote before the cycle begins`,
      );

      await advanceCycles(h, 1);
      await h.advance(1);
      await captureStill(h, "torn");

      const sim = (await h.snapshot()).sim;
      assertNotNull(sim, `${where}: the run is still live after the cycle`);
      assertEqual(
        sim?.fault?.kind,
        "torn",
        `${where}: no motion and a motion are not the same motion, so the held constellation's imposed motions disagree`,
      );
      assertEqual(
        sim?.status,
        "faulted",
        `${where}: a fault freezes the run where it stood and the status becomes faulted`,
      );
    }
  }
});
