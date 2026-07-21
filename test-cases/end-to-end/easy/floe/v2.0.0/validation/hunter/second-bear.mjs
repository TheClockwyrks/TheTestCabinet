// Automated validation for the Hunter item `second-bear`.
//
// From level 5 the strait fields two hunters; both eventually emerge and pursue.
// The level is set to 5 (two hunter slots), the critter advanced onto a safe floe,
// and the real emerge logic brings both bears out, which the snapshots read back.
// See validation/_helpers.mjs.

export default function item() {
  // How many hunter slots level 5 fields (read instantly in `arrange`), and the sweep
  // that waited for both to emerge.
  let slots;
  let r;

  return {
    id: "hunter.second-bear",

    // Pose level 5 — the first level with two hunter slots — with the critter already
    // advanced onto a safe floe up top, which is the precondition both bears' emerge
    // logic is waiting on.
    async arrange(api) {
      await api.reset();
      await api.call("setLevel", 5);
      slots = (await api.snapshot()).bears.length;
      await api.call("setLane", 3, { cols: [20], speed: 0 }); // safe floe up top
      await api.call("placeCritter", 20, 3); // advanced, so both may emerge
    },

    // Both hunters emerging and setting off after the critter — the clip.
    async act(api) {
      r = await api.until(
        (s) => s.bears.length === 2 && s.bears[0].present && s.bears[1].present,
        { max: 360, poll: 12 }, // 3 s at a 0.1 s cadence
      );
    },

    async assert(api, check) {
      check.expectEq("level 5 fields two hunter slots", slots, 2);
      check.expectOk("both bears eventually emerge", r.hit);
    },
  };
}
