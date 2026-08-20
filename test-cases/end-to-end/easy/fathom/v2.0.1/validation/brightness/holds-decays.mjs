// brightness.holds-decays: G holds ~1 s after the last pellet, then decays — never a
// constant drain.
//
// Only the placement is instant; holding and decaying are real elapsed time, so they
// belong in `act` — which is also the clip, where the hold and then the fall are visible
// at the game's own pace.
//
// THE FORAGER HAS TO ACTUALLY STAND STILL, and that is the whole difficulty. Every
// corridor tile carries a pellet and every pellet re-arms the hold, so a forager that
// swims even a little during the 1.8 s window grazes its way to a `G` that never falls
// and the item reports a decay bug against a build that decays perfectly well. Standing
// still is not something a tile can be asked for either: a forager posed with no facing
// on a tile with corridor beside it may legitimately keep going (`specs/movement.md`
// leaves that open; see `parkForager`), and on a build's own maze the tile it was posed
// on came with whatever corridors that maze had put there.
//
// So the tile is POSED as a dead end — corridor on exactly one side — and the forager is
// parked facing the rock (`parkForager`), which pins it under either reading of a forager
// at rest. The item then says so out loud: if the forager did leave its tile, that is
// reported as the finding rather than blamed on the decay it was measuring.
import {
  startPlaying,
  poseMaze,
  parkForager,
  denAllExcept,
} from "../_helpers.mjs";

export default function item() {
  let home;
  let g0;
  let gHold;
  let gDecay;
  let end;

  return {
    id: "brightness.holds-decays",

    async arrange(api) {
      await startPlaying(api);
      // Nearly two seconds is long enough for a released hunter to reach the forager,
      // and a life lost resets brightness along with everything else.
      await denAllExcept(api, []);
      // A SEALED TILE, not a dead end. The forager is the subject here and it must not
      // move: every corridor tile carries a plankton (`specs/gameplay.md`) and each one
      // eaten re-arms the hold, so a forager that swims at all makes the decay this item
      // measures unmeasurable. Facing it at rock is not enough — `specs/movement.md` has a
      // blocked forager "reach a wall and stop", but a build that turns it aside instead
      // simply left the dead end and grazed, and the item then reported a decay bug against
      // a build whose decay was fine. A tile with no open neighbour at all takes the
      // question away from every build equally: there is nowhere to turn to.
      //
      // Nothing here needs the forager connected to anything — it stands still and its own
      // brightness is read — so sealing it costs the scenario nothing. The larder
      // `stampLayout` adds keeps the board unclearable (see there).
      home = (await poseMaze(api, ["H"])).mark("H");
      await parkForager(api, home);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s: eat this tile so the forager rests on empty ground
      await api.call("setBrightness", 1); // set G high and arm the hold (as a fresh eat would)
      g0 = (await api.snapshot()).brightness;
      await api.advance(108); // 108 ticks = the old 0.9 s: still inside the ~1 s hold window
      gHold = (await api.snapshot()).brightness;
      await api.advance(120); // 120 ticks = the old 1.0 s: past the hold, into the decay
      gDecay = (await api.snapshot()).brightness;
      await api.advance(84); // 84 ticks = the old 700 ms live tail
      end = (await api.snapshot()).forager;
    },

    async assert(api, check) {
      check.expectEq(
        "the forager stayed put, so nothing it grazed re-armed the hold",
        `${end.tx},${end.ty}`,
        `${home.tx},${home.ty}`,
      );
      check.expectEq("brightness starts high", g0, 1);
      check.expectGt(
        "brightness holds (no drain) inside the hold window",
        gHold,
        0.95,
      );
      check.expectLt(
        "brightness decays once the hold expires",
        gDecay,
        gHold - 0.2,
      );
    },
  };
}
