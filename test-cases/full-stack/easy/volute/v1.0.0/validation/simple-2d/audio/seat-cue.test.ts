// audio/seat-cue — the cue an insertion plays is `seat`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): `seat` is played when "A projectile
// is inserted into the train", and each cue "sounds on the tick its event
// happens, and at most once on that tick".
//
// WHY THE POSED PAIR CARRIES TWO DIFFERENT CHARGES. The seated core has to
// complete no run, or `specs/extraction.md` would draw one out on the same
// tick and an `extract-k` would sound beside the `seat`. A `cobalt` and a
// `sulfur` are posed and a `halide` is fired, so the insertion leaves three
// cores of three charges standing and `seat` is the only cue the specification
// permits on the tick. All three are in level 1's charge set, so the
// arrangement is one the level could itself produce.
//
// THE TICK IT IS READ ON. The tick the last projectile leaves the hall, which
// is the tick it seated: the sweep stops there and the reading is taken there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { OPENING_AIM } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  driveShot,
  fireAt,
  poseHall,
  spacedRun,
  watchCues,
  type Harness,
} from "../harness";
import {
  EXTRACT_CUES,
  assertHeardOnce,
  assertSilentOn,
  openHall,
} from "./cues";

/** The head of the posed pair, at `(420, 40)` on specs/channel.md's first leg. */
const POSED_HEAD_S = 380;

/** Two charges the fired one matches neither of, so nothing is drawn out. */
const POSED = ["cobalt", "sulfur"] as const;

/** The charge fired into them. */
const FIRED = "halide";

/** Ticks recorded after the seat, so the clip shows the train it joined. */
const TRAIL_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the seat cue on the tick a projectile is inserted", async () => {
  await openHall(h);
  await poseHall(h, {
    cores: spacedRun(POSED_HEAD_S, POSED),
    loaded: FIRED,
  });
  await fireAt(h, OPENING_AIM);

  const played = watchCues(h);
  const seated = await captureReplay(h, "seat", async () => {
    const landed = await driveShot(h);
    const measured = { landed, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertTrue(seated.landed.landed, "the fired core resolved within the sweep");
  assertEqual(
    coreCount(seated.landed.snapshot),
    POSED.length + 1,
    "the cores standing once the shot seated, none of them drawn out",
  );
  assertHeardOnce(
    seated.cues,
    seated.tick,
    "seat",
    "the seat cue on the tick the projectile was inserted",
  );
  assertSilentOn(
    seated.cues,
    seated.tick,
    EXTRACT_CUES,
    "the extraction cues on a tick that drew nothing out",
  );
});
