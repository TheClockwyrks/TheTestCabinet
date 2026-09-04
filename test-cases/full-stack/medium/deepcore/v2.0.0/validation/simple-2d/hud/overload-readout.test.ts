// hud/overload-readout — the bar says OVERLOAD once the load reaches the limit.
//
// `specs/ui.md`: the cargo reads `OVERLOAD` while the load fraction is `1` or
// more, and `specs/character.md` fixes the fraction as `loadKg / liftLimitKg` and
// the wall as the point the jetpack stops climbing. `OVERLOAD` is copy the
// specification states, so this is the one status-bar point that can read the
// words themselves rather than a treatment.
//
// The bay is loaded either side of the limit with the cargo tier raised, so the
// slot cap is nowhere near reached and what crosses is weight alone. The load
// fractions actually reached are read off the snapshot and asserted to bracket
// `1`, so the pose is known to be the one the requirement is about before the
// screen is read.

import { afterEach, beforeEach, it } from "vitest";
import { OVERLOAD } from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  layCamp,
  loadToFraction,
  openScene,
  pinDrill,
  stageTiers,
  standAtCamp,
  type Harness,
} from "../harness";

/** Where the two poses sit, either side of the limit. */
const UNDER = 0.85;
const OVER = 1.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads OVERLOAD over the lift limit and not under it", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);
  stageTiers(h, { cargo: 5 });

  const under = loadToFraction(h, UNDER);
  const saidUnder = drewText(await h.frameCalls(), OVERLOAD);

  const over = loadToFraction(h, OVER);
  const saidOver = drewText(await h.frameCalls(), OVERLOAD);
  captureStill(h, "overload");

  assertLessThan(under.fraction, 1, "specs/character.md");
  assertGreaterThanOrEqual(over.fraction, 1, "specs/character.md");
  assertEqual(saidUnder, false, "specs/ui.md");
  assertEqual(saidOver, true, "specs/ui.md");
});
