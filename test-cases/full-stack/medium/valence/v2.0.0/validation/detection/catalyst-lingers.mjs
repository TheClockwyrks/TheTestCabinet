// Automated validation for the Detection sub-item `catalyst-lingers`.
//
// An inert unit stays revealed for a short linger after it leaves the detector's field,
// then reverts to hidden. The check reveals a Noble with a Catalyst, then SELLS the
// Catalyst (removing the field) and runs on: the reveal lingers briefly, then clears.

import {
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let cat;
  let id;
  let inField;
  let justAfter;
  let afterLinger;

  return {
    id: "detection.catalyst-lingers",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.18;
      cat = await placeCovering(api, "catalyst", g, s0);
      id = await spawnAt(api, { type: "noble", pathId: 0, s: s0 });
    },

    // Reveal, then remove the detector and watch the linger run out. Selling a tower is a
    // control op, so it is legal mid-`act` — and this whole sequence IS the behavior.
    async act(api) {
      // 6 ticks = the old 0.1 s: long enough for the field to have revealed it.
      await api.advance(6);
      inField = unitById(await api.snapshot(), id).revealed;

      // Remove the detector: the reveal must linger briefly, then clear.
      await api.call("sellTower", cat.id);
      // 30 ticks = the old 0.5 s — inside the linger window.
      await api.advance(30);
      justAfter = unitById(await api.snapshot(), id).revealed;
      // A further 132 ticks = the old 2.2 s — past the end of the linger.
      await api.advance(132);
      afterLinger = unitById(await api.snapshot(), id).revealed;
    },

    async assert(api, check) {
      check.expectEq(
        "the inert unit is revealed while in the field",
        inField,
        true,
      );
      check.expectEq(
        "the reveal lingers just after the detector is gone",
        justAfter,
        true,
      );
      check.expectEq(
        "the reveal clears after the linger elapses",
        afterLinger,
        false,
      );
    },
  };
}
