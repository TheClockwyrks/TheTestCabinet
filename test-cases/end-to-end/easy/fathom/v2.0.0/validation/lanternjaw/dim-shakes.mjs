// lanternjaw.dim-shakes: going dim shrinks its detection range and shakes its fix.
//
// R = 128 + 192 G (specs/predators.md), so a gap that sits inside the range while the
// forager is bright falls outside it once the forager is dim.
//
// WHY THE FORAGER SLIPS AWAY. An earlier form of this check dimmed and then waited out
// the ~2 s linger with the forager left standing exactly where it had been fixed. No
// conforming build can pass that: while it lingers the Lanternjaw paths to the fix at
// 116 px/s, covering 232 px in the 2 s, so to still be outside the dim R = 128 px when
// the linger expires the forager would have to start more than 128 + 232 = 360 px away —
// yet at G = 1 it can only be SENSED within R = 320 px in the first place. The two bounds
// cannot both hold, so a spec-correct Lanternjaw always walks back into range and
// re-acquires before giving up. (The case's own reference implementation failed it.)
//
// So the scenario runs the counter the spec actually describes — "go dim (stop eating and
// let G decay) to shrink its range and slip out of its sight". The forager dims AND slips
// away; the Lanternjaw paths to the now-stale fix and, with its range collapsed to 128 px,
// cannot re-find the forager, so the fix lapses back to wandering. The slip tile is kept
// within 320 px of the fix — still inside the range the Lanternjaw HAD while the forager
// was bright — so it is the dimming, not the distance, that loses it.
//
// Posing is instant (`arrange`); the fix, the dimming and the shaken fix are the real sim,
// so they are `act`.
import {
  startPlaying,
  findSightLine,
  findSlipTile,
  denAllExcept,
  parkForager,
  pred,
  quietBoard,
  tileCenter,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
} from "../_helpers.mjs";

// The dim range (G = 0) and the bright range (G = 1), in px.
const DIM_RANGE = LANTERN_RANGE_BASE; // 128
const BRIGHT_RANGE = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN; // 320

export default function item() {
  let line;
  let slip;
  let fixed;
  let brightRange;
  let afterDim;
  let dimRange;
  let clearance;

  return {
    id: "lanternjaw.dim-shakes",

    async arrange(api) {
      const snap = await startPlaying(api);
      line = findSightLine(snap, 9); // 288 px: inside R at G=1, outside R at G=0
      // Somewhere to slip to: clear of the whole run the Lanternjaw can cover while it
      // lingers, but still inside the range it had while the forager was bright.
      slip = findSlipTile(snap, {
        pred: line.pred,
        fix: line.forager,
        minClear: DIM_RANGE + 48, // 176 px: a tile and a half of margin past the dim range
        maxFromFix: BRIGHT_RANGE,
      });
      const a = tileCenter(snap.grid, slip.tx, slip.ty);
      const b = tileCenter(snap.grid, line.forager.tx, line.forager.ty);
      clearance = Math.hypot(a.x - b.x, a.y - b.y);
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      // Stand the forager on the sight line and PARK it (facing a wall), then strip the
      // field to a single stray plankton it cannot reach. Both halves matter: nothing it
      // passes over may re-brighten G during the measurement, and the clearance figures
      // asserted below are computed from the posed tiles, so they only describe the real
      // scenario if the forager is still standing on them when the linger expires.
      await quietBoard(api, line.forager);
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = 0.05 s: the real light-sense fix at full brightness
      const bright = pred(await api.snapshot(), "lanternjaw");
      fixed = bright.state;
      brightRange = bright.detectRange;
      // Go dim and slip away, together — the spec's counter.
      await api.call("setBrightness", 0);
      await parkForager(api, slip);
      await api.advance(252); // 252 ticks = 2.1 s, just past the ~2 s linger
      const after = pred(await api.snapshot(), "lanternjaw");
      afterDim = after.state;
      dimRange = after.detectRange;
      await api.advance(48); // 48 ticks = 0.4 s live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the Lanternjaw is fixed on the forager while it is bright",
        fixed,
        "chase",
      );
      check.expectClose(
        "its range while bright reaches the forager (R = 128 + 192 G)",
        brightRange,
        BRIGHT_RANGE,
        16,
      );
      check.expectClose(
        "going dim shrinks its range back to R = 128",
        dimRange,
        DIM_RANGE,
        16,
      );
      // The slip tile is chosen to sit outside the shrunk range but inside the bright
      // one, so only the dimming explains a lost fix.
      check.expectGt(
        "the forager slipped outside the shrunk range but stayed inside the bright one",
        clearance,
        DIM_RANGE,
      );
      check.expectLe(
        "and stayed inside the range it had while bright",
        clearance,
        BRIGHT_RANGE,
      );
      check.expectEq(
        "the shrunk range cannot re-find it, so the fix lapses (back to wandering)",
        afterDim,
        "wander",
      );
    },
  };
}
