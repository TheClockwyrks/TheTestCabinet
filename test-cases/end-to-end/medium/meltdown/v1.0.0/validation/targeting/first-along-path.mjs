// Automated validation for the Targeting sub-item `first-along-path`.
//
// An emitter fires on the unit furthest along its path (closest to leaking) first,
// rather than the nearest one (specs/towers.md). We let one Hulk get ahead, then
// spawn a second behind it, both in an Arc's range; the leading Hulk takes damage
// while the trailing one is untouched.
//
// The Arc stands at the gate rather than beside an assumed lane. This item's whole
// claim is a comparison between two units that are BOTH in range, and neither half of
// that is safe on an unforced floor: `specs/playfield.md` fixes the vent and the
// exhaust but not the route between them, so a build whose pathfinder climbs out of
// the opening walks both Hulks past an Arc that never sees either, and "the trailing
// Hulk is untouched" comes out true of a gun with nothing in range at all. The gate
// walls the floor top to bottom with a two-row gap in front of the Arc, so both Hulks
// file through it whatever the pathfinder prefers — which is also what makes "furthest
// along" unambiguous here, since the two are then on the same route. See the note above
// `buildGate` in `_helpers`.
//
// Both units are additionally asserted to be INSIDE the range ring at the moment the
// reading is taken. Without that, an emitter that engaged nothing satisfies the
// untouched half for the wrong reason.

import {
  newGame,
  buildGate,
  spawn,
  unit,
  actTail,
  fpCenter,
  gateCell,
  GATE_CENTER,
  GATE_WALLS,
  TILE,
  TOWER_SIZE,
} from "../_helpers.mjs";

// The Arc's range in tiles (specs/towers.md), as the radius from its footprint centre.
const ARC_RANGE_PX = 6 * TILE;
const ARC_CELL = gateCell("arc");
const ARC_CENTER = fpCenter(ARC_CELL.col, ARC_CELL.row, TOWER_SIZE.arc);

/** Whether `u` is inside the Arc's range ring — a fact about position, nothing else. */
function inArcRange(u) {
  return (
    u != null &&
    Math.hypot(u.x - ARC_CENTER.x, u.y - ARC_CENTER.y) <= ARC_RANGE_PX
  );
}

// How far the leader is let run before the trailing Hulk is released. Just short of
// the gate, so it is unmistakably further along the route while still well inside the
// ring — past the gate it would walk out of range and the comparison would be between
// one unit in range and one out of it.
const LEAD_X = GATE_CENTER.x - 2 * TILE;

// How long both are then left walking. 1.5 s at a Hulk's 38 px/s brings the trailing
// one properly inside the ring without carrying the leader out the far side of it.
const CLOSE_TICKS = 90;

export default function item() {
  let walls;
  let lead;
  let l;
  let t;

  return {
    id: "targeting.first-along-path",

    // The leader's walk up to the gate is skipped; only the two-Hulk window is filmed.
    clipMs: 6000,

    // A hot Arc at the gate, and the first Hulk released into it and walked up to the
    // gap unfilmed. Hulks are used because they are tanky enough to survive being shot
    // at while the second one catches up.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const gate = await buildGate(api, "arc");
      walls = gate.walls;
      await api.call("setHeat", gate.id, 80);
      lead = await spawn(api, "hulk", "left");
      // The approach is not the finding, so it is stepped through rather than filmed
      // (720 ticks = a 12 s ceiling, polled every 6).
      await api.skipUntil(
        (s) => s.surge.some((u) => u.id === lead && u.x >= LEAD_X),
        { max: 720, poll: 6 },
      );
    },

    // Release the trailing Hulk into the same ring and let the Arc fire on the pair.
    // Which of the two takes damage is the check.
    async act(api) {
      const trail = await spawn(api, "hulk", "left");
      await api.advance(CLOSE_TICKS);

      l = await unit(api, lead);
      t = await unit(api, trail);

      // The reading is taken the moment the window closes, so without a beat afterwards
      // the clip ends before the leader's health bar has visibly moved against the
      // trailing one's full bar — which is the whole of the evidence.
      await actTail(api, 120);
    },

    async assert(api, check) {
      // A hole in the gate lets a Hulk walk round the Arc, and "the trailing Hulk is
      // untouched" would then be about the scenery rather than about the targeting.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);
      // Hard, not soft: the two reads below are off these units, so a soft guard
      // here lets the script throw on a null instead — which the driver records as
      // the build failing the debug-API contract rather than as this check's own
      // decided verdict.
      check.assertOk("both Hulks are on the floor", l !== null && t !== null);

      // The premise: this is a choice BETWEEN two available targets, so both have to
      // have been available. Otherwise the untouched half is satisfied by an Arc that
      // could not reach the trailing Hulk in the first place.
      check.expectOk(
        "the leading Hulk is inside the Arc's range",
        inArcRange(l),
      );
      check.expectOk(
        "the trailing Hulk is inside the Arc's range",
        inArcRange(t),
      );

      check.expectLt(
        "the leading Hulk (furthest along) took damage first",
        l.hp,
        l.maxHp,
      );
      check.expectClose(
        "the trailing Hulk is still untouched",
        t.hp,
        t.maxHp,
        0.01,
      );
    },
  };
}
