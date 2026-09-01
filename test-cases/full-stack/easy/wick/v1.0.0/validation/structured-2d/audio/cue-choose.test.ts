// Wick — audio/cue-choose: the frame an offer is accepted plays `choose`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `choose` to "An offer is accepted, with no `menu-confirm` beside it", and
// "Each is played on the tick its event happens, or on the frame for a menu
// event, and at most once on that tick." `specs/progression.md`, Choosing:
// "`confirm` accepts the highlighted offer" and "Accepting an offer applies
// it on the spot". One acceptance on one frame is therefore exactly one
// `choose`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no weapon and no
// passive, with one level-up queued and the one tick run that opens the
// overlay. Holding nothing leaves every base weapon and every passive a
// candidate (`specs/progression.md`, The candidate pool), so the overlay
// fills its draw. With exactly one level-up queued the acceptance returns the
// game to `playing` rather than opening another overlay, so the frame the cue
// is read on carries the acceptance and nothing else. The world holds no
// enemy, projectile, zone, gem, or pickup and every driver switch is off.
//
// The acceptance is a real `Enter`, not `choose`: the surface's `choose`
// "Sounds nothing" and "A pose changes the state alone and sounds nothing"
// (`specs/instrumentation.md`), so the event this cue belongs to only happens
// on a frame a key press makes. `Enter` carries `confirm`
// (`specs/controls.md`), and `menuIndex` is `0` on opening, so the offer
// accepted is the first.
//
// THE TOLERANCE. None: the specification fixes the cue to the frame of the
// acceptance and to at most one play on it, and the collector reads whole
// frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  openLevelUp,
  tap,
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

it("plays choose once on the frame an offer is accepted", async () => {
  await isolatedRun(h);
  const opened = await openLevelUp(h, 1);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the overlay opened on before the acceptance",
  );

  const { result: after, played } = await captureReplay(h, "choose", () =>
    cuesOf(h, () => tap(h, "Enter")),
  );

  // The premise: the frame really accepted the highlighted offer.
  assertEqual(
    after.run.pendingLevelUps,
    0,
    "the level-ups left queued after the acceptance (specs/progression.md, Choosing)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen the acceptance of the last queued level-up returned to",
  );

  assertEqual(
    heard(played, CUES.choose),
    1,
    "choose cues on the frame an offer was accepted (specs/ui.md, Audio)",
  );
});
