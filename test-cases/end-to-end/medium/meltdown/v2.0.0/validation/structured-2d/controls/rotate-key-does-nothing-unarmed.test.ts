// Meltdown — controls/rotate-key-does-nothing-unarmed: R with nothing held
// changes nothing.
//
// THE RULE. "With nothing held, rotating changes nothing at all"
// (specs/building.md, Rotating the preview), which specs/controls.md restates as
// "`rotate` ... With nothing held it changes nothing". The failure this exists to
// catch is a build that answers `rotate` by arming something, by turning a placed
// tower, or by advancing a rotation it keeps outside the preview.
//
// HOW "CHANGES NOTHING" IS DECIDED. By reading the WHOLE snapshot either side of
// the press and comparing it field for field, rather than by naming the few
// fields a wrong build might touch. Naming them would be a list of guesses; the
// snapshot is every field an operation can set (specs/instrumentation.md,
// Snapshot shape), so comparing all of it decides the requirement as stated.
//
// A TOWER STANDS ON THE FLOOR, AND IT IS THE SELECTED ONE. An empty floor cannot
// see the second of the three failures named above. A build that answers the key
// by turning the SELECTED tower has nothing to turn when no tower is standing, so
// the press changes nothing for the wrong reason and the check passes a build that
// breaks the rule outright — which is the very defect the rule exists for, since a
// pause menu over a floor that keeps running is not more legal than a rotate that
// turns the wrong thing. specs/building.md closes that door from the other side —
// "a placed tower's rotation and its world radiator faces never change again" — so
// the tower is posed, selected, and left in the comparison, where a turn of it
// moves both `rotation` and `radiatorFaces`.
//
// A STUTTER AT ROTATION 1, and both halves of that are load-bearing. Its LOCAL
// radiators are N and E (specs/towers.md): an asymmetric pair, so every one of the
// three turns it could take names a different pair of WORLD faces and shows in
// `radiatorFaces` on its own. An Arc, whose N-and-S pair a half turn maps onto
// itself, would leave `rotation` as the only witness to a two-step turn. And
// rotation `1` rather than `0` so a build that RESETS the selection's rotation
// moves the field too, not only one that advances it. This is the same tower at the
// same rotation on the same tile that the other two engines' copies of this point
// pose, so the three read one scenario.
//
// WHY THE SCENARIO IS AN OPENING PHASE OVER AN OTHERWISE QUIET FLOOR. One frame of
// game time passes to deliver the press, so the comparison is only honest where
// nothing else in the game is moving. The opening phase "carries no countdown,
// reports a `buildTimer` of `0`, and never starts a wave on its own however long
// it runs" (specs/waves.md, The opening phase); the surge roster is empty, so no
// unit walks and the posed tower finds no target, takes no shot and gains no heat;
// air cooling is proportional to heat and so is nothing at all at the `0` a placed
// tower starts at; nothing stands beside it to conduct with; and the world gate is
// off, so nothing is released. The one field that must still move is `simTime`,
// which "accumulates the game time the simulation advanced by"
// (specs/instrumentation.md) — every frame of every screen gains it, so it is
// compared apart rather than expected to hold still.
//
// AND THE PRESS IS PROVEN TO HAVE LANDED IN A RUNNING GAME. `simTime` is compared
// apart rather than merely excused: a build whose frame advanced no game time at
// all would make the whole-snapshot comparison pass without the key ever having
// been delivered, so the clock is required to have gained.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";
import { QUIET_SITE } from "./scene";

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
 * The snapshot without the one field a frame of game time is entitled to move.
 *
 * Not a tolerance: `simTime` is excluded because specs/waves.md makes its gain
 * the definition of a frame having happened, and the press cannot be delivered
 * without one.
 */
function apartFromTheClock(
  snapshot: MeltdownSnapshot,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...snapshot };
  delete fields.simTime;
  return fields;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every field of the snapshot as it was", async () => {
  startRun(h);
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(0);
  h.debug.setArmed(null);

  // A tower standing on the floor, selected, with nothing armed: the state in
  // which a build that turns the SELECTED tower would give itself away.
  const id = poseTower(h, TOWER, QUIET_SITE.col, QUIET_SITE.row, PLACED_AT);
  h.debug.setSelected(id);

  // One settled frame first, so what is read below is a floor already standing
  // still rather than one the pose is still landing on.
  await h.advance(1);

  const before = h.snapshot();
  assertNull(
    before.build,
    "precondition: nothing is held when the key is pressed",
  );

  await h.tap("KeyR");
  captureStill(h, "unarmed");
  const after = h.snapshot();

  assertDeepEqual(
    apartFromTheClock(after),
    apartFromTheClock(before),
    `the snapshot either side of R with nothing held and a ${TOWER} standing ` +
      `selected at rotation ${PLACED_AT}`,
  );
  // The press really was delivered into a running game: a frame that advanced no
  // game time would make the comparison above pass on a dead build.
  assertGreaterThan(
    after.simTime,
    before.simTime,
    "precondition: the game time the frame carrying the press advanced by, " +
      "without which an unchanged snapshot would say nothing",
  );
});
