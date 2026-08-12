// Automated validation for the Modes sub-item `replay`.
//
// RESTART and PLAY AGAIN replay the same mode and difficulty (specs/modes.md). We
// drive a Containment/Medium run to Game over, then choose PLAY AGAIN and confirm the
// fresh run is the same mode and difficulty.

import {
  newGame,
  spawn,
  press,
  skipToApproach,
  actTail,
} from "../_helpers.mjs";

export default function item() {
  let over;
  let s;

  return {
    id: "modes.replay",

    // The leak that ends the run, the Game-over screen, PLAY AGAIN, and a beat of the
    // replayed run — four things, so a wider ceiling than its neighbours.
    clipMs: 9000,

    // A Containment/Medium run on its last life, so one Mote ends it — the replay has
    // to come out of a REAL game-over, not a posed one. Getting that Mote to an
    // exhaust is sixteen seconds of walking and none of the subject, so it is run
    // through unfilmed and the clip opens on its final approach.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 1);
      const moteId = await spawn(api, "mote", "left");
      await skipToApproach(api, moteId);
    },

    // Finish the leak that ends the run, then take PLAY AGAIN. 300 ticks = 5s, ample
    // for the stretch the skip stopped on.
    //
    // Note PLAY AGAIN goes through the game's own menu, not `newGame` — which is the
    // point of the check, and also why nothing here needs `restartGame`.
    async act(api) {
      over = await api.until((t) => t.screen === "gameover", {
        max: 300,
        poll: 6,
      });
      await actTail(api, 90); // hold on the Game-over screen before taking its menu
      await press(api, "Enter"); // PLAY AGAIN
      s = await api.snapshot();
      await actTail(api, 180); // 3 s of the replayed run, same mode and difficulty
    },

    async assert(api, check) {
      check.expectOk("the run ended in Game over", over.hit);
      // Split in two, because the confirm can fail in two places and they are different
      // defects. `specs/controls.md` binds the confirm key on "game-over navigation"
      // and `specs/ui.md` focuses PLAY AGAIN when the screen opens, so a conformant
      // build both HANDLES the key and lands on a replayed run. A build that never bound
      // it sits on the Game-over screen; one that focused MENU instead goes to the
      // title. Reported as a single "expected playing" that distinction is lost, and a
      // reviewer has to open the clip to find out which they are looking at.
      //
      // The focused entry is checked through what confirming it DOES, not by reading
      // `menuIndex`. `menuIndex` is only "the highlighted item on a menu screen"
      // (specs/instrumentation.md) — no spec maps a number to an entry, and
      // specs/ui.md fixes "the content and navigation of these menus, not their layout"
      // — so `menuIndex === 0` would assert an ordering the case never pinned and fail a
      // build that numbered its entries the other way round while behaving correctly.
      check.expectNe(
        "the confirm key is handled on the Game-over screen",
        s.screen,
        "gameover",
      );
      // Hard, because the two reads below cannot mean anything until it holds. `mode`
      // and `difficulty` still carry the run that just ENDED, so on a build where PLAY
      // AGAIN did nothing they both report "containment"/"medium" and pass — recording
      // two green ticks for a replay that never happened, next to the red one that says
      // so. Stopping here leaves the verdict saying only what was actually established.
      check.assertEq(
        "the focused entry is PLAY AGAIN, starting a fresh playing run",
        s.screen,
        "playing",
      );
      check.expectEq("it replays the same mode", s.mode, "containment");
      check.expectEq("it replays the same difficulty", s.difficulty, "medium");
    },
  };
}
