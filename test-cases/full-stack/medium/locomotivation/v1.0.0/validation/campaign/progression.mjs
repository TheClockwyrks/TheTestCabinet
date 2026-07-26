// Campaign: winning a level unlocks and enters the next; failing offers a retry. Level 1 is
// won for real, NEXT advances to level 2, then level 2 is failed on the clock and RETRY
// re-enters it.

import { setTile, startFresh, TICK } from "../_helpers.mjs";

export default function item() {
  // A snapshot at each beat of the progression.
  let won;
  let next;
  let failedScreen;
  let retried;

  return {
    id: "campaign.progression",

    // Pose level 1 one delivery short of its quota, with that delivery in hand. Moving
    // onto the zone is the trigger, so it stays in `act`.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setDelivered", "red", 2);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    // The whole progression, in order. Every screen transition here is driven by a
    // control op or by real time, so the clip walks a reviewer through win → NEXT →
    // fail → RETRY exactly as the assertions read it.
    async act(api) {
      // Win level 1.
      await setTile(api, 4, 2);
      await api.advance(TICK); // one tick for the delivery and the win to resolve
      won = await api.snapshot();

      // NEXT advances to level 2.
      await api.call("press", "Enter");
      next = await api.snapshot();

      // Fail level 2, then RETRY re-enters it. `setClock` poses the shift clock and is
      // still in SECONDS — only advancing time is counted in ticks.
      await api.call("setClock", 0.3);
      await api.advance(30); // 30 ticks = the old 0.5s, past the 0.3 s left on the clock
      failedScreen = (await api.snapshot()).screen;

      await api.call("press", "Enter");
      retried = await api.snapshot();

      // Hold on the retried shift so the clip ends on live play. 36 ticks = the old
      // 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "winning level 1 shows shift-complete",
        won.screen,
        "level-complete",
      );
      check.expectGe(
        "winning unlocks the next level",
        won.campaign.unlocked,
        1,
      );

      check.expectEq("NEXT enters the next shift", next.screen, "playing");
      check.expectEq("the next shift is level 2", next.level.number, 2);

      check.expectEq(
        "running the clock out fails level 2",
        failedScreen,
        "level-failed",
      );
      check.expectEq("RETRY re-enters the level", retried.screen, "playing");
      check.expectEq(
        "the retried shift is still level 2",
        retried.level.number,
        2,
      );
    },
  };
}
