// Wick — audio/cue-fallen: the tick that ends the run fallen plays `fallen`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `fallen` to "The run ends fallen", and "Each is played on the tick its
// event happens ... and at most once on that tick." `specs/world.md`, Fallen
// and dawn: "A run ends at the end of a tick, after every other phase of that
// tick has been applied", with the fallen row reading "`hp` is `0` or below"
// and setting `screen` to `fallen`. One ending on one tick is therefore
// exactly one `fallen`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing, with
// every driver switch off, `hp` posed to `0` and one tick run.
// `specs/instrumentation.md` states what that pose means: "A value at or
// below `0` ends the run fallen at the end of the next `playing` tick,
// through the ending rule of `specs/world.md`" — so the ending is the game's
// own rule reached from a posed field rather than a posed screen, and a pose
// "sounds nothing" in its own right.
//
// The clock is nowhere near dawn, so the dawn ending, which "is checked
// first", cannot take this tick instead. The world holds no enemy,
// projectile, zone, gem, or pickup, so the tick raises no other cue, and a
// tick that ends the run "opens no overlay", so no `level-up` or `chest`
// rides along either.
//
// THE TOLERANCE. None: the specification fixes the cue to the tick of the
// ending and to at most one play on it, and the collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  endFallen,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays fallen once on the tick the run ends fallen", async () => {
  await isolatedRun(h);

  const { result: after, played } = await captureReplay(h, "fallen", () =>
    cuesOf(h, () => endFallen(h)),
  );

  // The premise: the tick really ended the run fallen.
  assertEqual(
    after.screen,
    "fallen",
    "the screen the tick with hp at zero ended on (specs/world.md, Fallen and dawn)",
  );

  assertEqual(
    heard(played, CUES.fallen),
    1,
    "fallen cues on the tick the run ended fallen (specs/ui.md, Audio)",
  );
});
