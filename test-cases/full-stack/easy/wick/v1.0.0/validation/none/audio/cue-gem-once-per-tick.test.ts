// audio/cue-gem-once-per-tick — a tick on which five gems are collected plays
// gem exactly once.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`gem` | `CUES.gem` | A
// gem is collected. At most once per tick", and under the table: "Each is played
// on the tick its event happens, or on the frame for a menu event, and at most
// once on that tick". So five collections on one tick are one `gem`, and the
// count read here is exactly one.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so the five gems are the
// whole of the field. Each is posed on the lamplighter's center, at distance `0`,
// which is inside `COLLECT_RADIUS` (`8`), and specs/world.md collects "every gem
// within `COLLECT_RADIUS`" on a tick, "this tick's drops and the gems a draft
// attracted on this tick included" — so one tick takes all five. They are `small`
// gems, worth `GEM_VALUES.small` (`1`) each, and `isolate` holds the run at level
// `50`, where `xpToNext(50)` is `495`: five points open no level-up overlay, so
// the tick raises `gem` and nothing else. That all five were taken is asserted
// off the empty gem list before the cues are counted.
//
// THE TOLERANCE. None: a count of cues on one tick is a whole number, and the
// specification fixes it at one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  placeGem,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, openNight } from "./cues";

/** The gems posed on the lamplighter's center, as the review item states. */
const GEMS = 5;

/** Frames recorded after the collecting tick, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays gem once on the tick five gems are collected", async () => {
  const opened = await openNight(h);
  const at = opened.run.player;
  for (let i = 0; i < GEMS; i += 1) await placeGem(h, "small", at.x, at.y);
  const posed = await h.snapshot();
  assertLength(posed.run.gems, GEMS, "the gems posed on the lamplighter");

  const cues = await watchNamedCues(h);
  const taken = await captureReplay(h, "once", async () => {
    const after = await h.step(1);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertLength(taken.after.run.gems, 0, "the gems left after one tick");
  assertGreaterThan(
    taken.after.run.xp,
    opened.run.xp,
    "the experience the five collections added",
  );
  assertHeardOnce(
    cues,
    taken.frame,
    "gem",
    "the gem cues on the tick five gems were collected",
  );
});
