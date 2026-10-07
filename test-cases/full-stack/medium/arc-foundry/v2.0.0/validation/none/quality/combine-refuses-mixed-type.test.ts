// quality/combine-refuses-mixed-type — a fold is not offered across two different types.
//
// specs/scrap-press.md fixes what a quality-combine is offered on: "A
// quality-combine is offered on a base structure that has a matching partner
// anywhere on the yard, and on nothing else", and "A quality-combine only ever
// folds a same-type, same-quality pair". specs/controls.md and specs/hud.md fix
// how an unavailable action reads: it "is drawn disabled in its slot, visibly
// inert and ignoring clicks".
//
// TWO MISMATCHES, TWO POINTS. A match rule has two halves and a build can hold one
// and drop the other: a build that checks the type and ignores the tier folds a
// Scrap Capacitor into a Tuned one while refusing a Coil, which is a different
// defect from one that folds anything at all. So `combine-refuses-mixed-type`
// decides the type half and `combine-refuses-mixed-tier` decides the tier half.
//
// HOW IT IS DECIDED. A Capacitor beside a Coil, both at Charged — posed alone on the yard, so neither piece
// has any partner but the other. Each side is read — the inspector's COMBINE
// control is disabled — and a combine is then committed on each side anyway,
// because an operation standing for a control commits through that control and is
// refused wherever the control is refused (specs/instrumentation.md). Nothing on
// the yard may move.

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

it("offers no fold on a mismatched type, and folds neither piece", async () => {
  await openYard(h);
  // A Capacitor beside a Coil, both at Charged: the tiers match and the types do
  // not, so neither piece has a matching partner.
  const left = await standComponent(h, "capacitor", 3, LEFT.col, LEFT.row);
  const right = await standComponent(h, "coil", 3, RIGHT.col, RIGHT.row);

  await h.debug.select(left);
  assertEqual(
    (await panelControl(h, "combine")).disabled,
    true,
    "COMBINE disabled on a Capacitor whose only neighbour is a Coil",
  );
  await h.debug.select(right);
  assertEqual(
    (await panelControl(h, "combine")).disabled,
    true,
    "COMBINE disabled on a Coil whose only neighbour is a Capacitor",
  );

  await h.advance(1);
  await captureStill(h, "refused");

  await h.debug.combine(left);
  await h.debug.combine(right);

  const after = await h.snapshot();
  assertLength(after.structures, 2, "the mismatched types both still standing");
  assertEqual(anchored(after, LEFT).kind, "component");
  assertEqual(anchored(after, LEFT).type, "capacitor");
  assertEqual(
    anchored(after, LEFT).quality,
    3,
    "the Capacitor's tier, unfolded",
  );
  assertEqual(anchored(after, RIGHT).kind, "component");
  assertEqual(anchored(after, RIGHT).type, "coil");
  assertEqual(anchored(after, RIGHT).quality, 3, "the Coil's tier, unfolded");
});
