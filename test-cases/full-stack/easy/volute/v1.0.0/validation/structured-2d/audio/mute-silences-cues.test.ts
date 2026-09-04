// audio/mute-silences-cues — a muted hall sounds its cues at no gain, and the
// bed goes on looping.
//
// THE SPEC LINE. `specs/ui.md` ("Mute"): muting silences the hall, and "A
// muted bed keeps looping silently and returns when unmuted", with "The game
// stays fully playable with sound muted". So a mute is a gain of nothing
// rather than a stop: the bed is still running, and a cue raised while muted
// is still raised.
//
// WHAT THIS DECIDES, AND WHAT IT DOES NOT. What muting did to the SOUND. That
// the game reports itself muted is `screens/mute-toggle`'s point, which every
// engine of this case decides; a build that flips the reported bit and goes on
// playing at full gain passes that one and fails this.
//
// THE DRIVE. The bed is let up, the mute control is raised, and then the fire
// control is — so the cue read is one the specification puts on that tick,
// announced by the bus with the gain it sounded at. A build that silences by
// stopping its bed instead fails the second reading, which is the half of the
// rule that says a muted bed keeps looping.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseHall,
  pressFire,
  pressMute,
  watchCues,
  type Harness,
} from "../harness";
import { assertOneBedLooping, openHall, QUIET_CORES } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue at no gain while muted, and keeps the bed looping", async () => {
  await openHall(h);
  await poseHall(h, { cores: QUIET_CORES });
  await assertOneBedLooping(h, "the beds looping before the mute");

  const muted = await pressMute(h);
  assertEqual(muted.muted, true, "the mute bit the control set");

  const played = watchCues(h);
  await pressFire(h);
  const tick = h.tick();
  captureStill(h, "muted");

  const heard = played.filter((cue) => cue.tick === tick);
  assertLength(heard, 1, "the cues the muted hall sounded on the firing tick");
  assertEqual(heard[0]?.gain, 0, "the gain the muted hall sounded its cue at");
  await assertOneBedLooping(h, "the beds still looping while muted");
});
