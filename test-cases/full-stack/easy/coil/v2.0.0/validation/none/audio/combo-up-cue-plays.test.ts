// audio/combo-up-cue-plays — the combo cue sounds once, on the tick the
// multiplier rises.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md` names the event: `combo-up` plays
// when "the combo multiplier rises", and "each plays on the tick its event
// resolves, at most once on that tick". `specs/scoring.md` fixes when that
// happens: "an eaten pellet resolves the multiplier before it awards the
// points", and a window that is open at the eat takes `M` "one higher, up to
// `COMBO_MAX`".
//
// THE WORLD THIS POSES, AND WHY THE WINDOW IS POSED OPEN. A rise needs an eat
// INSIDE an open window, so the window is posed open outright through
// `setComboWindow` rather than reached by eating a first pellet — a scenario that
// ate twice would put two eats in the drive and could not say which tick a cue
// belonged to. The multiplier is left at its opening `1`, so the eat takes it to
// `2`: the smallest rise there is, and the one every build must make.
//
// THE APPROACH. Two ticks of ordinary travel down a clear row before the eat, on
// which no combo cue may sound. Step 6 of each of them draws `TICK_SECONDS` off
// the window, which leaves it open with over three seconds to spare, so the eat
// still meets an open window.
//
// WHAT IS OBSERVED. The sound itself, named from the file it came from —
// `specs/assets.md` fixes `assets/audio/combo-up.wav` as this cue's file, and
// `audio-init.js` carries that name from the fetch through the decode to the
// source that plays it. So this separates a build that plays the wrong cue on the
// rise from one that plays the right one, which counting sounds could not.
//
// Audio is armed with a real key press first, because a browser opens no audio
// context without a gesture; `UNBOUND_KEY` is bound to no action, so arming
// disturbs no game state.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import { COMBO_WINDOW, CUES } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  cuesNamed,
  HOME_HEAD,
  watchCues,
  type Harness,
} from "../harness";

/** Ticks of ordinary travel before the eat, on which no combo cue may sound. */
const LEAD_TICKS = 2;

/** Ticks driven after the rise, so the clip holds the aftermath as well. */
const TRAIL_TICKS = 6;

/** The pellet, at the cell the head reaches on the tick after the lead. */
const PELLET = ahead(HOME_HEAD, "right", LEAD_TICKS + 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the combo cue once, on the tick the multiplier rises", async () => {
  await h.armAudio();
  await arrangeStep(h, {
    head: HOME_HEAD,
    dir: "right",
    length: 4,
    pellet: PELLET,
    pelletRespawn: false,
    combo: 1,
    comboWindow: COMBO_WINDOW,
  });

  const cues = watchCues(h);
  const driven = await captureReplay(h, "combo", async () => {
    await h.tick(LEAD_TICKS);
    const approach = [...cues];
    const lastQuietFrame = h.frame();
    const eaten = await h.tick();
    const atRise = { frame: h.frame(), played: [...cues] };
    await h.tick(TRAIL_TICKS);
    return { approach, lastQuietFrame, eaten, atRise };
  });

  // The drive reached the rise: the eat met an open window, so the multiplier
  // went one higher than the `1` it was posed at.
  assertEqual(
    driven.eaten.combo,
    2,
    "the multiplier after the tick that ate inside an open window",
  );

  assertLength(
    cuesNamed(driven.approach, CUES.comboUp),
    0,
    `combo cues sounded over the ${LEAD_TICKS} ticks of travel before the rise`,
  );

  const rises = cuesNamed(driven.atRise.played, CUES.comboUp);
  assertLength(
    rises,
    1,
    "combo cues sounded by the end of the tick the multiplier rose on",
  );
  assertGreaterThan(
    rises[0].frame,
    driven.lastQuietFrame,
    "the frame the combo cue sounded on, against the last frame before the rising tick",
  );
  assertLessThanOrEqual(
    rises[0].frame,
    driven.atRise.frame,
    "the frame the combo cue sounded on, against the last frame of the rising tick",
  );
});
