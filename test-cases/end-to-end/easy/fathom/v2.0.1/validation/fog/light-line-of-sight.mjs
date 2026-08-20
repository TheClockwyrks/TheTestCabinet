// fog.light-line-of-sight: passive light does not bend around corners — a predator
// behind rock is not lit even though it is well within light range.
//
// THE SHAPE OF THE EVIDENCE IS THE POINT. An earlier form of this item posed the two on
// either side of a rock band, parked the forager, and captured a still. The still was of
// an unlit predator — which is to say, of nothing: a dark stretch of trench. A reviewer
// looking at it cannot tell a build that correctly hides a predator around a corner from
// one that has no predator there at all, or from one whose light is simply broken.
//
// So the scenario now MOVES, and the clip carries the whole claim. The forager swims down
// a corridor with the predator waiting around a blind corner: for the length of that
// corridor there is rock on the line and the predator is not drawn, and the moment the
// forager reaches the corner the line opens and the predator appears. Both halves are
// filmed, so the reveal is visible and its timing is the assertion.
//
// AND THE REVEAL IS ALSO WHAT MAKES THE CHECK NON-VACUOUS. "Not lit" is the easiest thing
// in the world to satisfy by accident — a predator out of range, a light that reaches
// nothing, a build that never draws predators at all would each pass it. The pair is
// posed so the predator is inside the light's `160 px` reach (`V = 96 + 64 G`,
// specs/gameplay.md) the whole time, and the second assertion requires it to actually be
// drawn once the rock moves out of the way. A build that fails to reveal it then has not
// passed this item quietly; it fails on the control.
//
// THE PREDATOR IS HELD STILL (`setCreatureAI(false)`, specs/instrumentation.md). It is
// scenery here, not a subject: what is under test is whether LIGHT bends, and a patrol
// that wanders off mid-clip — or around the corner into plain view — turns the reveal
// into an accident of where its own mind took it. Held, the only thing that changes
// between "not drawn" and "drawn" is where the forager is standing.
import {
  DIR_KEY,
  denAllExcept,
  parkForager,
  poseMaze,
  pred,
  startPlaying,
} from "../_helpers.mjs";

// The blind corner. The forager starts at `S` and swims right; the Gloamfin waits at `P`
// down the arm past the junction `J`, with rock on every line between them until the
// forager reaches the corner itself.
//
// The distances are what keep the check honest. `S` to `P` is three tiles across and
// three down — `136 px` apart, comfortably inside the `160 px` the light reaches at
// `G = 1` — so the predator is in range from the first frame and only the rock is
// hiding it. From `J` the arm runs straight down, `96 px` of clear line.
//
// The pocket off to the right holds pellets the forager can never reach, so grazing the
// corridor cannot clear the maze and descend in the middle of the clip.
const BLIND_CORNER = [
  "S..J    ...",
  "   .",
  "   .",
  "   P",
];

// How near the corner the forager may get and still have its tick judged as "blind", in
// tiles. Two, so a whole tile of rock is on the line however either party rounds it.
//
// WHY THERE IS A GUARD BAND AT ALL. Whether a predator is visible from a given spot is a
// question about PIXELS — where the two bodies actually are — and this check knows only
// which tiles they are on. Those two answers disagree for a few ticks either side of the
// corner: a forager whose center is three px short of the junction tile is, to the build,
// already looking down the arm, while a tile-based reading still calls it blocked. Builds
// were failed on three or four such ticks out of ninety, for a disagreement `specs/*` does
// not settle in either direction — light is "line of sight" (specs/gameplay.md) and
// nothing fixes the geometry it is traced in.
//
// So the transition is not judged at all. The claim this item makes is about a predator
// that is plainly around a corner, and it is asked where the answer is plain: two tiles
// back along the corridor, and again once the forager is on the arm with the predator
// straight ahead. What happens in the tile between is the build's business.
const BLIND_MARGIN_TILES = 2;

export default function item() {
  let litWhileBlind = 0;
  let blindSamples = 0;
  let litWhenClear = 0;
  let clearSamples = 0;
  let corner;

  return {
    id: "fog.light-line-of-sight",

    async arrange(api) {
      await startPlaying(api);
      const board = await poseMaze(api, BLIND_CORNER);
      await denAllExcept(api, ["gloamfin"]);
      corner = board.mark("J");
      await api.call("setForager", { ...board.mark("S"), dir: "right" });
      await api.call("setPredator", "gloamfin", {
        ...board.mark("P"),
        dir: "up", // facing the junction it will be revealed from, so the reveal is head-on
        mode: "wander",
      });
      // Scenery, not a subject — see the header.
      await api.call("setCreatureAI", false);
      await api.call("setBrightness", 1); // V = 160 px: the predator is in range throughout
    },

    async act(api) {
      // Swim to the corner, then turn down it, classifying every tick by WHERE the forager
      // is standing (see BLIND_MARGIN_TILES). So the verdict never depends on hitting an
      // exact tick: what matters is that the predator is dark for all of the blind stretch
      // and drawn for some of the clear one.
      const sample = async () => {
        const s = await api.snapshot();
        const g = pred(s, "gloamfin");
        if (!g) return s;
        const f = s.forager;
        if (f.ty === corner.ty && f.tx <= corner.tx - BLIND_MARGIN_TILES) {
          // Back along the corridor: rock is unambiguously on the line.
          blindSamples += 1;
          if (g.lit) litWhileBlind += 1;
        } else if (f.ty > corner.ty) {
          // On the arm, with the predator straight ahead down open corridor.
          clearSamples += 1;
          if (g.lit) litWhenClear += 1;
        }
        // Anything else is the corner itself — see BLIND_MARGIN_TILES.
        return s;
      };

      await api.call("keyDown", DIR_KEY.right);
      // 90 ticks = 0.75 s: three tiles of swimming with the predator hidden around the
      // corner, which is the half of the clip that shows the light NOT bending.
      for (let i = 0; i < 90; i++) {
        await api.advance(1);
        await sample();
      }
      await api.call("keyUp", DIR_KEY.right);
      await api.call("keyDown", DIR_KEY.down);
      // 30 ticks = one tile onto the arm: far enough that the predator is straight ahead
      // down open corridor and plainly lit, and no further. It sits three tiles along and
      // contact costs a life even with its mind switched off.
      for (let i = 0; i < 30; i++) {
        await api.advance(1);
        await sample();
      }
      await api.call("keyUp", DIR_KEY.down);
      // AND PARKED, not merely released. `specs/movement.md` lets a forager with no key
      // held carry on swimming (see `parkForager`), so on those builds the beat below is
      // another tile and a half of travel — which walked it into the predator and ended
      // the clip on the dive countdown instead of on the reveal it exists to show.
      await parkForager(api);
      await api.advance(36); // a beat on the revealed predator before the clip ends
      await api.screenshot("los");
    },

    async assert(api, check) {
      check.expectOk(
        "the scenario ran with the rock between them for a stretch, then clear of it",
        blindSamples > 0 && clearSamples > 0,
      );
      check.expectEq(
        "a predator behind rock is never lit by the light, however close",
        litWhileBlind,
        0,
      );
      // The control: without this, "never lit" is satisfied by a predator that is simply
      // out of range, or by a build that never draws predators at all.
      check.expectOk(
        "and it IS lit once the forager rounds the corner, so the light did reach that far",
        litWhenClear > 0,
      );
    },
  };
}
