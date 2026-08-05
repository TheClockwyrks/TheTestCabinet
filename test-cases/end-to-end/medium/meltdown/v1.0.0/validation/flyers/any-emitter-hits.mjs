// Automated validation for the Flyers sub-item `any-emitter-hits`.
//
// Any emitter can damage a flyer in range — the Flak is the dedicated air specialist,
// not the only counter (specs/towers.md). We place a plain Arc on the flight line,
// spawn a real Drift, and confirm the Arc damages it.
//
// NO GATE HERE, DELIBERATELY. Its ground-unit siblings all wall the floor to force the
// surge past the gun, because the route a walking unit takes between the vent and the
// exhaust is the build's own choice. A flyer is the one case where that problem does
// not arise and where the wall would not solve it either: a Drift "flies in a straight
// line from its vent to that vent's opposite exhaust, over every tower and wall"
// (specs/playfield.md), so no arrangement of towers can move it a pixel. What is left
// open is only WHERE across the four-row opening it enters, so the Arc stands on the
// opening's own centre rows — where its 6-tile ring covers every line a left-vent flyer
// could take — and the sweep records whether the Drift really was inside that ring, so
// a miss is reported as a miss rather than as an emitter that never had a shot.

import {
  newGame,
  build,
  spawn,
  actTail,
  fpCenter,
  gateCell,
  TILE,
  TOWER_SIZE,
  TICK,
} from "../_helpers.mjs";

// The Arc sits where the gate's emitter stands — on the vent's centre rows, a few
// columns in — but with no wall, per the note above.
const ARC_CELL = gateCell("arc");
const ARC_RANGE_PX = 6 * TILE;
const ARC_CENTER = fpCenter(ARC_CELL.col, ARC_CELL.row, TOWER_SIZE.arc);

/** Whether `u` is inside the Arc's range ring — a fact about position, nothing else. */
function inArcRange(u) {
  return (
    u != null &&
    Math.hypot(u.x - ARC_CENTER.x, u.y - ARC_CENTER.y) <= ARC_RANGE_PX
  );
}

export default function item() {
  let driftId;
  let r;
  let sawInRange = false;

  return {
    id: "flyers.any-emitter-hits",

    // A plain Arc — not a Flak — sitting on the flight line, hot enough to do real
    // damage, with a real Drift flying into its range.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const arc = await build(api, "arc", ARC_CELL.col, ARC_CELL.row);
      await api.call("setHeat", arc, 80); // fire at real damage
      driftId = await spawn(api, "drift", "left");
    },

    // 360 ticks = a 6 s cap; polling every tick catches the first hit rather than a
    // state several shots later. The sweep ends ON the tick the Arc's shot connects, so
    // without the tail the clip is a Drift flying in and then black — the one thing the
    // item exists to show is the frame after the cut.
    async act(api) {
      r = await api.until(
        (s) => {
          const u = s.surge.find((x) => x.id === driftId);
          if (inArcRange(u)) sawInRange = true;
          return Boolean(u && u.hp < u.maxHp);
        },
        { max: 360, poll: TICK },
      );
      await actTail(api);
    },

    async assert(api, check) {
      // The premise: the flyer really did cross the ring. Without it, "the Arc did not
      // damage the Drift" would be equally true of a Drift that entered on a line the
      // Arc could not reach — which is a scenario fault, not a targeting one.
      check.expectOk("the Drift flew inside the Arc's range", sawInRange);
      check.expectOk("a plain Arc damaged the flyer in range", r.hit);
    },
  };
}
