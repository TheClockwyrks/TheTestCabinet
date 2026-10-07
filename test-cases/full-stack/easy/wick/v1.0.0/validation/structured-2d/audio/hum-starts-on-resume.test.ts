// Wick — audio/hum-starts-on-resume: the hum comes back when play resumes
// with Halo held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`hum` is looping
// on every frame exactly when `screen` is `playing` and a held weapon is
// `halo` or `corona`. It starts on the frame that first makes both true,
// whether Halo was just acquired or play just resumed from an overlay or a
// pause, and it stops on the frame either stops being true." On `paused` the
// screen conjunct is false, so the threshold there is `false`; on the frames
// after play resumes both conjuncts hold, so the threshold is `true`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Halo alone, with
// the hum let up first, then `paused` posed — `specs/instrumentation.md`
// makes that pose set `screen` alone, leaving the run as it stands — and the
// hum read as `false` there, which is the state this point resumes FROM. Then
// `playing` posed from `paused`, which sets `screen` back the same way, so
// the run under the pause is the run the resumed frames read. Posing both
// keeps the `pause` binding out of an audio
// point, so a build with a broken key fails the control points and is decided
// here on its audio alone.
//
// The route matters: this is the second of the two starts the rule names, and
// a build that only starts the hum where a weapon is acquired leaves it
// silent for the rest of a run after the first pause. Halo is the only weapon
// held, `weaponFire` is off so its pulses never run, and the world holds no
// enemy, projectile, zone, gem, or pickup, so nothing over the span changes
// either conjunct of the rule.
//
// THE TOLERANCE. One frame for the reconciliation, which the specification
// itself grants, and no gap after it. The reading is a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  poseScreen,
  type Harness,
} from "../harness";
import { isolatedRun, loopTrace } from "./cues";

/** Frames read after the resume: the reconciling frame and half a second. */
const FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has hum not looping on paused and looping from the frame after play resumes", async () => {
  await isolatedRun(h);
  holdWeapon(h, "halo", 1);
  await h.advance(1);
  assertEqual(
    h.looping(CUES.hum),
    true,
    "whether the hum was up on playing with Halo held, before the pause",
  );

  poseScreen(h, "paused");
  await h.advance(1);
  assertEqual(
    h.looping(CUES.hum),
    false,
    "whether the hum was still running on paused (specs/ui.md, The loops)",
  );

  const resumed = poseScreen(h, "playing");
  assertEqual(resumed.screen, "playing", "the screen the resume left");
  assertEqual(
    resumed.run.weapons.some((weapon) => weapon.id === "halo"),
    true,
    "whether the resume left Halo held, which the run being untouched requires",
  );

  const trace = await captureReplay(h, "resumed", () =>
    loopTrace(h, CUES.hum, FRAMES),
  );

  assertEqual(
    trace.filter((looping) => !looping).length,
    0,
    `frames after play resumed on which hum was not looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
