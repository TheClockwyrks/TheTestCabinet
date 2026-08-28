// brightness.widens-lanternjaw: a higher G widens the Lanternjaw's detection range.
//
// The board is posed in `arrange`; the two brightness settings and the moment each
// needs to take effect in the sim are `act`, so the clip shows the range being read at
// a low G and then at a high one.
import {
  denAllExcept,
  sceneGuard,
  sceneHeld,
  poseStraightRun,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let quiet;
  let guard;
  let low;
  let high;

  return {
    id: "brightness.widens-lanternjaw",

    async arrange(api) {
      await startPlaying(api);
      // A posed corridor: the pair stands on it with room to the right, rather than on
      // whichever tile a build's own maze happened to leave open that way. The Lanternjaw
      // goes four tiles along it — `setMaze` rests the forager on the run's first tile,
      // and a hunter posed onto that same tile simply eats it, which costs a life and
      // re-dens every predator before the range can be read.
      const spot = await poseStraightRun(api, 8, { spare: true });
      quiet = await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: spot.tx + 4,
        ty: spot.ty,
        mode: "wander",
      });
      // Clear the board (all but one pellet, placed adjacent to the stationary forager)
      // so the forager cannot eat and bump its own brightness while we read the range.
      await quietBoard(api);
      guard = await sceneGuard(api, quiet);
    },

    async act(api) {
      // Each `advance(2)` is the old step(0.02) = 2.4 ticks, which the contract refuses
      // to round. These are "let the setting take effect" beats rather than measured
      // durations, so 2 ticks is the faithful whole-tick choice.
      await api.call("setBrightness", 0.1);
      await api.advance(2);
      low = pred(await api.snapshot(), "lanternjaw").detectRange;
      await api.call("setBrightness", 0.9);
      await api.advance(2);
      high = pred(await api.snapshot(), "lanternjaw").detectRange;
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      // Was the scenario still standing when the measurement ended? If not, the label
      // says what gave way, rather than reporting it against the subject.
      const broke = sceneHeld(await api.snapshot(), guard);
      check.expectOk(broke ?? "the scenario held to the end", !broke);
      if (broke) return;
      check.expectGt(
        "higher brightness widens the Lanternjaw's detection range",
        high,
        low,
      );
      check.expectClose("range at low G (128 + 192*0.1)", low, 147, 18);
      check.expectClose("range at high G (128 + 192*0.9)", high, 301, 24);
    },
  };
}
