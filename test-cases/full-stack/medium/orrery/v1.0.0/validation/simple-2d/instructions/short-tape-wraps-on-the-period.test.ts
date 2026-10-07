// instructions/short-tape-wraps-on-the-period — a tape shorter than the period
// restarts on the PERIOD, not on its own length.
//
// THE RULE. "On cycle `c`, counted from `0`, each part executes the cell at index
// `c` modulo `P` of its own tape, blank cells included; a cell at or past the
// tape's own length is blank" (`specs/instructions.md`, Tapes and the period).
// The index is `c` modulo `P` for EVERY part — `P` is "the largest tape length
// across its arms and wheels", one figure for the whole machine — so a two-cell
// tape on a machine of period `5` runs cells `0` and `1`, then rests through
// three cells it does not have, and starts again on cycle `5`. A blank "is a
// rest: the part holds its pose for the cycle" (`specs/instructions.md`), and
// `specs/simulation.md` adds that it "is a rest on every part, a wheel included,
// and never faults".
//
// THE CONFIGURATION. A bare run — reset, a posed challenge, an empty machine, the
// completion switch held off, a live run, an empty field — with two parts spawned
// back and nothing else. The SHORT tape is a `piston` at `(0, 0)`, rest length
// `1`, carrying `extend` then `retract`: two cells, and a length that returns to
// where it started, so the reading at every later boundary is `1` unless
// something ran cell `0` again. The LONG tape belongs to a plain `arm` at
// `(3, 0)` and is five cells of which only the last, cell `4`, is non-blank — a
// `rotate-cw` — so the machine's period is `5` while nothing about the long arm
// touches the piston. The field is empty, so no mote can collide and no sigil can
// act.
//
// WHAT SEPARATES THE TWO READINGS. On cycle `2` a build indexing `c` modulo the
// part's OWN length runs the piston's cell `0` and leaves it at length `2`; the
// rule leaves it at `1`, because cell `2` is past that tape's length and is
// blank. On cycle `5` the rule runs cell `0` and the length rises to `2`; a build
// wrapping on its own length would have done that on cycles `2` and `4` instead.
// So the two builds disagree at every boundary from the third onward.
//
// THE CONFIGURATION REALLY RAN, and this check reads that rather than assuming
// it: the long arm's `rotate-cw` on cycle `4` turns it from rotation `0` to
// rotation `1`, which is the reading that says the five-cell tape was fetched at
// all rather than the machine standing still.
//
// THE VERDICT. The machine reports a period of `5`; the piston stands at length
// `2`, `1`, `1`, `1`, `1`, `2` at the six boundaries of cycles `0` to `5`; and
// the long arm stands at rotation `1` from the end of cycle `4` onward.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, EAST, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** The short tape: two cells, and a length back where it started after them. */
const SHORT_TAPE = ["extend", "retract"] as const;

/** The long tape: five cells, only the last non-blank. */
const LONG_TAPE = [null, null, null, null, "rotate-cw"] as const;

/** The machine's period: the long tape's length. */
const PERIOD = LONG_TAPE.length;

/**
 * What the piston's length is at each boundary, and what the long arm's rotation
 * is. Cycle `2` is the one a build wrapping on the tape's own length gets wrong,
 * and cycle `5` is the one the rule says restarts the short tape.
 */
const BOUNDARIES: readonly {
  cycle: number;
  length: number;
  rotation: number;
  why: string;
}[] = [
  { cycle: 0, length: 2, rotation: 0, why: "cell 0 of the short tape: extend" },
  {
    cycle: 1,
    length: 1,
    rotation: 0,
    why: "cell 1 of the short tape: retract",
  },
  {
    cycle: 2,
    length: 1,
    rotation: 0,
    why: "cell 2 is past the short tape's length, so it is blank and the piston rests",
  },
  { cycle: 3, length: 1, rotation: 0, why: "cell 3 is blank on both tapes" },
  {
    cycle: 4,
    length: 1,
    rotation: 1,
    why: "cell 4 is blank on the short tape and the long tape's rotate-cw",
  },
  {
    cycle: 5,
    length: 2,
    rotation: 1,
    why: "5 modulo 5 is 0: the short tape restarts on the PERIOD, on cell 0's extend",
  },
];

/** One boundary's reading, kept for the verdict to read afterwards. */
interface Reading {
  cycle: number;
  length: number;
  rotation: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restarts a two-cell tape on cycle 5 of a period-5 machine, not on cycle 2", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [...SHORT_TAPE]),
      armPart("arm", EAST.q, EAST.r, 0, ARM_MIN_LEN, [...LONG_TAPE]),
    ]),
  });
  const [piston = -1, arm = -1] = await partIds(h);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.period,
    PERIOD,
    "the long tape is five cells long, so the machine's period is 5",
  );

  const readings = await captureReplay(
    h,
    "shared-loop",
    async (): Promise<Reading[]> => {
      const seen: Reading[] = [];
      for (const boundary of BOUNDARIES) {
        await advanceCycles(h, 1);
        const snapshot = await h.snapshot();
        const short = poseOf(snapshot, piston);
        const long = poseOf(snapshot, arm);
        assertNotNull(
          short,
          `the piston has a live pose at the end of cycle ${boundary.cycle}`,
        );
        assertNotNull(
          long,
          `the long-taped arm has a live pose at the end of cycle ${boundary.cycle}`,
        );
        seen.push({
          cycle: boundary.cycle,
          length: short?.length ?? -1,
          rotation: long?.rotation ?? -1,
        });
      }
      return seen;
    },
  );

  for (const [index, boundary] of BOUNDARIES.entries()) {
    const seen = readings[index];
    assertNotNull(seen, `cycle ${boundary.cycle} was driven`);
    assertEqual(
      seen?.length,
      boundary.length,
      `at the end of cycle ${boundary.cycle} the two-cell tape's piston stands at length ${boundary.length} — ${boundary.why}`,
    );
    assertEqual(
      seen?.rotation,
      boundary.rotation,
      `at the end of cycle ${boundary.cycle} the five-cell tape's arm stands at rotation ${boundary.rotation}, which is what says the long tape was fetched at all`,
    );
  }
});
