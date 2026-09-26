// screens/hud-shows-mode-label — the HUD draws the deal-mode label the build
// itself reports.
//
// `specs/screens.md`, the HUD: "`DEAL_MODE_LABEL` is drawn in the strip as well,
// so the deal mode is visible throughout play."
// `specs/instrumentation.md` has the snapshot report that same figure as
// `dealModeLabel`.
//
// SO THIS ITEM DECIDES CONSISTENCY DURING PLAY, not the literal. It asks the
// build what its label is and then looks for that text among the runs the
// `playing` screen drew, which is a question worth asking under either variant
// and under all three engines. WHICH literal each variant owes is the variant's
// own item, `draw-one/mode-label-hud` and `draw-three/mode-label-hud`, and no
// literal appears in this file. The title screen's copy of the same label is
// `screens/title-shows-mode-label`: two screens, two items, because a build can
// perfectly well carry it on one and forget it on the other.
//
// The table is left empty, so the label is read off a `playing` screen with
// nothing on it but the HUD — nothing here concerns a card. Where in the strip the
// label sits is what `screens/hud-clear-of-piles` looks at, and how legibly it
// reads against what is behind it is the reviewer's.
//
// THE ONE GUARD. A build reporting an empty label would make the search vacuous,
// since every frame "contains" the empty string; `specs/stock.md` fixes
// `DEAL_MODE_LABEL` as text that is drawn, so the check refuses to grade on an
// empty one rather than passing on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { drewText } from "../case-harness/index";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/** A label has text in it (`specs/stock.md`), so the search below can mean something. */
const MIN_LABEL_LENGTH = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the deal-mode label the snapshot reports", async () => {
  await openTable(h);

  const label = (await h.snapshot()).dealModeLabel;
  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  assertGreaterThanOrEqual(
    typeof label === "string" ? label.trim().length : Number.NaN,
    MIN_LABEL_LENGTH,
    "the length of the dealModeLabel the build reports (specs/stock.md)",
  );
  assertEqual(
    drewText(calls, label),
    true,
    `the HUD draws the build's own deal-mode label, "${String(label)}" (specs/screens.md)`,
  );
});
