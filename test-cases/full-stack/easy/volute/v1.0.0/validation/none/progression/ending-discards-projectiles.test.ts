// progression/ending-discards-projectiles — a dismissed ending discards the
// shots in flight.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md` fixes one of those values as "no
// projectiles".
//
// WHY IT IS ITS OWN POINT. A build clears the channel and discards the shots
// in two different places, and one of the two is easy to forget: a shot that
// survives the title arrives in the next run with nothing that fired it. The
// cores are `progression/ending-clears-channel`'s point.
//
// HOW A SHOT IS PUT IN THE AIR UNDER AN ENDING. Fired on `playing`, where
// `specs/controls.md` makes the fire control live, over a channel `poseHall`
// left empty and an inlet it holds — so the shot strikes nothing, seats
// nothing and extracts nothing — and the ending is then posed around it with
// `setScreen`, which `specs/instrumentation.md` has change "nothing else".
// Both readings before the press assert the projectile really is there, so a
// build that never fired one cannot pass by having nothing to discard.
//
// THE TOLERANCE. None. A count of projectiles is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { OPENING_AIM } from "../constants";
import {
  captureStill,
  createHarness,
  fireAt,
  poseHall,
  pressConfirm,
  projectileCount,
  type Harness,
} from "../harness";
import { ENDED_LEVEL } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards every projectile in flight when an ending is dismissed", async () => {
  // Fired on `playing`, where the fire control lives, over an empty channel: the
  // shot strikes nothing and cannot be seated or extracted away before the press.
  await poseHall(h, { level: ENDED_LEVEL });
  await fireAt(h, OPENING_AIM);
  const armed = await h.snapshot();
  assertGreaterThan(
    projectileCount(armed),
    0,
    "the projectiles in flight before the ending was posed",
  );

  // The ending is posed AROUND the shot: `setScreen` "changes nothing else", so
  // the projectile is still there when the press runs.
  await h.debug.setScreen("gameover");
  const ended = await h.snapshot();
  assertGreaterThan(
    projectileCount(ended),
    0,
    "the projectiles the posed ending still carried",
  );

  const title = await pressConfirm(h);
  await captureStill(h, "discarded");

  assertEqual(title.screen, "title", "the screen the confirm press left");
  assertEqual(
    projectileCount(title),
    0,
    "the projectiles a dismissed ending left in flight",
  );
});
