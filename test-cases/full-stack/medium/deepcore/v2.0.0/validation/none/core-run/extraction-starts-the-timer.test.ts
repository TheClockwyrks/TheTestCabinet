// Deepcore — core-run/extraction-starts-the-timer: drilling the Core banks a
// Sample and starts its clock.
//
// `specs/hazards.md`: "Drilling downward onto the Core in the Core chamber
// extracts a Core Sample into the satchel and starts its destabilization timer at
// `CORE_TIMER` (`90`) seconds."
//
// The miner is stood on the Core — the cell a held `down` cuts into — and `down`
// is held until the satchel reports a Sample. The extraction is the game's own
// drill landing its own hits from the game's own input; nothing here poses a
// Sample. The timer is then read, and it is read against the top of its range
// rather than exactly at it: the sweep samples every fifth of a second, so at
// most that much of the ninety seconds can have run before the reading, which is
// the whole of the slack allowed.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { CORE_COL, CORE_TIMER } from "../constants";
import {
  captureReplay,
  createHarness,
  openScene,
  type Harness,
} from "../harness";
import { EXTRACT_SAMPLE_GAP, extractSample, standOnCore } from "./core-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("banks a Core Sample and starts its timer at CORE_TIMER", async () => {
  await openScene(h);
  const posed = await standOnCore(h);

  assertEqual(
    (await h.tileAt(CORE_COL, posed.coreRow)).kind,
    "core",
    "the cell the miner is stood on",
  );
  assertEqual(posed.satchel.coreSample, false, "a Sample held before the cut");

  const run = await captureReplay(h, "extract", () => extractSample(h));

  assertEqual(run.taken, true, "a Core Sample in the satchel after the cut");
  assertBetween(
    run.snapshot.coreTimer ?? Number.NaN,
    CORE_TIMER - EXTRACT_SAMPLE_GAP,
    CORE_TIMER,
    "seconds left on a freshly extracted Sample",
  );
});
