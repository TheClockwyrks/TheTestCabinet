// quality/teslaprime-terminal — Tesla-Prime is the top rung of the ladder.
//
// specs/scrap-press.md fixes the ladder's ceiling: the quality-combine table runs
// "Two Primed" to "One Tesla-Prime" and stops there, and "Tesla-Prime is the top
// rung and offers no quality-combine". specs/components.md fixes that the ladder
// has five rungs and no sixth. So a matching Tesla-Prime pair is the one pair that
// matches and still offers nothing, and this is the edge case of its own that the
// general rule implies.
//
// The yard holds exactly the pair: two Tesla-Prime Capacitors, standing components
// and nothing else. The inspector's COMBINE control is read on each of them, and a
// combine is committed on each anyway — an operation standing for a control is
// refused wherever that control is refused (specs/instrumentation.md), so a build
// that folds them fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  panelControl,
  standComponent,
  type Harness,
} from "../harness";
import { anchored } from "./anchors";

const LEFT = { col: 8, row: 10 };
const RIGHT = { col: 12, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers no fold on a Tesla-Prime pair and folds it on neither side", async () => {
  await openYard(h);
  const left = await standComponent(h, "capacitor", 5, LEFT.col, LEFT.row);
  const right = await standComponent(h, "capacitor", 5, RIGHT.col, RIGHT.row);

  await h.debug.select(left);
  assertEqual(
    (await panelControl(h, "combine")).disabled,
    true,
    "COMBINE disabled on a Tesla-Prime with a Tesla-Prime partner",
  );
  await h.debug.select(right);
  assertEqual(
    (await panelControl(h, "combine")).disabled,
    true,
    "COMBINE disabled on the other Tesla-Prime of the pair",
  );

  await h.advance(1);
  await captureStill(h, "terminal");

  await h.debug.combine(left);
  await h.debug.combine(right);

  const after = await h.snapshot();
  assertLength(after.structures, 2, "both Tesla-Primes still standing");
  assertEqual(anchored(after, LEFT).kind, "component");
  assertEqual(anchored(after, LEFT).quality, 5, "the left piece's tier");
  assertEqual(anchored(after, RIGHT).kind, "component");
  assertEqual(anchored(after, RIGHT).quality, 5, "the right piece's tier");
  assertLength(
    after.structures.filter((s) => s.kind === "blocker"),
    0,
    "no footprint consumed, because there was no fold to consume it",
  );
});
