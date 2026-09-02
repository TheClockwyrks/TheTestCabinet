// Meltdown — audio/place-cue: a placement that lands plays the `place` cue on
// the frame the tower appears, and a placement that is refused plays nothing.
//
// `specs/audio.md` binds `place` to "a tower is placed on the floor" and then
// closes the other half explicitly: "An event that does not resolve raises
// nothing, so a placement refused as invalid plays no `place` cue." Both halves
// are this one review item, so both are checked here, each on its own posed
// floor, so a failed grade names which half the build got wrong.
//
// THE PRESS IS THE PLAYER'S, END TO END. No operation of the debug surface plays
// a cue and none can (`specs/instrumentation.md`), so neither `setArmed` nor
// `place` appears below: the type is armed by a press and release on the shop
// entry the panel itself reported in `controls.shop`, and the tower is committed
// by a press and release on the floor — which `specs/controls.md` makes "one
// interaction with that region", and which is the only route with a frame for a
// cue to belong to.
//
// THE REFUSAL IS THE PLAINEST ONE THERE IS. A tower already standing on the
// footprint makes every one of its tiles blocked, and `specs/building.md` needs
// "every tile of the footprint is open" for a footprint to be valid. Nothing else
// about the floor is touched: the money is left at the mode's starting sum, well
// past the Arc's cost, so the refusal is the blocked tiles and not the purse.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  footprintCenter,
  poseTower,
  pressAt,
  shopEntry,
  startRun,
  tapControl,
  watchCues,
  type Harness,
} from "../harness";
import { playedBefore, playedOn, playsOf } from "./cues";

/**
 * The tile the placement is aimed at: quiet floor, off every opening, and far
 * enough from every edge that a lone 2x2 there seals nothing (`specs/mazing.md`).
 */
const AT = { col: 10, row: 5 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the place cue on the frame the tower lands", async () => {
  startRun(h);

  // Armed the way the panel offers it: a press and release inside the rect the
  // build reported for the Arc's shop entry (specs/controls.md, specs/hud.md).
  const entry = shopEntry(h.snapshot(), "arc");
  if (entry === undefined) {
    fail(
      "the panel to report a shop entry for the Arc, which is what a " +
        "placement is armed through (specs/hud.md)",
      "controls.shop carries no Arc entry",
    );
  }

  // Subscribed before the arming, so a build that sounded `place` on ARMING —
  // rather than on the tower landing — is caught by the quiet before the press.
  const played = watchCues(h);
  await tapControl(h, entry);
  assertEqual(
    h.snapshot().build?.type,
    "arc",
    "posing: the press on the shop entry armed the Arc (specs/controls.md)",
  );

  // The commit: a press and release on the footprint's centre, which carries the
  // held preview onto that footprint and then commits it (specs/building.md).
  const centre = footprintCenter("arc", AT.col, AT.row);
  await pressAt(h, centre.x, centre.y);
  const frame = h.engine.frame().count;
  captureStill(h, "place");

  const landed = h.snapshot();
  assertLength(
    landed.towers,
    1,
    "towers on the floor after the press: the placement landed " +
      "(specs/building.md, Placing)",
  );
  assertLength(
    playedBefore(played, frame),
    0,
    "cues that played on any frame before the tower landed — a cue is raised " +
      "by the frame that resolves the event it answers (specs/audio.md)",
  );
  assertDeepEqual(
    playedOn(played, frame),
    [CUES.place],
    "the cues that played on the frame the tower landed: the place cue, and " +
      "nothing else (specs/audio.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the gain the place cue played at on an unmuted bus (specs/audio.md)",
  );
});

it("plays nothing when the same press is refused as invalid", async () => {
  startRun(h);
  // The footprint is occupied before the press, so every one of its tiles is
  // blocked and the placement check refuses it (specs/building.md, Valid and
  // invalid). `addTower` "runs no placement check" and raises no cue
  // (specs/instrumentation.md), so it is arrangement and nothing more.
  poseTower(h, "arc", AT.col, AT.row, 0);

  const entry = shopEntry(h.snapshot(), "arc");
  if (entry === undefined) {
    fail(
      "the panel to report a shop entry for the Arc, which is what a " +
        "placement is armed through (specs/hud.md)",
      "controls.shop carries no Arc entry",
    );
  }

  const played = watchCues(h);
  await tapControl(h, entry);

  const centre = footprintCenter("arc", AT.col, AT.row);
  h.pointer("pointermove", centre.x, centre.y);
  await h.advance(1);
  assertEqual(
    h.snapshot().build?.valid,
    false,
    "posing: the held footprint reads invalid over the standing tower " +
      "(specs/building.md, Valid and invalid)",
  );

  await pressAt(h, centre.x, centre.y);

  assertLength(
    h.snapshot().towers,
    1,
    "towers on the floor after the refused press: nothing was built " +
      "(specs/building.md, Placing)",
  );
  assertLength(
    playsOf(played, CUES.place),
    0,
    "plays of the place cue across the refused placement — a placement " +
      "refused as invalid raises nothing (specs/audio.md)",
  );
});
