// Automated validation for states.victory: clearing the run reaches the Victory screen.
//
// The post-final Overload Dynamo is released with integrity to spare; when it grounds out the
// real finale->win path reaches Victory.
//
// Releasing the boss and walking it to the Collector's doorstep are the arrange; the ground-out
// and the win it triggers are the act.
//
// The walk used to be filmed. The boss's walk takes about 38 s, so the record pass needed a
// `clipMs` of 60000 just to reach the `screenshot` at the end — and a build whose boss walks
// any slower blew that budget, unwound, and never produced the declared output at all, which is
// a failure of the recording rather than of the build. Skipping the walk (instant in both
// passes) reaches the same state and decides the same verdict.

import {
  startBuild,
  spawnControlled,
  skipUntilNearCollector,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

const WIN_TICKS = 30 * SECOND;
// A beat on the Victory screen before the still, so it has drawn.
const SETTLE_TICKS = 1 * SECOND;

export default function item() {
  // Whether Victory was reached, and the screen it left behind.
  let arrived;
  let won;
  let screen;

  return {
    id: "states.victory",

    async arrange(api) {
      await startBuild(api, { difficulty: "easy" });
      await api.call("setIntegrity", 999);
      const [boss] = await spawnControlled(api, "overload");
      arrived = await skipUntilNearCollector(api, boss.id);
    },

    async act(api) {
      const r = await api.until((s) => s.screen === "victory", {
        max: WIN_TICKS,
        poll: TICK,
      });
      won = r.hit;
      screen = (await snap(api)).screen;

      await api.advance(SETTLE_TICKS);
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectOk("the Overload Dynamo walked the chain to the Collector", arrived.hit);
      check.expectOk("the run reaches Victory", won);
      check.expectEq("the Victory screen shows", screen, "victory");
    },
  };
}
