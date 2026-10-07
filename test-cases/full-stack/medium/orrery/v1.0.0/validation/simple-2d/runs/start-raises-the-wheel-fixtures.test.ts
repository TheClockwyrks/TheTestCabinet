// runs/start-raises-the-wheel-fixtures — a run puts a placed wheel's six fixtures
// on its six adjacent hexes.
//
// THE RULE. "Starting a run: 1. Every arm and wheel takes its rest pose, holding
// nothing, and every wheel's six fixtures appear on its spoke hexes"
// (`specs/simulation.md`, The run). What those six are, and where they sit, is
// `specs/parts.md`: "A `wheel` is a hub on its anchor hex carrying six fixture
// motes, one on each adjacent hex." `specs/instrumentation.md` restates it under
// `startRun`: "every wheel's six fixtures placed". Each is a mote of the run like
// any other, distinguished by one field: `wheel` "names the wheel a fixture
// belongs to and is `null` on every real mote" (`specs/state.md`).
//
// THE CONFIGURATION. One wheel at the origin, rotation `0`, empty tape, on a
// challenge whose machine holds no rise and no set — so nothing else spawns a
// mote and every mote on the field is one of the six. The run is opened with
// `openRun`, which leaves the field exactly as `startRun` raised it; the check
// that clears the field would have swept the fixtures away with everything else.
//
// THE VERDICT. Six motes name the wheel, and the hexes they rest on are the
// wheel's six adjacent hexes — compared as a SET, because no sentence of the
// specification fixes the order `sim.motes` lists them in. No mote on the field
// is anything else.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  looseMotes,
  openRun,
  partIds,
  type Harness,
} from "../harness";
import { wheelFixtureHexes } from "../parts";

/** One wheel at the origin, unrotated, resting on an empty tape. */
const MACHINE = solution([armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, [])]);

/** The six adjacent hexes of the wheel's anchor, as sorted `"q,r"` keys. */
const RING = wheelFixtureHexes(ORIGIN)
  .map((hex) => `${hex.q},${hex.r}`)
  .sort();

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises six fixtures naming the wheel, on the wheel's six adjacent hexes", async () => {
  await openRun(h, { challenge: BARE, machine: MACHINE });
  const wheel = (await partIds(h))[0] ?? -1;

  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "ring");

  assertNotNull(snapshot.sim, "the run is live once it has been started");

  const fixtures = fixturesOf(snapshot, wheel);
  assertLength(
    fixtures,
    6,
    "a placed wheel carries six fixture motes, each reported with wheel naming the wheel it belongs to",
  );
  assertDeepEqual(
    fixtures.map((mote) => `${mote.q},${mote.r}`).sort(),
    RING,
    "the six fixtures appear on the wheel's spoke hexes: one on each adjacent hex",
  );
  assertLength(
    looseMotes(snapshot),
    0,
    "nothing but the wheel's fixtures is on the field, so the six read above are the six the run raised",
  );
});
