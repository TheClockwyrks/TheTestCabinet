// runs/metric-cycles — the recorded `cycles` counts the cycles the machine ran,
// which is one more than the index of the last one.
//
// THE RULE. The metric table of `specs/simulation.md` (Completion and metrics)
// gives `cycles` as "`sim.cycle + 1` at the completing boundary: the number of
// cycles the machine ran". The offset is not decoration: "`sim.cycle` counts
// completed cycles. The cycle now running is cycle `sim.cycle`" and "A completing
// or faulting boundary leaves `sim.cycle` at the cycle just run"
// (Cycles and the clock), so a run that finished in its very first cycle sits at
// `sim.cycle` `0` and ran one cycle.
//
// THE CONFIGURATION is the two figures the item names, one after the other, on
// the same one-set machine and a `target` of `1` so a single delivery finishes
// the run:
//
//   * the boundary of cycle `0` — the delivery is posed and one cycle is run, so
//     the run completes at the first boundary there is and records `1`;
//   * the boundary of cycle `11` — the counter is posed to `11` with `setCycle`
//     before the same single cycle is run, so the completing boundary is the
//     twelfth and the run records `12`.
//
// Two figures rather than one because a single one cannot tell `sim.cycle + 1`
// from a constant, and `11` rather than `1` because a build that recorded
// `sim.cycle` itself, or the count of boundaries it happened to have crossed,
// disagrees with the rule at `12` by a margin nothing rounds away.
//
// THE VERDICT is `sim.cycle` and the recorded `cycles` read as a pair at each
// completing boundary: `0` and `1`, then `11` and `12`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { setPart, solution } from "../formats";
import { ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openRun,
  spawnMote,
  type Harness,
} from "../harness";

/** The whole machine: one set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** The later cycle the second run completes at the boundary of. */
const LATER_CYCLE = 11;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records sim.cycle + 1 at the completing boundary, at the first cycle and at the twelfth", async () => {
  /* -- completing at the boundary of cycle 0 ----------------------------- */

  await openRun(h, { challenge: ONE_DELIVERY, machine: ONE_SET });
  await spawnMote(h, ORIGIN, "sol");
  assertEqual(
    (await h.snapshot()).sim?.cycle,
    0,
    "the run begins its first cycle at counter 0",
  );

  await advanceCycles(h, 1);

  const first = await h.snapshot();
  assertEqual(
    first.sim?.status,
    "complete",
    "the delivery reached the target of 1 at the first boundary",
  );
  assertEqual(
    first.sim?.cycle,
    0,
    "the completing boundary leaves sim.cycle at the cycle just run",
  );
  assertNotNull(
    first.sim?.metrics ?? null,
    "a completed run records its metrics",
  );
  assertEqual(
    first.sim?.metrics?.cycles,
    1,
    "a run completing at the boundary of cycle 0 ran one cycle",
  );

  /* -- completing at the boundary of cycle 11 ---------------------------- */

  await openRun(h, { challenge: ONE_DELIVERY, machine: ONE_SET });
  await h.debug.setCycle(LATER_CYCLE);
  await spawnMote(h, ORIGIN, "sol");
  assertEqual(
    (await h.snapshot()).sim?.cycle,
    LATER_CYCLE,
    "the counter is posed, so the cycle now running is cycle 11",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "cycles");

  const later = await h.snapshot();
  assertEqual(
    later.sim?.status,
    "complete",
    "the delivery reached the target at the boundary of cycle 11",
  );
  assertEqual(
    later.sim?.cycle,
    LATER_CYCLE,
    "the completing boundary leaves sim.cycle at the cycle just run",
  );
  assertNotNull(
    later.sim?.metrics ?? null,
    "a completed run records its metrics",
  );
  assertEqual(
    later.sim?.metrics?.cycles,
    LATER_CYCLE + 1,
    "a run completing at the boundary of cycle 11 ran twelve cycles",
  );
});
