// gloamfin.chase-cap: on a straight run it chases at its ~134 px/s cap.
//
// The corridor and the standoff are posed instantly (`arrange`); the run down it — where
// the speed settles at the cap — is the real sim, so it is `act` and is what the clip
// shows.
import {
  GLOAMFIN_CHASE,
  denAllExcept,
  pred,
  poseMaze,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

// One straight corridor, the forager parked at `F` and the Gloamfin starting from `P`.
//
// SIX TILES OF IT, BECAUSE THE CAP IS A PROPERTY OF THE RUN. "`134 px/s` is only a cap,
// reached on straight runs" (specs/predators/gloamfin.md), so the run has to outlast the
// window this item films rather than merely start it. Six tiles is `192 px`, and contact
// is made a body's width short of that, so the fastest build this item can pass still
// needs `1.24 s` to close it — comfortably past the `1.1 s` below. At four the Gloamfin
// arrives mid-clip and the evidence for a chase-speed item ends on a catch and the dive
// countdown.
const CORRIDOR = ["F......P"];

export default function item() {
  let p;

  return {
    id: "gloamfin.chase-cap",

    async arrange(api) {
      await startPlaying(api);
      const board = await poseMaze(api, CORRIDOR);
      await denAllExcept(api, ["gloamfin"]);
      // The forager first: `chase` fixes on wherever it is standing when the mode is
      // set, so it has to be parked on the far end of the straight run by then.
      await quietBoard(api, board.mark("F"));
      // Open the light so the chase is something a reviewer can watch. The trench is
      // drawn only where the forager's light falls (`specs/gameplay.md`), and at the
      // `G = 0` a fresh board starts on that pocket is `V = 96 px` — three tiles, so a
      // Gloamfin posed for a straight run of any useful length swims most of the
      // measurement through pitch black. At `G = 1` the pocket is `160 px`, which it
      // crosses into partway through and is lit for the rest. `setBrightness` is a
      // documented precondition op (`specs/instrumentation.md`) and the Gloamfin hunts
      // sound, not light: nothing about its speed, its fix or its hearing reads `G`, so
      // this changes what is visible and not what is measured.
      await api.call("setBrightness", 1);
      await api.call("setPredator", "gloamfin", {
        ...board.mark("P"),
        // Facing along the corridor at the forager. A Gloamfin drops to ~115 px/s on
        // "any perpendicular turn" and takes ~2 s to ramp back
        // (specs/predators/gloamfin.md), so one posed carrying an unrelated heading
        // turns into the chase and pays for it — and this item then reads that corner
        // ramp instead of the straight-run cap it is named for. A free reversal costs
        // nothing and no turn at all costs less; pointing it down the corridor is the
        // one heading that measures the cap.
        dir: "left",
        mode: "chase",
      });
    },

    async act(api) {
      await api.advance(36); // 36 ticks = the old 0.3 s: chasing straight, no corner — speed at the cap
      p = pred(await api.snapshot(), "gloamfin");
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("the Gloamfin is chasing", p.state, "chase");
      check.expectClose(
        "it chases at its ~134 px/s cap on a straight run",
        p.speed,
        GLOAMFIN_CHASE,
        6,
      );
    },
  };
}
