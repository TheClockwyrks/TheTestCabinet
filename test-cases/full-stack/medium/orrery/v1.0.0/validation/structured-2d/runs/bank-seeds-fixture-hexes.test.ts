// runs/bank-seeds-fixture-hexes — the area bank opens holding a placed wheel's
// six fixture hexes.
//
// THE RULE. "At the start of the run it takes every hex of every placed part,
// every fixture hex, and every gripper hex at rest" (`specs/simulation.md`,
// Completion and metrics). Where a wheel's fixture hexes are is
// `specs/parts.md`: "A `wheel` is a hub on its anchor hex carrying six fixture
// motes, one on each adjacent hex", raised by the run start itself — "every
// wheel's six fixtures appear on its spoke hexes" (`specs/simulation.md`, The
// run). `sim.area` is what the bank reads as: "distinct hexes banked so far"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION IS CHOSEN SO THAT THE FIXTURE HEXES ARE THE WHOLE OF THE
// DIFFERENCE. The machine is one wheel at the origin and nothing else. A wheel is
// a hub and a ring — "Its anatomy is the hub and its ring alone" — so it carries
// no gripper on any spoke, and the third seed the rule names contributes nothing
// here. That leaves exactly two contributions: the wheel's own anchor, which is
// its one part hex, and the six adjacent hexes its fixtures were raised on. A
// build that banked the part hexes alone would report `1`.
//
// The run is opened with `openRun`, which leaves the field as `startRun` raised
// it: the opener that clears the field would have taken the six fixtures off with
// everything else, which is the faculty gate `specs/instrumentation.md` names for
// a wheel's fixtures, and this point is the one that wants them.
//
// THE VERDICT. `sim.area` is seven — the anchor and the ring, computed from
// `parts.ts`'s `wheelFixtureHexes`, which is the specification's own "one on each
// adjacent hex" — before a single cycle has run. Beside it, the six fixtures are
// read off the field, so the figure is the bank of a wheel that really raised its
// ring.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  openRun,
  partIds,
  type Harness,
} from "../harness";
import { wheelFixtureHexes } from "../parts";

/** One wheel at the origin, unrotated, resting on an empty tape. */
const MACHINE = solution([armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, [])]);

/** The wheel's anchor and its six fixture hexes, as distinct `"q,r"` keys. */
const SEEDED = new Set(
  [ORIGIN, ...wheelFixtureHexes(ORIGIN)].map((hex) => `${hex.q},${hex.r}`),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the bank holding the wheel's anchor and each of its six spoke hexes", async () => {
  await openRun(h, { challenge: BARE, machine: MACHINE });
  const wheel = (await partIds(h))[0] ?? -1;

  const opened = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "seeded");

  assertNotNull(opened.sim, "the run is live once it has been started");
  assertLength(
    fixturesOf(opened, wheel),
    6,
    "the wheel really raised its ring, so there are six fixture hexes for the bank to have taken",
  );

  assertEqual(
    opened.sim?.area,
    SEEDED.size,
    "at the start of the run the bank takes every fixture hex, so a placed wheel banks its six spoke hexes beside its anchor",
  );
});
