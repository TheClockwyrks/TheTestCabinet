// parts/sigil-costs — what each of the eleven charged sigils costs, measured one
// at a time on an empty machine.
//
// THE RULE. "`PART_COSTS` fixes them" (`specs/parts.md`, Costs), and its table
// charges `bind` `10`, `manifold` `30`, `triune` `20`, `sunder` `10`, `wane`
// `10`, `mirror` `20`, `ascend` `20`, `conjoin` `20`, `eclipse` `30`,
// `confluence` `20`, and `dispersion` `20`. Those are eleven of the twelve
// transforming sigils `specs/parts.md`'s roster names — "`bind` through `void`
// are the twelve transforming sigils" — and the twelfth, `void`, is charged `0`,
// which is its own point beside `rise` and `set`. The figure the check reads is
// the machine's cost, which `specs/instrumentation.md` derives as "`PART_COSTS`
// over the parts, as `specs/parts.md` computes it".
//
// THE CONFIGURATION. One challenge open in the editor, and for each kind in turn
// an EMPTY machine with exactly one sigil of that kind anchored at the origin.
// "A machine's cost is the sum of its placed parts' costs" (`specs/parts.md`), so
// a sum over one part is that part's cost, and emptying the machine before each
// measurement is what makes the reading a per-part price rather than a running
// total. Every one of these footprints lies within one hex of its anchor
// (`specs/sigils.md`), so anchored at `(0, 0)` each of them is on the field, and
// no part of the previous measurement is left to overlap it. No run is started.
//
// THE VERDICT. For each kind the machine costs `0` before the placement, and the
// change the placement makes is `PART_COSTS`'s entry for that kind.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PART_COSTS, type SigilName } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  type Harness,
} from "../harness";

/**
 * The eleven transforming sigils `PART_COSTS` charges for, in the order
 * `specs/parts.md`'s roster lists them. `void`, the twelfth, is free.
 */
const CHARGED: readonly SigilName[] = [
  "bind",
  "manifold",
  "triune",
  "sunder",
  "wane",
  "mirror",
  "ascend",
  "conjoin",
  "eclipse",
  "confluence",
  "dispersion",
];

/** One kind's price, read as a change on an empty machine. */
interface Measured {
  kind: SigilName;
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

it("charges each of the eleven charged sigils what PART_COSTS says", async () => {
  await openChallengeDocument(h, BARE);

  const seen: Measured[] = [];
  for (const kind of CHARGED) {
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
