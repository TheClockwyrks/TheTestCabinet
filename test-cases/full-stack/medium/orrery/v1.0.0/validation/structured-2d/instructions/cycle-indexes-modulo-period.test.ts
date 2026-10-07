// instructions/cycle-indexes-modulo-period — on cycle `c` a part runs the cell at
// index `c` modulo the period, so the tape loops rather than running out.
//
// THE RULE. "On cycle `c`, counted from `0`, each part executes the cell at index
// `c` modulo `P` of its own tape, blank cells included"
// (`specs/instructions.md`, Tapes and the period), and `specs/simulation.md` says
// it again of the running machine: "each arm and wheel executes its tape cell at
// index `sim.cycle` modulo the period `P` of `specs/instructions.md`" (Cycles and
// the clock). `P` here is the machine's own period, "the largest tape length
// across its arms and wheels", which this machine makes `3`.
//
// THE CONFIGURATION. A bare run — reset, a posed challenge, an empty machine, the
// completion switch held off, a live run, an empty field — with one `piston` at
// `(0, 0)` spawned back and nothing else. Its tape is three cells long and no two
// cells do the same thing: cell `0` is `extend` and cell `2` is `retract`, which
// move the length in opposite directions, and cell `1` is `rotate-cw`, which moves
// the rotation instead. So the pose read at each boundary names the cell that ran
// and could not have been produced by either of the others. The field is empty,
// so no mote can collide and no sigil can act, and the piston's rest pose is
// rotation `0`, length `1`.
//
// THE DRIVE IS FIVE CYCLES, ONE AT A TIME, and the pose is read at every boundary
// — the first three so the tape's own reading is established, then cycles `3` and
// `4`, which are the two the review item names. `3 modulo 3` is `0` and `4 modulo
// 3` is `1`, so the fourth cycle lengthens the piston again and the fifth turns
// it again. A build that ran a tape once and then rested would leave the piston
// at cycle `2`'s pose for both; one that reversed the tape, or restarted it a
// cycle early or late, lands on a different pair.
//
// THE VERDICT. The machine reports a period of `3`; the five boundaries leave the
// piston at `(rot 0, len 2)`, `(1, 2)`, `(1, 1)`, `(1, 2)` and `(2, 2)`; and the
// counter reaches `5`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** Three cells, each moving something the other two do not. */
const TAPE = ["extend", "rotate-cw", "retract"] as const;

/** The machine's period: the one tape's length. */
const PERIOD = TAPE.length;

/**
 * What the piston stands at after each of the first five cycles. Cycles `3` and
 * `4` are cells `0` and `1` over again, which is the rule being decided.
 */
const BOUNDARIES: readonly {
  cycle: number;
  cell: number;
  rotation: number;
  length: number;
  why: string;
}[] = [
  { cycle: 0, cell: 0, rotation: 0, length: 2, why: "0 modulo 3 is 0: extend" },
  {
    cycle: 1,
    cell: 1,
    rotation: 1,
    length: 2,
    why: "1 modulo 3 is 1: rotate-cw",
  },
  {
    cycle: 2,
    cell: 2,
    rotation: 1,
    length: 1,
    why: "2 modulo 3 is 2: retract",
  },
  {
    cycle: 3,
    cell: 0,
    rotation: 1,
    length: 2,
    why: "3 modulo 3 is 0: cell 0 again",
  },
  {
    cycle: 4,
    cell: 1,
    rotation: 2,
    length: 2,
    why: "4 modulo 3 is 1: cell 1 again",
  },
];

/** One boundary's reading, kept for the verdict to read afterwards. */
interface Reading {
  cycle: number;
  counter: number;
  rotation: number;
  length: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("executes cell c modulo P on cycle c, so cycle 3 is cell 0 again", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [...TAPE]),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.period,
    PERIOD,
    "the one tape is three cells long, so the machine's period is 3",
  );

  const readings = await captureReplay(
    h,
    "wrap",
    async (): Promise<Reading[]> => {
      const seen: Reading[] = [];
      for (const boundary of BOUNDARIES) {
        await advanceCycles(h, 1);
        const snapshot = await h.snapshot();
        const pose = poseOf(snapshot, piston);
        assertNotNull(
          pose,
          `the piston has a live pose at the end of cycle ${boundary.cycle}`,
        );
        seen.push({
          cycle: boundary.cycle,
          counter: snapshot.sim?.cycle ?? -1,
          rotation: pose?.rotation ?? -1,
          length: pose?.length ?? -1,
        });
      }
      return seen;
    },
  );

  for (const [index, boundary] of BOUNDARIES.entries()) {
    const seen = readings[index];
    assertNotNull(seen, `cycle ${boundary.cycle} was driven`);
    assertEqual(
      seen?.counter,
      boundary.cycle + 1,
      `the boundary of cycle ${boundary.cycle} leaves the counter at ${boundary.cycle + 1}`,
    );
    assertDeepEqual(
      { rotation: seen?.rotation, length: seen?.length },
      { rotation: boundary.rotation, length: boundary.length },
      `cycle ${boundary.cycle} executed cell ${boundary.cell} — ${boundary.why}`,
    );
  }
});
