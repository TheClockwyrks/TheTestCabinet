// parts/cost-is-the-sum-of-placed-parts — the reported cost is the sum over the
// machine, and it moves by exactly one part's cost as that part comes and goes.
//
// THE RULE. "A machine's cost is the sum of its placed parts' costs. `PART_COSTS`
// fixes them" (`specs/parts.md`, Costs). The figure is reported in two places and
// derived in both: the heading carries "the machine's current cost"
// (`specs/editor.md`, Layout), and `editor.cost` is "`PART_COSTS` over the parts,
// as `specs/parts.md` computes it" (`specs/instrumentation.md`). An empty machine
// is a sum over nothing, which `specs/instrumentation.md` writes down as the
// resting value: `editor` reports "empty `parts`, `cost` `0`".
//
// THE CONFIGURATION. One challenge open in the editor and nothing else, with five
// parts of five different classes placed one at a time — an arm, a biarm, a
// wheel, a `bind` sigil, and a three-cell track — and then taken off one at a
// time in a different order. Every anchor, footprint and cell is on the field and
// clear of every other, so each placement is legal on its own terms and the only
// thing changing between two readings is the one part that arrived or left. No
// run is started: cost is the editor's figure, and a run would only give the
// world something else to do.
//
// WHAT IS COMPARED. After every step the build's `editor.cost` is read against
// `machineCost` over the parts this check has placed — `parts.ts`'s reading of
// `PART_COSTS`, which is the specification's table rather than the build's — and
// the CHANGE across the step is read against `partCost` of the one part that
// moved. So the sum is checked as a sum, and "rising as a part is placed and
// falling by exactly that part's cost as it is removed" is checked as a
// difference.
//
// THE VERDICT. The empty machine costs `0`, every running total is the sum over
// what stands, every placement raises the cost by exactly that part's cost, every
// removal lowers it by exactly that part's cost, and the drained machine is back
// at `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { type PartName } from "../constants";
import { at } from "../field";
import { armPart, sigilPart, trackPart, type SolutionPart } from "../formats";
import { BARE } from "../fixtures";
import { machineCost, partCost } from "../parts";
import {
  captureReplay,
  createHarness,
  openChallengeDocument,
  placePart,
  placeTrack,
  type Harness,
} from "../harness";

/** One part this check builds the machine out of, and how it is placed. */
interface Step {
  /** The part as a solution document writes it, which is what the sum is over. */
  part: SolutionPart;
  /** Placing it through the surface, answering its id. */
  place: (h: Harness) => Promise<number>;
}

const TRACK_CELLS = [at(0, -3), at(1, -3), at(2, -3)];

const STEPS: readonly Step[] = [
  {
    part: armPart("arm", 0, 0, 0, 1, []),
    place: (h) => placePart(h, "arm", at(0, 0), 0),
  },
  {
    part: armPart("biarm", 2, 0, 0, 1, []),
    place: (h) => placePart(h, "biarm", at(2, 0), 0),
  },
  {
    part: armPart("wheel", -2, 0, 0, 1, []),
    place: (h) => placePart(h, "wheel", at(-2, 0), 0),
  },
  {
    part: sigilPart("bind", 0, 3, 0),
    place: (h) => placePart(h, "bind", at(0, 3), 0),
  },
  {
    part: trackPart(TRACK_CELLS),
    place: (h) => placeTrack(h, TRACK_CELLS),
  },
];

/** The order the five come off again, which is not the order they went on. */
const REMOVAL_ORDER: readonly PartName[] = [
  "wheel",
  "bind",
  "track",
  "arm",
  "biarm",
];

/** The machine's reported cost against the sum over what stands. */
interface Total {
  label: string;
  cost: number;
  expected: number;
}

/** One step's change in cost against the cost of the part that moved. */
interface Delta {
  label: string;
  moved: number;
  expected: number;
}

/** Everything the drive read, handed back for the verdict to read afterwards. */
interface Run {
  totals: Total[];
  deltas: Delta[];
  empty: number;
  drained: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The machine's cost, off a fresh snapshot. */
async function cost(): Promise<number> {
  return (await h.snapshot()).editor.cost;
}

it("reports the sum of its parts' costs as parts are placed and removed", async () => {
  await openChallengeDocument(h, BARE);

  const measured = await captureReplay(h, "cost", async (): Promise<Run> => {
    const totals: Total[] = [];
    const deltas: Delta[] = [];
    const standing: { part: SolutionPart; id: number }[] = [];

    await h.debug.clearMachine();
    await h.advance(1);
    const empty = await cost();
    totals.push({ label: "the empty machine", cost: empty, expected: 0 });

    let previous = empty;
    for (const step of STEPS) {
      const id = await step.place(h);
      standing.push({ part: step.part, id });
      await h.advance(1);
      const now = await cost();
      totals.push({
        label: `with the ${step.part.kind} placed`,
        cost: now,
        expected: machineCost(standing.map((entry) => entry.part)),
      });
      deltas.push({
        label: `placing the ${step.part.kind}`,
        moved: now - previous,
        expected: partCost(step.part),
      });
      previous = now;
    }

    for (const kind of REMOVAL_ORDER) {
      const index = standing.findIndex((entry) => entry.part.kind === kind);
      const target = standing[index];
      if (target === undefined) {
        fail(
          `a placed ${kind} to remove`,
          standing.map((entry) => entry.part.kind),
        );
      }
      standing.splice(index, 1);
      await h.debug.removePart(target.id);
      await h.advance(1);
      const now = await cost();
      totals.push({
        label: `with the ${kind} removed`,
        cost: now,
        expected: machineCost(standing.map((entry) => entry.part)),
      });
      deltas.push({
        label: `removing the ${kind}`,
        moved: now - previous,
        expected: -partCost(target.part),
      });
      previous = now;
    }

    return { totals, deltas, empty, drained: previous };
  });

  assertEqual(measured.empty, 0, "an empty machine costs 0");
  assertEqual(
    measured.drained,
    0,
    "a machine every part has been taken off again costs 0",
  );
  for (const total of measured.totals) {
    assertEqual(
      total.cost,
      total.expected,
      `the cost is the sum of the placed parts' costs from PART_COSTS: ${total.label}`,
    );
  }
  for (const delta of measured.deltas) {
    assertEqual(
      delta.moved,
      delta.expected,
      `the cost moves by exactly that part's cost: ${delta.label}`,
    );
  }
});
