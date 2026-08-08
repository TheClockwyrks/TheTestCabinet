// Automated validation for the Rime sub-item `core-immune`.
//
// A Core boss cannot be slowed (specs/surge.md) — a Rime's slow has no effect on it,
// "regardless of the Rime's heat". A cold Rime is stood at the gate and two windows are
// run past it: a Core, which must cross its range at full speed, and then a Mote on the
// identical floor, which must not.
//
// WHY THERE IS A CONTROL WINDOW, AND WHY THE FIRST ONE IS PRECONDITIONED ON RANGE.
//
// The subject here is an ABSENCE — no slow — and an absence is also what a Rime that
// never engaged, never fired, or never worked at all produces. Every reading in the
// Core window is identical between a build whose Core is properly immune and one whose
// Rime is simply inert, so on its own the window passes on both, and the single case it
// exists to catch (a build that slows the Core) is the only one it would still fail.
// A check must not be able to pass by its own scenario failing to happen.
//
// So the Core window carries a positive engagement reading. Immunity "is to the slow
// effect only and changes nothing about targeting — a Rime treats it as an ordinary
// target" (specs/surge.md), so a Rime with a Core in range acquires it and fires, and
// firing warms the tower by `heatPerShot / mass` (specs/heat.md). The Rime is posed at
// heat 0 and the gate's walls are Sinks, which never fire and only cool — and stand a
// clear column off the Rime, so they touch nothing. Nothing on this floor can add heat
// to it but its own shots: its heat leaving 0 IS its first
// shot at the Core, and nothing else. Heat is read rather than `firing` because
// `firing` is a per-step flag a sweep can land either side of, while the heat a shot
// adds stays on the tower.
//
// The Core window is also preconditioned on GEOMETRY — the Core is asserted to be inside
// the Rime's range ring when it is read — so that a build which fails to engage fails
// the engagement assertion rather than silently satisfying an absence.
//
// And the control window rules out an inert Rime from the other side, by running a Mote
// through the same gate past the same tower and requiring THAT one to come out slowed. A build passes only if the same Rime, in the same spot, slows what it can and
// leaves the Core alone.

import {
  newGame,
  restartGame,
  buildGate,
  skipToGate,
  spawn,
  unit,
  heatOf,
  actTail,
  fpCenter,
  gateCell,
  GATE_WALLS,
  TOWER_SIZE,
  TILE,
} from "../_helpers.mjs";

// Base speeds in px/s (specs/surge.md). Speeds do not scale with the wave
// (specs/gameplay.md), so these are exact for the units spawned below.
const CORE_BASE_SPEED = 30;
const MOTE_BASE_SPEED = 60;

// The Rime's range in tiles (specs/towers.md), as the radius from its footprint centre
// that specs/towers.md measures it from.
const RIME_RANGE_PX = 5.5 * TILE;

const RIME_CELL = gateCell("rime");
const RIME_CENTER = fpCenter(RIME_CELL.col, RIME_CELL.row, TOWER_SIZE.rime);

/** Whether `u` is inside the Rime's range ring — a fact about position, nothing else. */
function inRimeRange(u) {
  return (
    u != null &&
    Math.hypot(u.x - RIME_CENTER.x, u.y - RIME_CENTER.y) <= RIME_RANGE_PX
  );
}

export default function item() {
  let rimeId;
  let coreId;
  let walls;
  let core;
  let mote;
  let rimeHeat;

  return {
    id: "rime.core-immune",

    // Two windows, each a unit walking the length of the Rime's range ring.
    clipMs: 9000,

    // A cold Rime at the gate, with a Core walking down to it. The gate (see
    // `buildGate` in `_helpers`) is what puts the unit in front of the tower at all:
    // specs/playfield.md fixes only the two ENDS of a left-vent unit's journey, so a
    // Rime parked beside the lane a Core is assumed to walk never has it in range on a
    // build whose pathfinder picks a different shortest route.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const gate = await buildGate(api, "rime");
      rimeId = gate.id;
      walls = gate.walls;
      await api.call("setHeat", rimeId, 0);
      coreId = await spawn(api, "core", "left");
      // A Core walks at 30 px/s and the gate is eight columns in, so the approach is
      // several seconds of nothing happening. Step it through unfilmed so the window
      // below opens with the Core already in the ring.
      await skipToGate(api, coreId);
    },

    // Window 1: the Core walks into and through the Rime's range, and is read while it
    // is still inside it. Window 2: the same gate, re-posed mid-drive, with a Mote
    // taking the same walk — the control that proves this Rime slows what it can.
    async act(api) {
      await actTail(api, 120); // 2 s of the Core crossing the range ring
      core = await unit(api, coreId);
      rimeHeat = await heatOf(api, rimeId);

      await restartGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const gate = await buildGate(api, "rime");
      await api.call("setHeat", gate.id, 0);
      const moteId = await spawn(api, "mote", "left");
      // Long enough for the Mote to reach the Rime and be slowed by it; the read is
      // taken while it is still on the floor.
      await actTail(api, 180); // 3 s of the Mote crossing the same range ring
      mote = await unit(api, moteId);
    },

    async assert(api, check) {
      // A hole in the gate lets a unit walk round the Rime, and both windows would then
      // be about the scenery rather than about the slow.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);

      // Hard: everything below reads the two units.
      check.assertOk("the Core is still on the floor", core !== null);
      check.assertOk("the Mote is still on the floor", mote !== null);

      // The control: this Rime demonstrably slows a unit that can be slowed. Without
      // it, an inert Rime passes every remaining assertion.
      check.expectOk("the Mote is inside the Rime's range", inRimeRange(mote));
      check.expectEq("the Mote IS slowed by the Rime", mote.slowed, true);
      check.expectLt(
        "and the Mote's speed is down on its base 60 px/s",
        mote.speed,
        MOTE_BASE_SPEED,
      );

      // The claim: the same Rime, the same gate, an immune unit.
      check.expectOk("the Core is inside the Rime's range", inRimeRange(core));
      // And the Rime engaged it. Immunity "changes nothing about targeting"
      // (specs/surge.md), so a Rime with a Core in range fires on it, and firing is the
      // only thing on this floor that can warm a tower posed at 0 among Sinks. Without
      // this, "the Core was not slowed" is equally true of a Rime that never shot at it.
      check.expectGt("the Rime fired on the Core", rimeHeat, 0);
      check.expectEq("the Core is not slowed by the Rime", core.slowed, false);
      // Measured against the Core's PUBLISHED base speed (30, specs/surge.md) and not
      // against the build's own `baseSpeed`: comparing a build's `speed` to its own
      // `baseSpeed` is satisfied by any build reporting the two as equal, however
      // slowly its Core actually walks, so the ratio cannot state that the Core kept
      // its speed — and a build that omits `baseSpeed` turns the comparison into
      // `undefined`, failing this item for a missing field rather than for a slowed
      // Core. Whether `baseSpeed` is reported at all is `surge.stats`'s claim.
      check.expectClose(
        "the Core keeps its full base speed (30 px/s)",
        core.speed,
        CORE_BASE_SPEED,
        0.01,
      );
    },
  };
}
