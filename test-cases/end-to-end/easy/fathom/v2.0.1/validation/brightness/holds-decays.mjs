// brightness.holds-decays: G holds ~1 s after the last pellet, then decays — never a
// constant drain.
//
// Only the placement is instant; holding and decaying are real elapsed time, so they
// belong in `act` — which is also the clip, where the hold and then the fall are visible
// at the game's own pace.
//
// THE HOLD IS ARMED BY EATING, SO EATING IS WHAT ARMS IT HERE. `specs/gameplay.md`
// defines the hold as a property of the last pellet swallowed — "the `1.0 s` hold resets
// every time you eat a plankton" — and the forager is standing on one, so the plankton
// under it is the whole precondition this item needs. Posing `G` with `setBrightness`
// instead would put the reading one step further from the rule: that op arms the hold too
// (`specs/instrumentation.md` fixes that, precisely so a posed brightness does not drain
// out from under its caller), but then what the hold window shows is the op honouring its
// contract rather than the game honouring the rule. Eating is the only path the spec
// defines the hold in terms of, so it is the one to drive.
//
// The consequence is that `G` starts at one pellet's worth, `+0.34`, rather than at the
// `1` a posed value could give — so the assertions below are written against the value
// the eat actually produced instead of against a fixed number. The shape is the claim:
// steady across the hold, then most of it gone a second later. `brightness/from-eating`
// owns the size of the step itself.
//
// THE FORAGER HAS TO ACTUALLY STAND STILL, and that is the whole difficulty. Every
// corridor tile carries a pellet and every pellet re-arms the hold, so a forager that
// swims even a little during the two-second window grazes its way to a `G` that never
// falls and the item reports a decay bug against a build that decays perfectly well.
// Standing still is not something a tile can be asked for either: a forager posed with no
// facing on a tile with corridor beside it may legitimately keep going
// (`specs/movement.md` leaves that open; see `parkForager`), and on a build's own maze the
// tile it was posed on came with whatever corridors that maze had put there.
//
// So the tile is POSED as a sealed one and the forager parked on it, which pins it under
// every reading. The item then says so out loud: if the forager did leave its tile, that
// is reported as the finding rather than blamed on the decay it was measuring.
import {
  startPlaying,
  poseMaze,
  parkForager,
  denAllExcept,
  unmetPrecondition,
} from "../_helpers.mjs";

// The read inside the hold, in ticks after the step the pellet was eaten on: `0.8 s`,
// which leaves a fifth of a second of margin at each end of the `1.0 s` window — enough
// to absorb both the poll the eat landed in and any reasonable reading of "about a
// second".
const INSIDE_HOLD = 96;

// And the read after it, `1.25 s` further on: a little over a second of decay, by which
// point `G *= 0.5 ^ (dt / 0.9)` has taken away rather more than half.
const INTO_DECAY = 150;

// How much of the held value must be gone by then. The spec curve leaves about `0.44` of
// it; anything still above `0.6` is either not decaying or decaying far too slowly to be
// the half-life the spec names.
const DECAYED_TO = 0.6;

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
      // Nothing here needs the forager connected to anything — it stands still, eats the
      // pellet it is standing on and its own brightness is read — so sealing it costs the
      // scenario nothing. The larder `stampLayout` adds keeps the board unclearable (see
      // there).
      home = (await poseMaze(api, ["H"])).mark("H");
      await parkForager(api, home);
    },

    async act(api) {
      // Eat the pellet under the forager. That is the event the hold is defined by, and
      // from here the tile is bare, so nothing can re-arm it.
      await api.advance(6);
      g0 = (await api.snapshot()).brightness;
      await api.advance(INSIDE_HOLD);
      gHold = (await api.snapshot()).brightness;
      await api.advance(INTO_DECAY);
      gDecay = (await api.snapshot()).brightness;
      await api.advance(84); // 84 ticks = the old 700 ms live tail
      end = (await api.snapshot()).forager;
    },

    async assert(api, check) {
      // Whether a pellet under the forager is eaten at all is `brightness/from-eating`'s
      // verdict, and it gives it. With no eat there is no hold to watch, so stand aside
      // rather than report the same defect a second time under a decay heading.
      if (!(g0 > 0)) {
        throw unmetPrecondition(
          "the plankton under the forager was not eaten, so no hold was ever armed to watch decay from",
        );
      }
      check.expectEq(
        "the forager stayed put, so nothing it grazed re-armed the hold",
        `${end.tx},${end.ty}`,
        `${home.tx},${home.ty}`,
      );
      check.expectGe(
        `brightness holds (no drain) inside the hold window, at the ${g0.toFixed(2)} the pellet gave it`,
        gHold,
        g0 - 0.01,
      );
      check.expectLt(
        "brightness decays once the hold expires",
        gDecay,
        gHold * DECAYED_TO,
      );
    },
  };
}
