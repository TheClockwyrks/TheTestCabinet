// Automated validation for the Hunter item `second-bear`.
//
// From level 5 the strait fields two hunters; both eventually emerge and pursue.
// The level is set to 5 (two hunter slots), the critter advanced onto a safe floe,
// and the real emerge logic brings both bears out, which the snapshots read back.
// See validation/_helpers.mjs.
//
// The sweep ends on the very tick the second bear appears, which is the right place
// for the VERDICT and the wrong place for the clip: the item's whole point is two
// bears hunting, and that is the one thing the recording stopped just short of. So
// the act keeps filming afterwards, long enough for both bears to be seen moving on
// the critter together.

// How long the clip keeps filming once both bears are out.
const TAIL_TICKS = 240; // 2 s

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
      // The pursuit is suspended for the sweep. What is under test is that both bears
      // COME OUT, and emergence is not the pursuit: specs/instrumentation.md keeps the
      // rest of a bear's life running with the brain off. Left running, a bear that
      // reaches the critter inside this deliberately generous window catches it, which
      // ends the crossing and removes BOTH bears (specs/hunter.md) — so the item would
      // fail to see two bears precisely because its first bear hunted well.
      await api.call("setBearAI", false);
      slots = (await api.snapshot()).bears.length;
      await api.call("setLane", 3, { cols: [20], speed: 0 }); // safe floe up top
      await api.call("placeCritter", 20, 3); // advanced, so both may emerge
    },

    // Both hunters emerging and setting off after the critter — the clip.
    //
    // The window is generous, and more so than the single-bear items: specs/hunter.md
    // says only that the second bear is "staggered from the first" and pins neither
    // delay, so the second bear's total wait is the build's own call. A window sized
    // to one build's stagger would fail another that simply staggers wider. What is
    // under test is that BOTH bears eventually emerge.
    async act(api) {
      r = await api.until(
        (s) => s.bears.length === 2 && s.bears[0].present && s.bears[1].present,
        { max: 900, poll: 12 }, // 7.5 s at a 0.1 s cadence
      );
      // Hand the pursuit back for the tail, so the clip shows what the item is about:
      // two bears converging on the critter. The verdict is already decided above.
      await api.call("setBearAI", true);
      await api.advance(TAIL_TICKS); // both bears on the hunt — the point of the item
    },

    async assert(api, check) {
      check.expectEq("level 5 fields two hunter slots", slots, 2);
      check.expectOk("both bears eventually emerge", r.hit);
    },
  };
}
