// Meltdown — controls/rotate-key-does-nothing-unarmed: KeyR with nothing held
// changes nothing.
//
// specs/controls.md states it in the action table — `rotate` "Turns the held
// preview one step. With nothing held it changes nothing." — and
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
// ONE FIELD IS NORMALISED AWAY, AND ONLY ONE. `simTime` "accumulates the game
// time the simulation advanced by" (specs/instrumentation.md), and the press has
// to be delivered on a real frame, so a frame's worth of it moves whatever the
// key does or does not do. Holding the clock still is not the requirement here —
// `waves.pause-freezes-the-floor` and `waves.speed-doubles-the-rate` own the
// clock — so it is set aside, and every other field of the snapshot is compared
// exactly.
//
// THE OPENING PHASE IS WHAT MAKES THAT HONEST. A between-wave build phase would
// move `buildTimer` too — specs/waves.md has it fall "by one second per second of
// game time" — and a second excused field is a second place a defect could hide.
// The opening phase "carries no countdown, reports a `buildTimer` of `0`, and
// never starts a wave on its own however long it runs", so with both rosters
// empty and the world gate shut there is nothing left in the game that a frame
// alone can move.
//
// NOTHING IS ARMED, WHICH IS THE PRECONDITION, AND IT IS ASSERTED RATHER THAN
// ASSUMED: `startRun` leaves `build`, `selected` and `hoverShop` all `null`, so
// the key under test has no preview to turn, and the reading below says so out of
// the snapshot before the press rather than trusting the pose.
//
// A TOWER STANDS SELECTED, because one of the mistakes named above cannot be seen
// on an empty floor. A build that turns the SELECTED tower when there is nothing
// held moves that tower's `rotation` and its `radiatorFaces` — and on a floor
// with no tower on it there is no such field for the comparison to catch it in.
// So one tower is posed at a rotation of its own and selected, and the
// whole-snapshot comparison then covers the turned-the-selection reading as well
// as the armed-something and charged-for-it ones.
//
// IT IS A STUTTER AT ROTATION 1, the same tower at the same rotation on the same
// tile the other two engines' copies of this point pose, so the three read one
// scenario rather than three. A Stutter's LOCAL radiators are N and E
// (`specs/towers.md`): an asymmetric pair, so every one of the three turns it
// could take names a different pair of WORLD faces and shows in `radiatorFaces`
// on its own. An Arc, whose N-and-S pair a half turn maps onto itself, would
// leave `rotation` as the only witness to a two-step turn.
//
// AND IT MOVES NOTHING BY ITSELF over the frame that carries the press, with all
// of its faculties left on. It is posed at the heat `0` a placed tower starts at
// (`specs/instrumentation.md`); `specs/heat.md` makes air cooling proportional to
// heat, so at `0` it is nothing at all; nothing stands beside it to conduct with;
// and with the surge roster empty it finds no target, takes no shot and gains no
// heat.
//
// AND THE FRAME IS PROVEN TO HAVE HAPPENED. A comparison of two snapshots is
// satisfied by a build that never ran a frame at all, so `simTime` — the one
// field set aside from the comparison — is read in the other direction: it must
// have gained across the press. That is what makes an unchanged snapshot evidence
// that the key did nothing rather than evidence that nothing was running.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, type Rotation } from "../constants";
import { assertDeepEqual, assertGreaterThan, assertNull } from "../assert";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";

/** The key specs/controls.md binds `rotate` to, and the only one. */
const KEY = BINDINGS.rotate;

/**
 * The tower left standing selected, where it stands, and the rotation it was
 * placed at.
 *
 * A Stutter's local radiator faces are `N` and `E` (specs/towers.md) — an
 * asymmetric pair — so each of the four rotations names a different pair of world
 * faces and a turn of ANY size shows in `radiatorFaces`, not only a quarter turn.
 * Rotation `1` rather than `0` so a build that reset the selection's rotation
 * would move the field too, not only one that advanced it. `FREE_SITE` is clear
 * of both vent-to-exhaust corridors, so standing a tower there lengthens no
 * route.
 */
const TOWER = "stutter";
const SITE = FREE_SITE;
const PLACED_AT: Rotation = 1;

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

afterEach(async () => {
  await h?.dispose();
});

it("leaves every reported field as it was when KeyR is pressed with nothing held", async () => {
  await startRun(h);
  // The untimed phase: nothing in the posed world moves but the clock.
  await h.debug.setPhase("opening");
  await h.debug.setBuildTimer(0);

  // One tower standing selected at a rotation of its own: the arrangement in
  // which turning the selection would show.
  const id = await poseTower(h, TOWER, SITE.col, SITE.row, PLACED_AT);
  await h.debug.setSelected(id);
  await h.debug.setArmed(null);

  await h.advance(1);
  const before = await h.snapshot();
  assertNull(
    before.build,
    "precondition: nothing is held when the key is pressed",
  );

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "unarmed");

  assertDeepEqual(
    stilled(after),
    stilled(before),
    `${KEY}: the reported state after one press with no placement armed and a ` +
      `${TOWER} standing selected at rotation ${PLACED_AT}, its clock aside`,
  );
  assertGreaterThan(
    after.simTime,
    before.simTime,
    "precondition: the game time the frame carrying the press advanced by, " +
      "without which an unchanged snapshot would say nothing",
  );
});
