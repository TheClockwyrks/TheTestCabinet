// hopping/cooldown-releases — a press at the cooldown moves a further tile.
//
// specs/hopping.md (The cadence): "The cooldown counts down with the simulation,
// and the critter hops whenever a direction is being requested and the cooldown
// has reached `0`", with `HOP_COOLDOWN` at `0.12` s. So the press that the
// previous item's cooldown swallowed is accepted once that cooldown has run
// out, and the critter moves one further tile.
//
// The positive half of the cadence, posed exactly as its negative half
// (hopping/cooldown-blocks) is: the same two separate presses up the same empty,
// quiet strait, moved apart by the cooldown instead of half of it. A build that
// never lets the cooldown lapse fails here and passes there; a build with no
// cooldown at all passes here and fails there.

import { afterEach, beforeEach, it } from "vitest";
import { HOP_COOLDOWN } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  critterTile,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Frames of rest between the two press frames: the whole ticks `HOP_COOLDOWN`
 * covers (`14.4`, so `14`), plus the one tick on which a cooldown that long
 * finishes counting down. The second press therefore lands at the first moment
 * specs/hopping.md permits a hop, and not before it.
 */
const REST_FRAMES = ticksFor(HOP_COOLDOWN) + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a second hop from a press at the cooldown", async () => {
  startCrossing(h);
  const start = critterTile(h.snapshot());

  const seen = await captureReplay(h, "hop", async () => {
    const first = await hop(h, "up");
    await h.advance(REST_FRAMES);
    const second = await hop(h, "up");
    return { first, second, at: critterTile(h.snapshot()) };
  });

  assertTrue(
    seen.first,
    "the first hop up, from the near shore, to be accepted",
  );
  assertEqual(seen.second, true, "the second press, at the cooldown, to hop");
  assertEqual(seen.at.row, start.row - 2, "the row after two hops up");
  assertEqual(seen.at.col, start.col, "the column after two hops up");
});
