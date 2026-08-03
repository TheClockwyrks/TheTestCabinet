// Automated validation for hazards.hull-death.
//
// An empty hull is fatal on its own. `specs/character.md` makes the hull STANDING at `0` the
// lethal condition — checked continuously, as an empty tank underground is — rather than the
// particular blow that emptied it, so the miner is destroyed the moment its hull is empty whatever
// brought it there. We empty the hull outright, run the real simulation forward, and confirm the
// run ends as a hull death.
//
// This is the one item that tests the rule itself, which is why it poses the hull directly. Every
// OTHER item that merely needs a death behind it (the mode items, `rocket.parts-durable`,
// `states.game-over`, `core-run.death-destroys`) drives a real gas detonation through
// `arrangeKillByHull` instead — a build that gets this rule wrong should fail here, on the claim it
// actually breaks, and not drag down five unrelated items with it.

import { newRun, standAt, SPAWN_COL, ROCKBED_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let full;
  let end;

  return {
    id: "hazards.hull-death",

    // A grounded miner underground, at full hull and in no danger: nothing in the posed world can
    // damage it, so the death that follows can only be the empty hull itself.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      full = (await api.snapshot()).miner;
    },

    // Emptying the hull IS the behavior under test, so it happens here and the clip shows the bar
    // go to nothing and the run end on it.
    async act(api) {
      await api.advance(45); // 45 ticks = 0.75 s standing safely, hull bar full
      await api.call("setHull", 0);
      // 600 ticks = 10 s. `specs/character.md` bounds no death-animation length, so the cap is
      // generous rather than pinned to the pace one build happens to play it at; poll 6 = 0.1 s,
      // coarse enough since nothing read here changes before the death lands.
      const r = await api.until((s) => s.screen === "game-over", {
        max: 600,
        poll: 6,
      });
      end = r.snap;
      await api.advance(90); // 90 ticks = 1.5 s resting on the Game Over screen and its summary
    },

    async assert(api, check) {
      check.expectGt("the miner starts at a full hull", full.hull, 0);
      check.expectEq("an emptied hull ends the run", end.screen, "game-over");
      check.expectEq(
        "the death is recorded as the hull being destroyed",
        end.summary ? end.summary.deathCause : null,
        "hull-destroyed",
      );
    },
  };
}
