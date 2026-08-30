// Arc Foundry — audio/slow: the slow cue sounds on the frame a slow is applied,
// and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.slow` is played when
// "a slow is applied to a unit", and each cue is played "on the frame its event
// happens, by the code that raised it, and at most once on that frame".
//
// THE SCENARIO. One Scrap Choke and one held Slug inside its stated range of `104`.
// `specs/components.md` makes the Choke a "single target, applies slow" type whose
// hit applies a slow for `CHOKE_SLOW_DUR`, so the slow is applied by the game's own
// systems rather than posed — the cue is bound to the event, and driving the real
// hit is what raises it. The Slug survives: a Scrap Choke deals `3` against the
// forty health `specs/enemies.md` scales a Slug to on wave one at Medium, so no
// kill lands on the same frame.
//
// WHERE THE LISTENING STARTS. After the shot has been fired, because the frame the
// Choke fires carries its own firing cue. Between the shot and its arrival the
// specification names no event, so that stretch must be silent.
//
// WHAT MARKS THE EVENT. `specs/enemies.md` and `specs/instrumentation.md` make an
// applied slow set `slowFactor` to `min(slowFactor, 1 - amount)`, so the frame the
// unit's `slowFactor` first falls below `1` is the frame the slow was applied.

import { afterEach, beforeEach, it } from "vitest";

import { CUES } from "../../src/constants";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  watchCues,
  type Harness,
} from "../harness";
import { ANCHOR, TARGET, beforeFrame, names, onFrame } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds on the frame the slow lands, and not between the shot and the hit", async () => {
  openYard(h, { wave: 1 });
  standComponent(h, "choke", 1, ANCHOR.col, ANCHOR.row);
  const target = parkUnit(h, "slug", TARGET);

  const slowed = await captureReplay(h, "slow", async () => {
    const shot = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(3),
    });
    const cues = watchCues(h);
    const landed = await h.until(
      (s) => s.units.some((u) => u.id === target && u.slowFactor < 1),
      { maxFrames: ticks(2) },
    );
    return { fired: shot.hit, landed: landed.hit, frame: h.frame(), cues };
  });

  assertEqual(
    slowed.fired,
    true,
    "a Scrap Choke with a unit inside its range to fire within three seconds " +
      "(specs/components.md)",
  );
  assertEqual(
    slowed.landed,
    true,
    "a Scrap Choke's hit to apply its slow to the unit it strikes " +
      "(specs/components.md)",
  );
  assertDeepEqual(
    names(beforeFrame(slowed.cues, slowed.frame)),
    [],
    "no cue to sound between the shot and its arrival, where the " +
      "specification names no event (specs/ui.md)",
  );
  assertContains(
    names(onFrame(slowed.cues, slowed.frame)),
    CUES.slow,
    `the ${CUES.slow} cue on the frame a slow is applied to a unit ` +
      "(specs/ui.md)",
  );
});
