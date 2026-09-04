// screens/end-screen-figures — the end screen reports the run that just ended.
//
// WHAT THIS DECIDES. One thing: the figures an end screen carries are the ended
// run's own, both in what the snapshot reports and in what the frame draws, so
// a build that cleared the run on the way to the end screen, or drew figures
// from somewhere else, fails. That the screen draws these three fields at all
// is `fallen-copy`.
//
// THE SPEC IT RESTS ON.
//   specs/world.md ("Fallen and dawn"): the run ends on the tick `hp` reaches
//   `0`, which is the ending this point drives.
//   specs/instrumentation.md ("Snapshot shape"): "`run` reports the idle run of
//   `specs/state.md` on `title`, `howto`, and `almanac`, and the run that just
//   ended on `fallen` and `dawn`."
//   specs/ui.md ("`fallen` and `dawn`"): the figures table, "Time survived |
//   The run clock at the end, as `m:ss`", "Level | The level reached", "Kills |
//   The kill count".
//   specs/state.md (`RunState`): "The run clock is `tick / TICK_HZ` (`60`)
//   seconds", so tick `7260` is `121` seconds, drawn `2:01`.
//
// THE DRIVE. An isolated `playing` run posed to the clock, level, and kill
// count this point names, ended the way the rule ends it: "the fallen ending is
// `setHp` at `0` and one tick" (specs/instrumentation.md), which is what
// `endFallen` composes. The clock is posed one tick short of `TICK` so the
// ending tick is the one that reaches it. The three fields are read off the
// snapshot and then looked for on the frame, so a build that cleared the run on
// the way to the end screen, and one that drew figures it did not keep, both
// fail.
//
// THE TOLERANCE. None on the snapshot: three whole counts. On the frame each
// figure is matched as a whole number in the frame's text, so a neighbouring
// figure cannot supply it, and the clock as the `m:ss` spelling specs/ui.md
// fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { clockText } from "../constants";
import {
  captureStill,
  createHarness,
  drewPhrase,
  endFallen,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

/** The run the item names: 7260 ticks is 121 seconds, drawn 2:01. */
const TICK = 7260;
const LEVEL = 6;
const KILLS = 143;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps and draws the ended run's clock, level, and kills", async () => {
  isolate(h, { level: LEVEL });
  h.debug.setTick(TICK - 1);
  h.debug.setKills(KILLS);
  await endFallen(h);
  const ended = h.snapshot();

  const { calls } = await h.frameDraw();
  captureStill(h, "figures");

  assertEqual(
    ended.screen,
    "fallen",
    "the screen the ended run is reported on",
  );
  assertEqual(ended.run.tick, TICK, "the tick the end screen reports");
  assertEqual(ended.run.level, LEVEL, "the level the end screen reports");
  assertEqual(ended.run.kills, KILLS, "the kills the end screen reports");

  const figures = [clockText(TICK), String(LEVEL), String(KILLS)];
  assertDeepEqual(
    figures.filter((text) => !drewPhrase(calls, text)),
    [],
    "the ended run's figures, missing from the end screen's frame",
  );
});
