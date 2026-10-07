// runs/completion-at-the-target — the boundary that brings every tally to the
// target is the boundary the run ends on.
//
// THE RULE. "After the rises, if every set's tally has reached the challenge's
// `target`, the run completes: the status becomes `complete` and the metrics are
// recorded" (`specs/simulation.md`, Completion and metrics). The target is a
// figure of the challenge document: "`target` is a whole number of at least `1`",
// and "every challenge in this game uses `CONSTELLATION_TARGET` (`6`)"
// (`specs/formats.md`) — the figure the overview names as the whole object of the
// game, "`CONSTELLATION_TARGET` (`6`) times without two motes ever colliding".
//
// THE CONFIGURATION is a challenge whose `target` is that figure and one `set`
// standing alone on the field, its tally posed at `CONSTELLATION_TARGET - 1`
// through `setTally`, with one unbonded `sol` resting on its footprint. So the
// cycle this check runs is the sixth delivery of a six-delivery challenge and
// nothing else: no rise refills the hex, no sigil touches the mote, no arm moves.
// The completion switch is left ON, which `openRun` is for — "Completion is the
// game's one autonomous consequence" (`specs/instrumentation.md`).
//
// THE VERDICT. The tally reaches the challenge's target at that boundary and
// `sim.status` is `complete`, with the metrics recorded beside it. The tally is
// read first: a build that never delivered would leave the status alone for a
// reason that belongs to `sigils/`, and this point would take the blame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openRun,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** The whole machine: one set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("completes at the boundary where the only set's tally reaches the target", async () => {
  await openRun(h, { challenge: BARE, machine: ONE_SET });
  assertEqual(
    (await h.snapshot()).challenge?.target,
    CONSTELLATION_TARGET,
    "the posed challenge asks for CONSTELLATION_TARGET, the figure every shipped challenge uses",
  );

  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);
  await spawnMote(h, ORIGIN, "sol");

  const before = await h.snapshot();
  assertEqual(
    before.sim?.status,
    "running",
    "one delivery short of the target, the run is still running",
  );
  assertEqual(
    tallyOf(before, 0),
    CONSTELLATION_TARGET - 1,
    "the tally stands one short of the target before the cycle runs",
  );

  await captureReplay(h, "complete", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(
    after.sim,
    "the run is still reported at the completing boundary",
  );
  assertNull(
    moteAt(after, ORIGIN),
    "the set consumed the product resting on its footprint",
  );
  assertEqual(
    tallyOf(after, 0),
    CONSTELLATION_TARGET,
    "the delivery brought the tally to the challenge's target",
  );
  assertEqual(
    after.sim?.status,
    "complete",
    "at the boundary where every set's tally has reached the target, the run completes",
  );
  assertNotNull(
    after.sim?.metrics ?? null,
    "the metrics are recorded when the run completes",
  );
});
