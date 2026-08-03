// scoring.caught-costs-life: contact with a predator costs a life and resets the maze.
//
// The straight approach is posed instantly (`arrange`); the predator swimming down it and
// running into the forager is the real sim, so it is `act` — the clip is the hunter
// closing, the catch, and the maze resetting behind it.
//
// WHY IT IS NOT SIMPLY PUT ON TOP OF THE FORAGER. That is what this item used to do, and
// the collision then resolved on the first tick: by the time anything was filmed the life
// was already gone and the clip was a dive countdown, with nothing in it a reviewer could
// check. It also quietly tested something the spec does not say — that a predator posed
// onto an occupied tile counts as contact — rather than the thing it does say, which is
// that contact costs a life. Standing them three tiles apart and letting the chase close
// the gap tests contact as the game produces it, and shows it happening.
import {
  denAllExcept,
  findSightLine,
  quietBoard,
  startPlaying,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let caught;

  return {
    id: "scoring.caught-costs-life",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3); // 96 px of straight corridor to close
      await denAllExcept(api, ["gloamfin"]);
      // The forager first, and PARKED: `chase` fixes on wherever it is standing when the
      // mode is set, so it is the tile the Gloamfin comes for.
      await quietBoard(api, line.forager);
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        dir: line.dir === "right" ? "left" : "up",
        mode: "chase",
      });
      before = await api.snapshot();
    },

    async act(api) {
      // Three tiles at the Gloamfin's 134 px/s chase cap is about 0.72 s; three seconds
      // is room for a slower hunter without being a window a build could pass by doing
      // nothing.
      caught = await api.until((s) => s.lives < before.lives, {
        max: ticksFor(3),
        poll: 6,
      });
      await api.advance(90); // 0.75 s of the reset behind it, for the clip
    },

    async assert(api, check) {
      check.expectOk("running into a predator costs a life", caught.hit);
      if (!caught.hit) return;
      check.expectEq(
        "contact costs exactly one life",
        caught.snap.lives,
        before.lives - 1,
      );
      check.expectEq(
        "the maze resets (back to the dive countdown)",
        caught.snap.screen,
        "countdown",
      );
    },
  };
}
