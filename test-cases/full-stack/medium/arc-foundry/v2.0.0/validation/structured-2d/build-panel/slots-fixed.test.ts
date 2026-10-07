// build-panel/slots-fixed — every action the selection can offer keeps its slot.
//
// `specs/hud.md`: "every action the selected structure can ever offer is drawn
// for as long as that structure stays selected, each in its own slot, in a fixed
// order", and "an action that is unavailable right now is drawn disabled in its
// slot, visibly inert and ignoring clicks, rather than hidden, removed, or
// collapsed". Which order that is belongs to the build: the specification fixes
// that there IS one and that it holds, not what it is, so what is decided here is
// that the slots, their labels, and their order are the same before and after.
//
// THE STATE CHANGE. A candidate with no matching partner on the yard cannot
// combine, and `specs/scrap-press.md` offers a quality-combine "on a base
// structure that has a matching partner anywhere on the yard". So a second
// candidate of the same type at the same quality turns exactly one action from
// unavailable to available and touches nothing else: neither tier is an
// ingredient of any recipe in `specs/combinations.md`, so no `combine-special`
// row appears or disappears with it. The two readings therefore have to name the
// same actions with the same labels in the same order, and differ only in
// `disabled`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  panelControl,
  standCandidate,
  type Harness,
} from "../harness";
import type { PanelButton } from "../surface";

/** A type and tier no recipe of specs/combinations.md calls for. */
const TYPE = "capacitor";
const TIER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** A row's identity: the slot it is, not the state it is in. */
function slots(buttons: readonly PanelButton[]): string[] {
  return buttons.map((b) => `${b.action} — ${b.label}`);
}

it("draws the same slots in the same order once a partner appears", async () => {
  openYard(h);
  const alone = standCandidate(h, TYPE, TIER, 10, 10);
  h.debug.select(alone);

  const before = h.debug.panelButtons();
  // Every reading this point makes is taken through the surface, which under
  // an engine runs no frame, so the still is of the frame this one draws.
  await h.advance(1);
  captureStill(h, "panel");

  assertEqual(
    panelControl(h, "combine").disabled,
    true,
    "whether the combine slot is drawn disabled for a candidate with no " +
      "matching partner on the yard",
  );

  standCandidate(h, TYPE, TIER, 14, 10);
  h.debug.select(alone);

  const after = h.debug.panelButtons();
  assertDeepEqual(
    slots(after),
    slots(before),
    "the inspector's slots once a matching partner stands on the yard",
  );
  assertEqual(
    panelControl(h, "combine").disabled,
    false,
    "whether the combine slot is enabled once a matching partner stands",
  );
});
