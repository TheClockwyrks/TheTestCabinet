// Automated validation for states.victory: clearing the run reaches the Victory screen.
//
// The post-final Overload Dynamo is released with integrity to spare; when it grounds out the
// real finale->win path reaches Victory.
//
// Releasing the boss is a control op (the arrange). Its walk to the Collector and the win it
// triggers are the behavior under test, so they are the act — one implementation where the old
// script had two: a real-time clip of the boss walking, then the same walk re-run under instant
// stepping to decide the verdict.

import { startBuild, spawnControlled, snap, SECOND } from "../_helpers.mjs";

// 150 s of game time = 9000 ticks, polled every 0.5 s = 30 ticks. The screen is constant right
// up to the win, so a coarse poll misses nothing.
const WALK_TICKS = 150 * SECOND;
const POLL_TICKS = 0.5 * SECOND;

export default function item() {
  // Whether Victory was reached, and the screen it left behind.
  let won;
  let screen;

  return {
    id: "states.victory",

    // The still this item declares is the Victory screen, and the boss's walk to the
    // Collector takes ~38 s — far past the 8 s default record budget, so the record
    // pass would unwind before `screenshot` ever ran and the declared output would
    // never land. The item declares no video, so this lengthens only the record pass,
    // not any media it produces.
    clipMs: 60000,

    async arrange(api) {
      await startBuild(api, { difficulty: "easy" });
      await api.call("setIntegrity", 999);
      await spawnControlled(api, "overload");
    },

    async act(api) {
      const r = await api.until((s) => s.screen === "victory", { max: WALK_TICKS, poll: POLL_TICKS });
      won = r.hit;
      screen = (await snap(api)).screen;

      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectOk("the run reaches Victory", won);
      check.expectEq("the Victory screen shows", screen, "victory");
    },
  };
}
