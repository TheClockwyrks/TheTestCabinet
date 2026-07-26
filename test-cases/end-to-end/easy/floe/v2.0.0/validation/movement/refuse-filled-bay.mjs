// Automated validation for the Movement item `refuse-filled-bay`.
//
// Hopping up into an already-filled bay is refused, while an open bay accepts the
// hop. Both are driven through the real play code: the critter is stood on a floe
// below bay 0's column and a real up-hop is attempted, first with the bay filled
// (refused) then open (accepted). See validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The state after each of the two hops.
  let sFilled;
  let sOpen;

  return {
    id: "movement.refuse-filled-bay",

    // Filled bay: the hop should be refused. The floe under bay 0's column is what
    // lets the critter stand there at all.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setBays", [true, false, false, false, false]);
      await api.call("setLane", WATER_TOP, { cols: [3], speed: 0 }); // floe under bay 0
      await api.call("placeCritter", 3, WATER_TOP);
    },

    // The same hop against a filled bay and then an open one, back to back — which is
    // what makes the refusal legible: the difference is the bay, not the input. The
    // second pose is `setBays` + `placeCritter`, control ops only; the old script
    // re-ran `startCrossing`, whose reset would freeze the recording here.
    async act(api) {
      await api.call("press", "ArrowUp");
      await api.advance(18); // 0.15 s, just past the hop cooldown
      sFilled = await api.snapshot();

      // Open bay: the same hop is accepted (the bay fills).
      await api.call("setBays", [false, false, false, false, false]);
      await api.call("placeCritter", 3, WATER_TOP);
      await api.call("press", "ArrowUp");
      await api.advance(18);
      sOpen = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "a hop into a FILLED bay is refused (row unchanged)",
        sFilled.critter.row,
        WATER_TOP,
      );
      check.expectEq("no death", sFilled.screen, "playing");
      check.expectEq(
        "an OPEN bay accepts the hop (bay 0 fills)",
        sOpen.bays[0],
        true,
      );
    },
  };
}
