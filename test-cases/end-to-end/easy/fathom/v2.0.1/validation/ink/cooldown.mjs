// ink.cooldown: releasing ink starts an ~8 s cooldown before it can be used again.
//
// Entering play and clearing the cooldown is instant (`arrange`); using the ink and
// waiting the ~8 s out is the check itself, so it is `act`.
//
// THE WAIT IS SPLIT SO THE CLIP ACTUALLY SHOWS THE BAR REFILLING. `advance` is real time
// in the record pass and spends the filming budget, and the whole cooldown is `8 s` —
// exactly the budget a clip gets. Asking for all of it in one call spends the budget
// before a single frame is filmed, so the recording ended almost as soon as it began: a
// second of a full-looking meter, and no recharge to watch. Now the first half is filmed
// at the speed it really runs, which is what a reviewer needs to see (a bar at roughly
// half after roughly half the wait), and the second half is `skip`ped — instant in both
// passes, so the verdict still turns on the FULL `8 s` having elapsed in simulation.
import { startPlaying, INK_COOLDOWN, ticksFor } from "../_helpers.mjs";

// How much of the cooldown to film. Half of it leaves the meter visibly part-filled and
// leaves budget in hand for the beat before the ink is even used.
const FILMED_SECONDS = INK_COOLDOWN / 2;

export default function item() {
  let readyBefore;
  let s1;
  let midway;
  let readyAfter;

  return {
    id: "ink.cooldown",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      readyBefore = (await api.snapshot()).ink.ready;
      await api.call("press", "ShiftLeft");
      // 2 ticks for the old step(0.02) = 2.4 ticks: a "one moment later" beat so the
      // cooldown has been armed, not a measured duration.
      await api.advance(2);
      s1 = await api.snapshot();
      // Filmed: the meter climbing back, in real time.
      await api.advance(ticksFor(FILMED_SECONDS));
      midway = (await api.snapshot()).ink;
      // Not filmed: the rest of the wait, run instantly so the verdict still covers the
      // whole cooldown without asking the clip for eight seconds it does not have.
      await api.skip(ticksFor(INK_COOLDOWN - FILMED_SECONDS));
      readyAfter = (await api.snapshot()).ink.ready;
    },

    async assert(api, check) {
      check.expectOk("ink is ready before use", readyBefore);
      check.expectOk(
        "ink is on cooldown right after use",
        s1.ink.ready === false,
      );
      check.expectClose(
        "the ink cooldown is ~8 s",
        s1.ink.cooldown,
        INK_COOLDOWN,
        0.4,
      );
      // Halfway through, it must still be counting down and not yet ready — which is
      // also a statement about what the clip shows, so a reviewer watching the meter and
      // a reader of the verdict are looking at the same thing. Only the direction is
      // asserted, never a rate: `specs/gameplay.md` fixes the 8 s, not the curve.
      check.expectOk(
        "it is still on cooldown halfway through, with less left than when it started",
        midway.ready === false && midway.cooldown < s1.ink.cooldown,
      );
      check.expectOk("ink is ready again after the cooldown", readyAfter);
    },
  };
}
