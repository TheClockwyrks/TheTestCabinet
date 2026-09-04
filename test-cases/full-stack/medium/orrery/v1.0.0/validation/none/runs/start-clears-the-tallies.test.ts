// runs/start-clears-the-tallies — a run opens with every set's tally at `0`, and
// counts only what its own sets consume.
//
// THE RULE. A tally belongs to the run and to nothing else: `sim` is "The whole
// of a run, and `null` while editing" (`specs/state.md`, `SimState`), and
// `tallies` is one of its fields — "one entry per product, in product order".
// `specs/instrumentation.md` fixes what a run opens holding, under `startRun`:
// "every set's tally at `0`". What raises one is `specs/sigils.md`: "An accepted
// constellation is consumed whole, and the set's tally rises by `1` for a plain
// product."
//
// THE CONFIGURATION. `BARE`, whose one product is a single `sol` on `(0, 0)`, and
// a machine of exactly one part: the set for product `0`, placed at the origin,
// so its footprint is that one hex. The field is cleared and one `sol` is spawned
// resting, unbonded and unheld, on it — which is precisely the constellation the
// set accepts. One cycle then runs, and its boundary consumes the delivery. The
// completion switch is held off, so the run carries on past the delivery instead
// of ending on it; `BARE`'s target is six, so one delivery would not have
// completed it in any case.
//
// THE VERDICT. Three readings, in order: the first run really delivers, so its
// tally reads `1`; stopping the run leaves `sim` `null`, which is the whole of
// the reason a tally cannot survive; and the second run of the same machine opens
// with that product's tally at `0` rather than at the `1` the first reached.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at } from "../field";
import { setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  spawnMote,
  stopRun,
  tallyOf,
  type Harness,
} from "../harness";

/** The set for `BARE`'s one product, alone on the machine. */
const MACHINE = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** The product the tally belongs to, and the hex the set's footprint covers. */
const PRODUCT = 0;
const SET_HEX = at(0, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the second run at a tally of 0, though the first run delivered", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  await spawnMote(h, SET_HEX, "sol");
  await advanceCycles(h, 1);

  const delivered = await h.snapshot();

  await stopRun(h);
  const editing = await h.snapshot();

  await h.debug.startRun();
  const second = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "tallies-zero");

  assertNotNull(delivered.sim, "the first run is live after the cycle it ran");
  assertEqual(
    tallyOf(delivered, PRODUCT),
    1,
    "the first run really delivers: the set consumes the sol resting on its footprint and its tally rises by 1",
  );
  assertNull(
    editing.sim,
    "sim is null while editing, so nothing of the first run's tallies is still being held",
  );
  assertNotNull(second.sim, "the second run is live once it has been started");
  assertEqual(
    tallyOf(second, PRODUCT),
    0,
    "a run starts with every set's tally at 0, so the second run begins at 0 rather than at the 1 the first reached",
  );
  assertEqual(
    second.sim?.cycle,
    0,
    "the reading is taken at cycle 0, before any cycle of the second run could have consumed anything",
  );
});
