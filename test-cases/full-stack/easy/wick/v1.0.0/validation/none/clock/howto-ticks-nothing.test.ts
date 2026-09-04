// clock/howto-ticks-nothing — nothing advances on howto.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("What advances on each screen"):
// on `title` and `howto`, "Nothing." specs/state.md: "Off the run, on `title`
// and `howto`, the run's fields hold their idle values: tick `0`, level `1`,
// no experience, no kills, the lamplighter at the world origin facing right
// with `BASE_MAX_HP` (`100`) health, no weapons, no passives, nothing alive,
// nothing dropped, no offers, no level-ups earned, no chest result, the spawn
// timer at `0`, no events fired, and the next id `0`." specs/enemies.md fixes
// what a tick on those screens would have shown: "A spawn therefore lands on
// the first tick of a run", from a spawn timer at `0`.
//
// THE DRIVE. A reset stands the game on `title` with the idle run;
// `spawning` is turned on explicitly, so that a build which ticked the idle
// run would spawn a moth on the first such tick. Sixty frames run on `title`,
// then `setScreen("howto")` enters the how-to "exactly as confirming `HOW TO
// PLAY` does: the idle run", and sixty more run there. After each, `run` is
// the idle run it started as, `tick` is `0`, and nothing is alive.
//
// THE TOLERANCE. None: an idle run that ticked nothing holds identical
// numbers, so the comparison is `assertDeepEqual` over the whole of `run`,
// with the tick and the empty world read out by name.
//
// The other screen is `clock/title-ticks-nothing`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { DEFAULT_SEED } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  poseScreen,
  worldIsEmpty,
  type Harness,
} from "../harness";

/** The frames run on the screen: a second of wall-clock frames. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances nothing across 60 frames on howto", async () => {
  await h.debug.reset({ seed: DEFAULT_SEED });
  await enable(h, "spawning");
  const before = await poseScreen(h, "howto");
  assertEqual(before.screen, "howto", "the screen the frames run on");
  assertEqual(before.run.tick, 0, "the idle run's tick on howto");

  const held = await h.step(HELD_FRAMES);
  await captureStill(h, "idle");

  assertEqual(held.screen, "howto", "the screen after 60 frames on howto");
  assertEqual(held.run.tick, 0, "run.tick after 60 frames on howto");
  assertTrue(
    worldIsEmpty(held),
    "nothing alive and nothing dropped after 60 frames on howto",
  );
  assertDeepEqual(
    held.run,
    before.run,
    "the run after 60 frames on howto, against the idle run",
  );
});
