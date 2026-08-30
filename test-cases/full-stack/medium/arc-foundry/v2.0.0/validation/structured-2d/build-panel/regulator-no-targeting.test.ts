// build-panel/regulator-no-targeting — a Regulator has no targeting slot either.
//
// `specs/hud.md` names it as the second action that is absent rather than
// disabled: "a Regulator has no targeting control, at any tier, whether a
// candidate or a component." `specs/components.md` gives the reason — the
// Regulator "never fires: it has no range, no damage, no firing head, no
// projectile, and no targeting priority" — and `specs/instrumentation.md` has its
// snapshot report `targeting: null`.
//
// Both halves are read, at every tier of the ladder, each on an otherwise empty
// yard: a Regulator that rolled from the press, and one that was placed as a
// permanent component.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  NON_FIRING_TYPE,
  TIERS,
  captureStill,
  createHarness,
  openYard,
  refillStamps,
  standCandidate,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("offers no targeting control on a Regulator, candidate or component", async () => {
  openYard(h);

  for (const tier of TIERS) {
    for (const kind of ["candidate", "component"] as const) {
      refillStamps(h);
      const id =
        kind === "candidate"
          ? standCandidate(h, NON_FIRING_TYPE, tier, 10, 10)
          : standComponent(h, NON_FIRING_TYPE, tier, 10, 10);
      h.debug.select(id);

      const actions = h.debug.panelButtons().map((b) => b.action);
      if (tier === 1 && kind === "candidate") {
        // Nothing above runs a frame, so the still is of the one drawn here.
        await h.advance(1);
        captureStill(h, "panel");
      }
      assertEqual(
        actions.includes("targeting"),
        false,
        `whether a Regulator ${kind} at tier ${tier} offers a targeting slot; ` +
          `it offers ${actions.join(", ")}`,
      );
      assertNull(
        structureById(h.snapshot(), id).targeting,
        `the targeting priority a Regulator ${kind} at tier ${tier} reports`,
      );

      h.debug.dismantle(id);
    }
  }
});
