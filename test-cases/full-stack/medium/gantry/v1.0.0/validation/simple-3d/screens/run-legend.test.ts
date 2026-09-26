// screens/run-legend — the run screen carries a legend for the utilization ramp.
//
// `specs/ui.md` § Run lists what the screen carries, and among it: "A LEGEND FOR
// THE UTILIZATION RAMP (`specs/overview.md`), SO THE MEMBER COLORING READS." The
// ramp is the run screen's whole account of what the crane is carrying, and a
// player who cannot tell which end of it is slack cannot read the crane.
//
// WHAT THE LEGEND LOOKS LIKE IS THE BUILD'S — its words, its swatches, where it
// sits — so nothing here asks for any of that. `specs/instrumentation.md` has
// `drawn()` carry it by name, and the reading is that it is on screen while a run
// is on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  createHarness,
  entriesOf,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A move that keeps the run running and moves nothing (`specs/rigging.md`). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries a legend for the utilization ramp on the run screen", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  const started = await startRun(h);
  assertEqual(
    started.screen,
    "run",
    "the screen a started run shows (specs/program.md)",
  );
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture("legend", "The run screen's legend for the utilization ramp");

  assertTrue(
    entriesOf(drawn, "aid", "ramp-legend").length > 0,
    "a legend for the utilization ramp among what the run screen drew " +
      "(specs/ui.md)",
  );
});
