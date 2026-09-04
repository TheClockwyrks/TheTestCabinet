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
  captureStill,
  createHarness,
  openYard,
  refillStamps,
  standCandidate,
  standComponent,
  structureById,
  type Harness,
} from "../harness";
import { NON_FIRING_TYPE, TIERS } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers no targeting control on a Regulator, candidate or component", async () => {
  await openYard(h);

  for (const tier of TIERS) {
    for (const kind of ["candidate", "component"] as const) {
      await refillStamps(h);
      const id =
        kind === "candidate"
          ? await standCandidate(h, NON_FIRING_TYPE, tier, 10, 10)
          : await standComponent(h, NON_FIRING_TYPE, tier, 10, 10);
      await h.debug.select(id);

      const actions = (await h.debug.panelButtons()).map((b) => b.action);
      if (tier === 1 && kind === "candidate") await captureStill(h, "panel");
      assertEqual(
        actions.includes("targeting"),
        false,
        `whether a Regulator ${kind} at tier ${tier} offers a targeting slot; ` +
          `it offers ${actions.join(", ")}`,
      );
      assertNull(
        structureById(await h.snapshot(), id).targeting,
        `the targeting priority a Regulator ${kind} at tier ${tier} reports`,
      );

      await h.debug.dismantle(id);
    }
  }
});
