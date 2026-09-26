// audio/alarm-core-cue — the Core Sample's alarm sounds while its timer runs.
//
// `specs/ui.md`: the Core Sample countdown is drawn with its escalating alarm cue,
// and `specs/assets.md` names the cue and states when it plays — while a Core
// Sample's timer runs. So two windows of the same length are measured on the same
// standing miner, one with no Sample live and one with one carried, and the build
// must be silent for the first and sounding for the second.
//
// WHAT THE ESCALATION CANNOT BE READ AS. `audio-init.js` counts the sounds a build
// emits and nothing about them: not the pitch, not the gain, not the duration. An
// alarm that escalates by beating faster, one that escalates by growing louder and
// one that escalates by rising in pitch are all `specs/ui.md`-conformant and only
// the first is visible from out here. So this point decides that the alarm plays
// while the timer runs, and the reviewer decides by ear whether it escalates;
// asserting a rising rate of plays would fail two of those three builds, which
// would be worse than deciding the half that can be read.
//
// The Sample is posed with plenty of time left, so nothing in either window is the
// detonation the timer eventually reaches. The mine is cleared, the drill is held
// and the miner's travel is held, so nothing else in the scene can sound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CORE_TIMER, PLAYABLE_COL_MIN } from "../constants";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { armAudio, soundsOver } from "./probe";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 4;
const FRAMES = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("is silent with no Sample live and sounds while one is counting down", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await pinDrill(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);

  const heard = await captureReplay(h, "alarm", async () => {
    const quiet = await soundsOver(h, WINDOW, FRAMES);
    await h.debug.setCoreCarried(true);
    const running = await soundsOver(h, WINDOW, FRAMES);
    return { quiet, running, snapshot: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertGreaterThan(heard.snapshot.coreTimer ?? 0, 0, "specs/hazards.md");
  assertGreaterThan(
    CORE_TIMER,
    heard.snapshot.coreTimer ?? 0,
    "specs/hazards.md",
  );
  assertEqual(heard.quiet, 0, "specs/assets.md");
  assertGreaterThan(heard.running, 0, "specs/assets.md");
});
