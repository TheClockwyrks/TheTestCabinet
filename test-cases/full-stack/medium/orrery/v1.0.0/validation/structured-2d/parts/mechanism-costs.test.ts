// parts/mechanism-costs — what each of the six mechanisms with a per-part price
// costs, measured one at a time on an empty machine.
//
// THE RULE. "`PART_COSTS` fixes them" (`specs/parts.md`, Costs), and its table
// charges `arm` `20`, `biarm` `30`, `triarm` `40`, `hexarm` `60`, `piston` `40`,
// and `wheel` `30`. Those six are the mechanisms of the roster whose price is per
// part; `track` is the seventh and is charged "`5` per cell" instead, which is
// its own point. The figure the check reads is the machine's cost, which
// `specs/instrumentation.md` derives as "`PART_COSTS` over the parts, as
// `specs/parts.md` computes it" and `specs/editor.md` shows in the heading.
//
// THE CONFIGURATION. One challenge open in the editor, and for each kind in turn
// an EMPTY machine with exactly one part of that kind anchored at the origin.
// "A machine's cost is the sum of its placed parts' costs" (`specs/parts.md`), so
// a sum over one part is that part's cost, and a machine emptied before each
// measurement is what makes the reading a per-part price rather than a running
// total. Every kind is anchored on `(0, 0)`, which is on the field, and no part
// of the previous measurement is left to share it. No run is started.
//
// THE VERDICT. For each kind the machine costs `0` before the placement, and the
// change the placement makes is `PART_COSTS`'s entry for that kind.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PART_COSTS, type PartName } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  type Harness,
} from "../harness";

/**
 * The six mechanisms `PART_COSTS` charges a flat price for, in the order
 * `specs/parts.md`'s roster lists them.
 */
const MECHANISMS: readonly PartName[] = [
  "arm",
  "biarm",
  "triarm",
  "hexarm",
  "piston",
  "wheel",
];

/** One kind's price, read as a change on an empty machine. */
interface Measured {
  kind: PartName;
  empty: number;
  placed: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("charges each of the six mechanisms what PART_COSTS says", async () => {
  await openChallengeDocument(h, BARE);

  const seen: Measured[] = [];
  for (const kind of MECHANISMS) {
    await h.debug.clearMachine();
    await h.advance(1);
    const empty = (await h.snapshot()).editor.cost;
    await placePart(h, kind, ORIGIN, 0);
    await h.advance(1);
    seen.push({ kind, empty, placed: (await h.snapshot()).editor.cost });
  }

  await captureStill(h, "costs");

  for (const entry of seen) {
    assertEqual(
      entry.empty,
      0,
      `the machine is empty before the ${entry.kind} is placed`,
    );
    assertEqual(
      entry.placed - entry.empty,
      PART_COSTS[entry.kind],
      `placing one ${entry.kind} on an empty machine costs PART_COSTS.${entry.kind}`,
    );
  }
});
