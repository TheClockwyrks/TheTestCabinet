// flarefish.chase-like-lanternjaw: on acquiring you it stops flaring and chases exactly
// like the Lanternjaw; lose it and the flare re-arms.
//
// The sight line is posed instantly (`arrange`); the acquisition, the ink that breaks it
// and the drop back to wandering all take real time, so they are `act` — the clip is the
// whole fix-then-lose sequence at the game's own speed.
import {
  denAllExcept,
  findSightLine,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let onFix;
  let afterInk;

  return {
    id: "flarefish.chase-like-lanternjaw",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3);
      await denAllExcept(api, ["flarefish"]);
      await api.call("setPredator", "flarefish", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await quietBoard(api, line.forager);
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      onFix = pred(await api.snapshot(), "flarefish");

      // Lose it with ink; it drops back to wandering (the flare re-arms).
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft");
      await api.advance(36); // 36 ticks = the old 0.3 s
      afterInk = pred(await api.snapshot(), "flarefish").state;

      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("on acquiring, it chases", onFix.state, "chase");
      check.expectOk(
        "it stops flaring while chasing (chases like the Lanternjaw)",
        onFix.flaring === false,
      );
      check.expectEq("losing you returns it to wandering", afterInk, "wander");
    },
  };
}
