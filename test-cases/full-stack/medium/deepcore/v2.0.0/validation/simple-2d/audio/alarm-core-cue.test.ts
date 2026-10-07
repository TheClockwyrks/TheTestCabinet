// audio/alarm-core-cue — the Core Sample's alarm sounds while its timer runs.
//
// `specs/ui.md`: the Core Sample countdown is drawn with its escalating alarm cue,
// and `specs/assets.md` names the cue and states when it plays — while a Core
// Sample's timer runs. So two windows of the same length are measured on the same
// standing miner, one with no Sample live and one with one carried, and
// `alarm-core` must be silent for the first and sounding for the second.
//
// WHAT THE ESCALATION CANNOT BE READ AS. The engine announces a cue's name, the
// frame it sounded on and the gain it sounded at, and nothing about the sound
// itself: not the pitch, not the tempo, not the duration. An alarm that escalates
// by beating faster is visible as a rising rate of plays; one that escalates by
// rising in pitch or swelling in gain inside a single looping source is not, and
// both are `specs/ui.md`-conformant. So this point decides that the alarm plays
// while the timer runs, and the reviewer decides by ear whether it escalates;
// asserting a rising rate of plays would fail conformant builds, which would be
// worse than deciding the half that can be read.
//
// The Sample is posed with plenty of time left, so nothing in either window is the
// detonation the timer eventually reaches. The mine is cleared, the drill is held
// and the miner's travel is held, so nothing else in the scene can sound.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_TIMER, CUES, PLAYABLE_COL_MIN } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
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
import { audibleOver, watchAudio } from "./cues";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 4;
const FRAMES = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the core alarm while a Sample counts down and not before", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinMiner(h);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "alarm", async () => {
    const quiet = await audibleOver(h, log, CUES.alarmCore, WINDOW, FRAMES);
    h.debug.setCoreCarried(true);
    const running = await audibleOver(h, log, CUES.alarmCore, WINDOW, FRAMES);
    return { quiet, running, snapshot: h.snapshot() };
  });

  assertGreaterThan(heard.snapshot.coreTimer ?? 0, 0, "specs/hazards.md");
  assertGreaterThan(
    CORE_TIMER,
    heard.snapshot.coreTimer ?? 0,
    "specs/hazards.md",
  );
  assertEqual(heard.quiet, false, "specs/assets.md");
  assertEqual(heard.running, true, "specs/assets.md");
});
