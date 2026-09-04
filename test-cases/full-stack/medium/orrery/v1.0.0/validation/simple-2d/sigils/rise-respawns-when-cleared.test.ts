// sigils/rise-respawns-when-cleared — a rise is a source, not a single delivery.
//
// THE RULE. "A sigil is engraved on the field at a fixed pose and ACTS AT EACH
// BOUNDARY, the settle included" (`specs/sigils.md`), and a rise's condition is
// read afresh every time: "When every footprint hex is vacant, the reagent
// appears" (Rises and sets). Nothing in the file spends a rise or marks it used,
// so the first boundary at which its footprint is vacant once more delivers again,
// as many times as a run reaches one.
//
// THE CONFIGURATION. A rise whose reagent is one mote on `(0, 0)`, alone on the
// field. Three cycles run; after each, whatever landed on the footprint hex is
// taken off with `removeMote`, so the footprint is vacant again going into the
// next. Nothing else is placed, so no set consumed the delivery and no arm carried
// it away — the check itself is what empties the hex, and it empties it through
// the debug surface.
//
// THE VERDICT. Three boundaries, three deliveries: at each one the footprint hex
// was bare before the cycle and carries a mote of the reagent's type after it.
// Reading the vacancy before as well as the mote after is what makes this about
// RE-delivery rather than about one mote that never went away.
//
// THE EVIDENCE IS A REPLAY, because the point is a thing that happens repeatedly
// across a run rather than a state at one moment.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  placeRise,
  type Harness,
} from "../harness";

/** How many deliveries the item asks to see. */
const DELIVERIES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("delivers its reagent again at the first boundary after its footprint clears", async () => {
  // BARE's one reagent is a single `sol` on (0, 0), so the footprint is one hex.
  await openBareRun(h, { challenge: BARE });
  await placeRise(h, 0, ORIGIN, 0);

  const seen = await captureReplay(h, "repeat", async () => {
    const rounds: { bare: boolean; delivered: boolean }[] = [];
    for (let round = 0; round < DELIVERIES; round += 1) {
      const before = await h.snapshot();
      const bare = moteAt(before, ORIGIN) === null;

      await advanceCycles(h, 1);

      const after = await h.snapshot();
      const landed = moteAt(after, ORIGIN);
      rounds.push({ bare, delivered: landed !== null });
      // Empty the footprint again, so the next boundary reads a vacant hex.
      if (landed !== null) await h.debug.removeMote(landed.id);
    }
    return rounds;
  });

  assertLength(
    seen,
    DELIVERIES,
    "three cycles were run, so three were watched",
  );
  for (const [round, delivery] of seen.entries()) {
    assertTrue(
      delivery.bare,
      `the footprint hex is vacant going into cycle ${round}`,
    );
    assertTrue(
      delivery.delivered,
      `delivery ${round + 1} of ${DELIVERIES}: the reagent is on the footprint hex again`,
    );
  }

  const end = await h.snapshot();
  assertEqual(
    end.sim?.status,
    "running",
    "a rise that delivers raises no fault, so the run is still live",
  );
  assertEqual(
    end.sim?.cycle,
    DELIVERIES,
    "three whole cycles of game time completed three cycles",
  );
});
