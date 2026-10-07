// screens/title-shows-mode-label — the title screen draws the deal-mode label the
// build itself reports.
//
// `specs/screens.md`, the `title` screen's element table: Deal-mode label,
// `DEAL_MODE_LABEL`, "This build's label, as `specs/stock.md` states", and below
// it "The deal-mode label is drawn somewhere on the screen so a player sees which
// deal the game is played with". `specs/instrumentation.md` has the snapshot
// report that same figure as `dealModeLabel`, "this build's `DEAL_MODE_LABEL`".
//
// SO THIS ITEM DECIDES CONSISTENCY, NOT THE LITERAL. It asks the build what its
// label is and then looks for that text on the title screen, which is a question
// worth asking under either variant and under all three engines: a build that
// reports `DRAW THREE` and draws `DRAW ONE` fails here whichever of the two it
// was asked to be. WHICH literal each variant owes — `DRAW ONE` for Draw One,
// `DRAW THREE` for Draw Three — is the variant's own item,
// `draw-one/mode-label-title` and `draw-three/mode-label-title`, and no literal
// appears in this file.
//
// THE ONE GUARD. A build reporting an empty label would make the search below
// vacuous, since every frame "contains" the empty string. `specs/stock.md` fixes
// `DEAL_MODE_LABEL` as "the text drawn on the title screen and in the HUD", so a
// label with no text in it is not a label; the check refuses to grade on one
// rather than passing on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { drewText } from "../case-harness/index";
import {
  captureStill,
  createHarness,
  openTitle,
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
  await openTitle(h);

  const label = (await h.snapshot()).dealModeLabel;
  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertGreaterThanOrEqual(
    typeof label === "string" ? label.trim().length : Number.NaN,
    MIN_LABEL_LENGTH,
    "the length of the dealModeLabel the build reports (specs/stock.md)",
  );
  assertEqual(
    drewText(calls, label),
    true,
    `the title screen draws the build's own deal-mode label, "${String(label)}" (specs/screens.md)`,
  );
});
