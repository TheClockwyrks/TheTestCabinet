// Arc Foundry — audio/burn: the burn cue sounds on the frame a burn is applied,
// and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.burn` is played when
// "a burn is applied to a unit", and each cue is played "on the update its event
// happens, and at most once on that update".
//
// THE SCENARIO. One Scrap Rectifier and one held Slug inside its stated range of
// `96`. `specs/components.md` makes the Rectifier a "single target, applies burn"
// type whose hit applies a burn of `shotDamage * RECTIFIER_BURN_FRAC` per second,
// so the burn is applied by the game's own systems rather than posed — the cue is
// bound to the event, and driving the real hit is what raises it. The Slug
// survives: a Scrap Rectifier deals `2` and burns for `1` a second against the
// forty health `specs/enemies.md` scales a Slug to on wave one at Medium, so no
// kill lands on the same frame.
//
// WHERE THE LISTENING STARTS. After the shot has been fired, because the frame the
// Rectifier fires carries its own firing cue and the name of a sound is not observable
// from outside an engineless build. Between the shot and its arrival the
// specification names no event, so that stretch must be silent.
//
// WHAT MARKS THE EVENT. `specs/enemies.md` and `specs/instrumentation.md` make an
// applied burn set `burnDps` to `max(burnDps, dps)`, so the frame the unit's
// `burnDps` first rises above `0` is the frame the burn was applied.

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
import { ANCHOR, TARGET, beforeFrame, onFrame, settle } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the burn lands, and not between the shot and the hit", async () => {
  await openYard(h, { wave: 1 });
  await settle(h);
  await standComponent(h, "rectifier", 1, ANCHOR.col, ANCHOR.row);
  const target = await parkUnit(h, "slug", TARGET);

  const burning = await captureReplay(h, "burn", async () => {
    const shot = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(3),
    });
    const cues = watchCues(h);
    const landed = await h.until(
      (s) => s.units.some((u) => u.id === target && u.burnDps > 0),
      { maxFrames: ticks(2) },
    );
    return { fired: shot.hit, landed: landed.hit, frame: h.frame(), cues };
  });

  assertEqual(
    burning.fired,
    true,
    "a Scrap Rectifier with a unit inside its range to fire within three " +
      "seconds (specs/components.md)",
  );
  assertEqual(
    burning.landed,
    true,
    "a Scrap Rectifier's hit to apply its burn to the unit it strikes " +
      "(specs/components.md)",
  );
  assertDeepEqual(
    beforeFrame(burning.cues, burning.frame).map((cue) => cue.frame),
    [],
    "nothing to sound between the shot and its arrival, where the " +
      "specification names no event (specs/ui.md)",
  );
  assertGreaterThan(
    onFrame(burning.cues, burning.frame).length,
    0,
    "a cue to sound on the frame a burn is applied to a unit (specs/ui.md)",
  );
});
