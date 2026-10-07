// runs/bank-keeps-vacated-hexes — the bank accumulates, so nothing ever leaves
// it and `area` never falls.
//
// THE RULE. "The area bank is a set of hexes ACCUMULATED across the run ...
// After every boundary, the settle included, it takes the hex of every mote and
// of every gripper" (`specs/simulation.md`, Completion and metrics). The bank
// only ever takes; no sentence of `specs/` gives it anything back, so a hex a
// mote has moved off, and a hex whose mote a set consumed — "An accepted
// constellation is consumed whole" (`specs/sigils.md`) — are in the bank
// afterwards exactly as they were the moment they were banked.
//
// THE CONFIGURATION LEAVES A HEX BEHIND, THEN EMPTIES ANOTHER. One `arm` at the
// origin, rotation `0`, length `1`, whose tape is `rotate-cw`, `rotate-cw`,
// `drop`, carrying one `sol` held through the gate `specs/instrumentation.md`
// names, "`setGrip`, which takes hold with no `grab` ever running"; and the set
// for `BARE`'s one product, placed on `(-1, 1)`, which is where the two turns
// leave the mote.
//
//   - Cycle `0` carries the mote from `(1, 0)` to `(0, 1)`, a hex nothing had
//     banked, and the boundary takes it.
//   - Cycle `1` carries it on to `(-1, 1)`, VACATING `(0, 1)`, which nothing
//     stands on for the rest of the run.
//   - Cycle `2` is `drop`, so the mote is unheld at the boundary and the set
//     accepts it — "a constellation is accepted when it is unheld and is exactly
//     the placed pattern" — CONSUMING it and emptying `(-1, 1)` of motes.
//
// The completion switch is held off and `BARE`'s target is six, so the delivery
// does not end the run.
//
// THE VERDICT. `area` is read at the run's opening and after each of the three
// cycles, and it never falls. Its final value is four — the anchor, the set's
// footprint hex, the gripper's resting hex, and the vacated `(0, 1)` — which is
// the count only a bank that KEPT the two emptied hexes can report: a bank
// holding what is occupied at the end would report two.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { at, type Hex } from "../field";
import { armPart, setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  tallyOf,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The gripper's resting hex, the hex cycle `0` vacates it for, and the set's hex. */
const START_HEX = at(1, 0);
const VACATED_HEX = at(0, 1);
const SET_HEX = at(-1, 1);
const SPOKE = 0;

/** One arm that turns twice and then opens, and the set the second turn reaches. */
const MACHINE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw", "rotate-cw", "drop"]),
  setPart(0, SET_HEX.q, SET_HEX.r),
]);

/** Everything the run ever banks, as distinct `"q,r"` keys. */
const BANKED = new Set(
  [ORIGIN, SET_HEX, START_HEX, VACATED_HEX].map(
    (hex: Hex) => `${hex.q},${hex.r}`,
  ),
);

/** How many cycles the scenario runs, and which product the set serves. */
const CYCLES = 3;
const PRODUCT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a vacated hex and a consumed mote's hex, so area never falls", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const arm = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, START_HEX, "sol");
  await takeGrip(h, arm, SPOKE, mote);

  const opened = await h.snapshot();

  const seen = await captureReplay(h, "accumulate", async () => {
    const boundaries: OrrerySnapshot[] = [];
    for (let n = 0; n < CYCLES; n += 1) {
      await advanceCycles(h, 1);
      boundaries.push(await h.snapshot());
    }
    return boundaries;
  });

  assertNotNull(opened.sim, "the run is live once it has been started");

  const readings = [opened, ...seen];
  for (const [n, snapshot] of readings.entries()) {
    assertNotNull(snapshot.sim, `the run is still live at reading ${n}`);
    if (n === 0) continue;
    assertGreaterThanOrEqual(
      snapshot.sim?.area ?? -1,
      (readings[n - 1] as OrrerySnapshot).sim?.area ?? 0,
      `the bank only ever takes, so area never falls between reading ${n - 1} and reading ${n}`,
    );
  }

  const carried = seen[1] as OrrerySnapshot;
  assertEqual(
    moteAt(carried, SET_HEX)?.id,
    mote,
    "cycle 1 really carries the mote off (0, 1) and onto the set's hex, vacating the hex cycle 0 banked",
  );

  const delivered = seen[2] as OrrerySnapshot;
  assertLength(
    delivered.sim?.motes ?? [],
    0,
    "cycle 2 drops the mote, so the set accepts and consumes it, emptying the hex it rested on",
  );
  assertEqual(
    tallyOf(delivered, PRODUCT),
    1,
    "the set really consumed it: its tally rises by 1 for a plain product",
  );
  assertEqual(
    delivered.sim?.area,
    BANKED.size,
    "a hex a mote has left, and a hex whose mote a set consumed, stay in the bank, so area still counts all four",
  );
});
