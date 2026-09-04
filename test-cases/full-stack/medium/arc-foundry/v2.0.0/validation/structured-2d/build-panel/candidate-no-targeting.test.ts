// build-panel/candidate-no-targeting — a candidate has no targeting slot at all.
//
// `specs/hud.md` names two actions that are "absent rather than disabled, because
// the selected structure has no priority to cycle at all", and the first is: "a
// candidate has no targeting control, at any type or tier, because a candidate
// does not fire." `specs/scrap-press.md` agrees — a candidate does not fire —
// and `specs/instrumentation.md` reports a `targeting` row only where there is
// one.
//
// So this is the one place a MISSING row is the requirement rather than a
// disabled one, and it is read across several types and tiers, since "at any type
// or tier" is what the rule says. Each candidate is stood alone on an otherwise
// empty yard and dismantled again, so no reading is taken with two structures
// standing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  refillStamps,
  standCandidate,
  type Harness,
} from "../harness";
import type { ComponentType, Tier } from "../harness";

/** Firing types across the ladder: the Regulator is its own point. */
const CANDIDATES: readonly [ComponentType, Tier][] = [
  ["capacitor", 1],
  ["emitter", 3],
  ["choke", 2],
  ["arcnode", 4],
  ["discharge", 5],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("offers no targeting control on a candidate, at any type or tier", async () => {
  openYard(h);

  for (const [type, tier] of CANDIDATES) {
    refillStamps(h);
    const candidate = standCandidate(h, type, tier, 10, 10);
    h.debug.select(candidate);

    const actions = h.debug.panelButtons().map((b) => b.action);
    if (type === CANDIDATES[0]![0]) {
      // Nothing above runs a frame, so the still is of the one drawn here.
      await h.advance(1);
      captureStill(h, "panel");
    }
    assertEqual(
      actions.includes("targeting"),
      false,
      `whether a ${type} candidate at tier ${tier} offers a targeting slot; ` +
        `it offers ${actions.join(", ")}`,
    );

    h.debug.dismantle(candidate);
  }
});
