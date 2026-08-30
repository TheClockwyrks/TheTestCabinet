// Arc Foundry — audio/slow: the slow cue sounds on the frame a slow is applied,
// and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.slow` is played when
// "a slow is applied to a unit", and each cue is played "on the update its event
// happens, and at most once on that update".
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
// Choke fires carries its own firing cue and the name of a sound is not observable
// from outside an engineless build. Between the shot and its arrival the
// specification names no event, so that stretch must be silent.
//
// WHAT MARKS THE EVENT. `specs/enemies.md` and `specs/instrumentation.md` make an
// applied slow set `slowFactor` to `min(slowFactor, 1 - amount)`, so the frame the
// unit's `slowFactor` first falls below `1` is the frame the slow was applied.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
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
import { ANCHOR, SETTLE, TARGET, beforeFrame, onFrame } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the slow lands, and not between the shot and the hit", async () => {
  await h.armAudio();
  await openYard(h, { wave: 1 });
  await h.advance(SETTLE);
  await standComponent(h, "choke", 1, ANCHOR.col, ANCHOR.row);
  const target = await parkUnit(h, "slug", TARGET);

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
    beforeFrame(slowed.cues, slowed.frame).map((cue) => cue.frame),
    [],
    "nothing to sound between the shot and its arrival, where the " +
      "specification names no event (specs/ui.md)",
  );
  assertGreaterThan(
    onFrame(slowed.cues, slowed.frame).length,
    0,
    "a cue to sound on the frame a slow is applied to a unit (specs/ui.md)",
  );
});
