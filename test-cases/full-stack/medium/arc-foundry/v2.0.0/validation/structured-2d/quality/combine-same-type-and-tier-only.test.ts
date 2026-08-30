// quality/combine-same-type-and-tier-only — a quality fold takes a matching pair alone.
//
// specs/scrap-press.md fixes what a quality-combine is offered on: "A
// quality-combine is offered on a base structure that has a matching partner
// anywhere on the yard, and on nothing else", and "A quality-combine only ever
// folds a same-type, same-quality pair". specs/controls.md and specs/hud.md fix
// how an unavailable action reads: it "is drawn disabled in its slot, visibly
// inert and ignoring clicks".
//
// Two mismatched pairs are posed in turn, each alone on the yard: the same tier at
// two different types, and the same type at two different tiers. Each side of each
// pair is read — the inspector's COMBINE control is disabled — and a combine is
// then committed on each side anyway, because an operation standing for a control
// commits through that control and is refused wherever the control is refused
// (specs/instrumentation.md). Nothing on the yard may move.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  emptyYard,
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

afterEach(() => {
  h.dispose();
});

it("offers no fold on a mismatched type or a mismatched tier, and folds neither", async () => {
  openYard(h);

  // A Capacitor beside a Coil, both at Charged: the tiers match and the types do
  // not, so neither piece has a matching partner.
  const capacitor = standComponent(h, "capacitor", 3, LEFT.col, LEFT.row);
  const coil = standComponent(h, "coil", 3, RIGHT.col, RIGHT.row);

  h.debug.select(capacitor);
  assertEqual(
    panelControl(h, "combine").disabled,
    true,
    "COMBINE disabled on a Capacitor whose only neighbour is a Coil",
  );
  h.debug.select(coil);
  assertEqual(
    panelControl(h, "combine").disabled,
    true,
    "COMBINE disabled on a Coil whose only neighbour is a Capacitor",
  );

  h.debug.combine(capacitor);
  h.debug.combine(coil);

  let after = h.snapshot();
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

  // A Scrap Capacitor beside a Tuned one: the types match and the tiers do not.
  emptyYard(h);
  const scrap = standComponent(h, "capacitor", 1, LEFT.col, LEFT.row);
  const tuned = standComponent(h, "capacitor", 2, RIGHT.col, RIGHT.row);

  h.debug.select(scrap);
  assertEqual(
    panelControl(h, "combine").disabled,
    true,
    "COMBINE disabled on a Scrap Capacitor whose only neighbour is Tuned",
  );
  h.debug.select(tuned);
  assertEqual(
    panelControl(h, "combine").disabled,
    true,
    "COMBINE disabled on a Tuned Capacitor whose only neighbour is Scrap",
  );

  await h.advance(1);
  captureStill(h, "refused");

  h.debug.combine(scrap);
  h.debug.combine(tuned);

  after = h.snapshot();
  assertLength(after.structures, 2, "the mismatched tiers both still standing");
  assertEqual(
    anchored(after, LEFT).quality,
    1,
    "the Scrap Capacitor, unfolded",
  );
  assertEqual(
    anchored(after, RIGHT).quality,
    2,
    "the Tuned Capacitor, unfolded",
  );
  assertEqual(anchored(after, LEFT).kind, "component");
  assertEqual(anchored(after, RIGHT).kind, "component");
});
