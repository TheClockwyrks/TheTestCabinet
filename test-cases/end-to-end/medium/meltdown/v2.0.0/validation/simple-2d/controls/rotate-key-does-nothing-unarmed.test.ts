// Meltdown — controls/rotate-key-does-nothing-unarmed: KeyR with nothing held
// changes nothing.
//
// THE RULE. specs/controls.md states it in the action table — `rotate` "Turns the
// held preview one step. With nothing held it changes nothing." — and
// specs/building.md says it again: "With nothing held, rotating changes nothing at
// all."
//
// A NEGATIVE REQUIREMENT IS READ AS A WHOLE SNAPSHOT. The mistakes this rule
// exists to catch do not announce themselves in one field: a build that arms the
// first shop entry when there is nothing to turn moves `build`; one that turns the
// SELECTED tower instead moves a tower's `rotation` and its `radiatorFaces`; one
// that treats the key as a menu step moves `menuIndex`; one that charges for the
// turn moves `money`. So the reading is the whole reported state before against
// the whole reported state after, which is exactly what the item's description
// asks for — "leaves every field of the snapshot as it was" — and it is why this
// point caps at `great` rather than lower: a build that does something extra here
// is a build doing something extra everywhere.
//
// ONE FIELD IS NORMALISED AWAY, AND ONLY ONE. `simTime` is the accumulated
// simulation time (specs/instrumentation.md), and the press has to be delivered on
// a real frame, so a frame's worth of it moves whatever the key does or does not
// do. Holding the clock still is not the requirement here —
// `waves.pause-freezes-the-floor` and `waves.speed-doubles-the-rate` own the clock
// — so it is set aside, and every other field of the snapshot is compared exactly.
//
// THE OPENING PHASE IS WHAT MAKES THAT HONEST. A between-wave build phase would
// move `buildTimer` too — specs/waves.md has it fall "by one second per second of
// game time" — and a second excused field is a second place a defect could hide.
// The opening phase carries no countdown and never starts a wave on its own, so
// with both rosters empty and the world gate shut there is nothing left in the
// game that a frame alone can move.
//
// NOTHING IS ARMED, WHICH IS THE WHOLE PRECONDITION: `startRun` leaves `build`
// and `hoverShop` `null`, so the key under test has no preview to turn.
//
// BUT A TOWER STANDS ON THE FLOOR, AND IT IS THE SELECTED ONE. An empty floor
// cannot see the second of the defects listed above: a build that answers the key
// by turning the SELECTED tower has nothing to turn when no tower is standing, so
// the press changes nothing for the wrong reason and the check passes a build that
// breaks the rule. specs/building.md closes that door from the other side — "a
// placed tower's rotation and its world radiator faces never change again" — so
// the tower is posed, selected, and left in the comparison, where a turn of it
// moves both `rotation` and `radiatorFaces`.
//
// A STUTTER AT ROTATION 1, because its local radiators are N and E: an asymmetric
// pair, so EVERY one of the three turns it could take names a different pair of
// world faces. An Arc, whose N-and-S pair a half turn maps onto itself, would miss
// a build that turned it two steps.
//
// THE POSED TOWER MOVES NOTHING BY ITSELF over the frame that carries the press.
// It is posed by `addTower`, which starts it at heat `0` with both faculties on
// (specs/instrumentation.md); air cooling is proportional to heat and so is zero
// there, nothing stands beside it to conduct, and with both rosters otherwise
// empty it finds no target, takes no shot and gains no heat. Its freshness holds
// too: specs/building.md ends freshness with the build phase the tower was placed
// in, and the opening phase is not one and never becomes one here.
//
// THE PRESS IS PROVEN TO HAVE LANDED IN A RUNNING GAME. `simTime` is compared
// apart rather than merely excused: a build whose frame advanced no game time at
// all would make the whole-snapshot comparison pass without the key ever having
// been delivered, so the clock is required to have gained.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertDeepEqual, assertGreaterThan, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";
import { freeSite } from "../towers/roster";

/** The key specs/controls.md binds `rotate` to, and the only one. */
const KEY = BINDINGS.rotate[0];

/**
 * The tower left standing and selected under the press, and the rotation it
 * stands at.
 *
 * A Stutter's local radiators are N and E, so each of the four rotations names a
 * different pair of world faces and a turn of any size shows in `radiatorFaces`.
 */
const TOWER = "stutter";
const PLACED_AT = 1;

/**
 * The snapshot with its clock normalised away.
 *
 * `simTime` is the one field a frame moves on its own, and a frame is what
 * delivers the press. Every other field is compared as it stands.
 */
function stilled(snapshot: MeltdownSnapshot): MeltdownSnapshot {
  return { ...snapshot, simTime: 0 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every reported field as it was when KeyR is pressed with nothing held", async () => {
  startRun(h);
  // The untimed phase: nothing in the posed world moves but the clock.
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(0);

  // A tower standing on the floor, selected, with nothing armed: the state in
  // which a build that turns the SELECTED tower would give itself away.
  const at = freeSite(0);
  const id = poseTower(h, TOWER, at.col, at.row, PLACED_AT);
  h.debug.setSelected(id);
  h.debug.setArmed(null);

  await h.advance(1);
  const before = h.snapshot();
  assertNull(
    before.build,
    "precondition: nothing is armed when the key is pressed",
  );

  await h.tap(KEY);
  captureStill(h, "unarmed");
  const after = h.snapshot();

  assertDeepEqual(
    stilled(after),
    stilled(before),
    `${KEY}: the reported state after one press with no placement armed and a ` +
      `${TOWER} standing selected at rotation ${PLACED_AT}, its clock aside ` +
      `(specs/controls.md, The actions)`,
  );
  assertGreaterThan(
    after.simTime,
    before.simTime,
    `precondition: the game time the frame carrying the ${KEY} press advanced by`,
  );
});
