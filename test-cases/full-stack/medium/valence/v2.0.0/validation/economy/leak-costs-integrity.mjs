// Automated validation for the Economy sub-item `leak-costs-integrity`.
//
// Matter that reaches the collector costs integrity equal to the unit's leak value. The
// check poses a heavy isotope (leak value 3) just short of the collector, runs on until it
// leaks, and confirms integrity fell by exactly its leak value.

import {
  startScenario,
  pathGeom,
  spawnAt,
  unitById,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

const ISOTOPE_LEAK = 3; // MATTER.heavy.leak — specs/matter.md
// Posed 170px short of the collector rather than 20. What this item shows is the integrity
// read dropping by three, and a number is only legible once the reviewer has seen what it
// was before it moved; an isotope at 36 px/s covers 20px in a third of a second, so the
// clip opened and the leak had already happened.
const APPROACH_PX = 170;
const MAX_LEAK_TICKS = 420; // 7 s — generous for 36 px/s over APPROACH_PX

export default function item() {
  let id;
  let int0;
  let r;

  return {
    id: "economy.leak-costs-integrity",

    clipMs: clipBudget(LEAD_TICKS + MAX_LEAK_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startScenario(api, MAP.single, { integrity: 100 });
      const g = pathGeom(snap.paths[0]);
      id = await spawnAt(api, {
        type: "isotope",
        pathId: 0,
        s: g.length - APPROACH_PX,
      });
      int0 = (await api.snapshot()).integrity;
    },

    // The isotope covering the last stretch and leaking at the collector — the checked
    // behavior, so it is also the clip.
    async act(api) {
      // The standing integrity, with the isotope still on the conduit.
      await api.advance(LEAD_TICKS);
      // poll 3 = the old 0.05 s chunk.
      r = await api.until((s) => unitById(s, id) == null, {
        max: MAX_LEAK_TICKS,
        poll: 3,
      });
      // Held after the leak, so the new integrity can be read off the recording — and so a
      // build that settles its HUD a beat later is not cut off before it does.
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the unit leaked at the collector", r.hit);
      check.expectEq(
        "the leak cost integrity equal to the unit's leak value",
        int0 - r.snap.integrity,
        ISOTOPE_LEAK,
      );
    },
  };
}
