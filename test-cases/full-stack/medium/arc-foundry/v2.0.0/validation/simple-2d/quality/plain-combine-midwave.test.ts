// quality/plain-combine-midwave — a fold of standing structures resolves mid-wave.
//
// specs/scrap-press.md fixes the two kinds of combine by what they consume:
// standing structures only is "a plain combine", which "Resolves and leaves the
// phase running", and "A plain combine is the only combine available during a live
// wave, since candidates exist only in a build phase". specs/campaign.md says the
// same from the wave's side: during a wave "a plain combine, refining the press,
// upgrading a combination tower, and changing a targeting priority stay
// available", and specs/controls.md lists `combine` as available "during a wave
// when it folds standing structures only".
//
// The wave is opened through `spawnUnit`, which "puts the run into a live wave
// whose spawn schedule is empty" (specs/instrumentation.md), so the yard holds one
// held unit and the pair being folded and nothing else — no composed wave walking
// through the reading, and no clear landing in the middle of it. The pair is stood
// before the wave opens, because placement is a build-phase act and the
// requirement is about the FOLD rather than about building under a wave.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openHeldWave,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { anchored } from "./anchors";

const INITIATOR = { col: 8, row: 10 };
const PARTNER = { col: 12, row: 10 };

/** The wave the run is posed at, so an unchanged counter is a visible figure. */
const WAVE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("folds a standing pair during a live wave and leaves the phase running", async () => {
  openYard(h, { wave: WAVE });
  const initiator = standComponent(
    h,
    "capacitor",
    2,
    INITIATOR.col,
    INITIATOR.row,
  );
  standComponent(h, "capacitor", 2, PARTNER.col, PARTNER.row);
  openHeldWave(h);

  const before = h.snapshot();
  assertEqual(before.phase, "wave", "the phase the fold is committed in");
  assertEqual(before.wave, WAVE, "the wave the fold is committed in");

  const after = await captureReplay(h, "plain", async () => {
    h.debug.combine(initiator);
    await h.advanceSeconds(1);
    return h.snapshot();
  });

  // The fold resolved.
  assertEqual(
    anchored(after, INITIATOR).quality,
    3,
    "two Tuned folded into one Charged, mid-wave",
  );
  assertEqual(
    anchored(after, PARTNER).kind,
    "blocker",
    "the consumed footprint, hardened rather than freed",
  );
  // And it left the phase exactly where it found it.
  assertEqual(after.phase, "wave", "the phase after a plain combine");
  assertEqual(after.wave, WAVE, "the wave number after a plain combine");
  assertEqual(after.waveActive, true, "the wave still running after the fold");
});
