// Arc Foundry — animation/load-cycle-animates: a unit's idle cycle LOOPS on the
// yard rather than holding its first frame.
//
// THE REQUIREMENT, from `specs/assets.md`: "An idle cycle loops while its subject
// is on the yard", and what the Load's cycles must deliver is "that the Load
// visibly crackles". Frame `0` "doubles as the unit's still sprite", so a build
// that produced four frames and drew only the first satisfies
// `animation/load-cycles-present` and fails here — which is exactly the split
// between the two points.
//
// THE SCENARIO. One Mote on an emptied yard, its travel held and nothing else
// posed, so the pixels over it can change for one reason only. Holding the travel
// is what makes the reading a reading about the cycle: a unit that walks moves
// its own sprite across the lattice, and the pixels would change whether or not
// anything was animating. `specs/instrumentation.md` holds travel alone — the unit
// keeps every other faculty — and `specs/assets.md` loops the cycle "while its
// subject is on the yard" rather than while it walks, so a held unit crackles.
//
// THE WINDOW, AND WHY IT IS NOT THE SINGLE PAIR THE ITEM DESCRIBES. The
// specification fixes the four frames and deliberately fixes no rate for them, so
// two readings a fixed interval apart can land on the same frame of a perfectly
// good loop. The reading instead runs every frame over half a second and asks that
// the lattice hold more than one picture across it, which is the same requirement
// without the aliasing: any loop of four frames played at four frames a second or
// faster shows at least two of them inside half a second, and a build holding
// frame `0` shows exactly one however long the window is.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { tileCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  ticks,
  type Harness,
} from "../harness";
import { distinct, lattice, readOverFrames } from "./region";

/** Where the unit is held: clear ground, well away from the chain's platforms. */
const AT = tileCenter(24, 16);

/** Inside the `20 x 20` frame `specs/assets.md` draws a Mote at. */
const POINTS = lattice(AT, 8, 2);

/** Half a second, read frame by frame. */
const WINDOW = ticks(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws more than one picture over a held unit inside half a second", async () => {
  await openYard(h, { wave: 1 });
  await parkUnit(h, "mote", AT);
  await h.advance(1);

  const cycle = await captureReplay(h, "cycle", () =>
    readOverFrames(h, POINTS, WINDOW),
  );

  assertGreaterThanOrEqual(
    distinct(cycle),
    2,
    "the pixels over a held unit to take more than one picture across half a " +
      "second, so its idle cycle loops rather than holding frame 0 " +
      "(specs/assets.md)",
  );
});
