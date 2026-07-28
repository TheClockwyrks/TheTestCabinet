// Automated validation for the Flyers sub-item `flak-air-only`.
//
// The Flak targets flyers only — it cannot damage a ground unit, but it damages a
// flyer in range (specs/towers.md). We put a Flak on the lane and confirm a ground
// Mote walks through its range untouched, then a Drift is damaged.
//
// The ground half reads the FLAK's own lifetime `damageDealt` rather than the Mote's
// remaining HP. Reading the Mote instead only works while there is a Mote to read:
// a Flak that wrongly shoots ground units kills a 40 HP Mote in about two shots at
// this heat, well before it crosses — so on exactly the build this item exists to
// catch, the unit is gone and there is no HP left to compare. The tower's counter
// survives the unit and answers the question directly, and it is the same counter
// `info.counts` checks the build maintains.

import {
  newGame,
  restartGame,
  build,
  spawn,
  tower,
  fpCenter,
  actTail,
  TILE,
  TOWER_SIZE,
  TICK,
} from "../_helpers.mjs";

// The Flak's lane position, and the range it covers from there (specs/towers.md).
const FLAK_COL = 10;
const FLAK_ROW = 17;
const FLAK_RANGE_PX = 8 * TILE;
const FLAK_CENTER = fpCenter(FLAK_COL, FLAK_ROW, TOWER_SIZE.flak);

// Pose a hot Flak on the lane with a unit of `surgeType` walking into its range.
// `start` is the fresh-match helper to use: `newGame` in arrange, and `restartGame`
// in act — this item is a genuine two-configuration comparison (ground unit, then
// flyer), so the second setup has to be posed mid-drive, where `reset()` (and
// therefore `newGame`) throws.
async function poseFlakAgainst(api, start, surgeType) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const flak = await build(api, "flak", FLAK_COL, FLAK_ROW);
  await api.call("setHeat", flak, 80);
  const target = await spawn(api, surgeType, "left");
  return { flak, target };
}

export default function item() {
  let flakId;
  let moteId;
  let sawInRange = false;
  let firedAtGround = false;
  let groundDamage;
  let r;

  return {
    id: "flyers.flak-air-only",

    // Both halves have to be filmed, and neither can be skipped into: the ground half
    // means nothing unless a reviewer watches the Mote cross the Flak's whole range
    // untouched — the pass IS the evidence, not the approach to it — and the air half
    // needs the shot at the Drift on screen. That is around 11 s on a conformant build,
    // which is what this covers; past it the Mote is taking a route that some pathing
    // item owns. See CLIP_HEADROOM_MS in _helpers.
    clipMs: 11000,

    // Configuration A: a ground Mote walking past the Flak.
    async arrange(api) {
      const posed = await poseFlakAgainst(api, newGame, "mote");
      flakId = posed.flak;
      moteId = posed.target;
    },

    // Walk the Mote through the Flak's range and out the far side (1200 ticks = the
    // old 20s cap). The sweep also records that the Mote really was in range, without
    // which "the Flak did no damage" would be true of a Mote that never came near it.
    // Then re-pose the same Flak against a Drift and let it fire: 360 ticks = the old
    // 6s cap, polled every tick to catch the first hit.
    //
    // Polled every 2 ticks rather than the 6 this sweep used to use. Six was sized for
    // POSITION — a 6 px stride through a ~300 px window, which cannot step over the
    // pass — but the firing read below is not a position, it is a per-STEP flag that is
    // true only on the steps the tower actually shoots. A build firing once or twice a
    // second sets it on a handful of steps out of the whole crossing, and a coarse
    // sweep would miss every one of them and report a clean pass for a Flak that was
    // shooting the Mote the entire way. Two ticks is fine enough to land on a shot
    // whatever cadence the build fires at, and the sweep is still bounded by the same
    // cap.
    async act(api) {
      await api.until(
        (s) => {
          const u = s.surge.find((x) => x.id === moteId);
          if (
            u &&
            Math.hypot(u.x - FLAK_CENTER.x, u.y - FLAK_CENTER.y) <=
              FLAK_RANGE_PX
          ) {
            sawInRange = true;
          }
          // Whether the Flak ever so much as TAKES A SHOT while a ground unit is the
          // only thing on the floor. `damageDealt` alone cannot see this: a build
          // whose Flak happily targets and fires at ground units, but whose ground
          // damage rounds to nothing, leaves the counter at 0 and passes an item whose
          // whole claim is that the Flak does not engage ground at all. `firing` is
          // the build's own report that it has a target and is shooting at it
          // (specs/instrumentation.md), and with one Mote on an otherwise empty floor
          // there is nothing else it could be shooting at.
          if (s.towers.some((t) => t.id === flakId && t.firing)) {
            firedAtGround = true;
          }
          return !u || u.x > FLAK_CENTER.x + FLAK_RANGE_PX;
        },
        { max: 1200, poll: 2 },
      );
      groundDamage = (await tower(api, flakId))?.damageDealt ?? null;
      await actTail(api); // hold on the Mote clear of the range, unharmed

      const air = await poseFlakAgainst(api, restartGame, "drift");
      r = await api.until(
        (s) => s.surge.some((u) => u.id === air.target && u.hp < u.maxHp),
        { max: 360, poll: TICK },
      );
      await actTail(api); // and on the Drift being hit by that same Flak
    },

    async assert(api, check) {
      // Hard: without a Mote inside the Flak's range there was never an opportunity
      // to shoot it, and "no damage" below would mean nothing.
      check.assertOk("the Mote walked into the Flak's range", sawInRange);
      check.expectEq(
        "the Flak never even fires while only a ground unit is on the floor",
        firedAtGround,
        false,
      );
      check.expectEq(
        "the Flak dealt no damage at all to the ground Mote",
        groundDamage,
        0,
      );
      check.expectOk("the Flak damaged the flyer", r.hit);
    },
  };
}
