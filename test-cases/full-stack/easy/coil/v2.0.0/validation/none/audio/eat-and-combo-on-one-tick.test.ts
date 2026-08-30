// audio/eat-and-combo-on-one-tick — a tick that eats and raises the multiplier
// plays both cues, once each.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md` states this case by name: "each
// plays on the tick its event resolves, at most once on that tick. A tick that
// both eats a pellet and raises the multiplier plays `eat` and `combo-up` once
// each." `specs/scoring.md` makes that tick the ordinary one: an eat inside an
// open window resolves the multiplier one higher and then awards the points, so
// eating and rising are two events of one tick rather than two ticks.
// `specs/assets.md` says what the pair is for: "`combo-up` is brighter and higher
// than `eat`, so a player hears the multiplier rise on a tick that also plays
// `eat`."
//
// WHY THIS IS ITS OWN POINT. `audio/eat-cue-plays` and
// `audio/combo-up-cue-plays` each decide one cue on its own event. This decides
// the coincidence: a build that plays one cue per tick, or that lets the rise
// swallow the eat, passes both of those and fails this.
//
// THE WORLD THIS POSES. A chain with the pellet one cell ahead, an open combo
// window, and the multiplier already RAISED to `2` — the manifest's "an open
// window at a raised multiplier" — so the tick takes it to `3` and the rise is a
// rise from a live combo rather than the first one of a round. The window is
// posed open outright rather than reached by eating a first pellet, because a
// drive holding two eats could not say which tick a cue belonged to. The pellet's
// respawn is switched off and the obstacle course is cleared, so the drive holds
// exactly one eat and nothing else.
//
// Audio is armed with a real key press first, because a browser opens no audio
// context without a gesture; `UNBOUND_KEY` is bound to no action, so arming
// disturbs no game state.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { COMBO_WINDOW, CUES } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  cuesNamed,
  HOME_HEAD,
  watchCues,
  type Harness,
} from "../harness";

/** The multiplier the round is posed at, so the eat raises a live combo. */
const COMBO = 2;

/** Ticks driven after the eat, so the clip holds the aftermath as well. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the eat cue once and the combo cue once on the same tick", async () => {
  await h.armAudio();
  await arrangeEat(h, {
    head: HOME_HEAD,
    dir: "right",
    length: 4,
    combo: COMBO,
    comboWindow: COMBO_WINDOW,
  });

  const cues = watchCues(h);
  const driven = await captureReplay(h, "both", async () => {
    const eaten = await h.tick();
    const played = [...cues];
    await h.tick(TRAIL_TICKS);
    return { eaten, played };
  });

  // The drive reached both events on the one tick: the pellet is gone, and the
  // multiplier went one higher than it was posed at.
  assertNull(driven.eaten.pellet, "the pellet after the tick that ate it");
  assertEqual(
    driven.eaten.combo,
    COMBO + 1,
    "the multiplier after the tick that ate inside an open window",
  );

  assertLength(
    cuesNamed(driven.played, CUES.eat),
    1,
    "eat cues sounded on the tick that ate and raised the multiplier",
  );
  assertLength(
    cuesNamed(driven.played, CUES.comboUp),
    1,
    "combo cues sounded on the tick that ate and raised the multiplier",
  );
});
