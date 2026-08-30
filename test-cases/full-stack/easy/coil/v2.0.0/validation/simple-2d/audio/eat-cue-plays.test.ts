// audio/eat-cue-plays — the eat cue sounds once, on the tick the pellet is eaten.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md` names the four cues and the event
// each plays on: `eat` plays when "the snake eats a pellet". It fixes the timing
// and the count in the same paragraph: "each plays on the tick its event
// resolves, at most once on that tick." `specs/movement.md` puts the eat at step
// 4 of the tick the head enters the pellet's cell.
//
// WHAT IS OBSERVED, AND HOW IT IS NAMED. `specs/assets.md` binds each cue to its
// produced file through the engine's cue bus, and the build declares and plays
// each by the name `specs/ui.md` fixes — so the engine announces WHICH cue
// sounded, and `watchCues` reads that name. A build that made some noise of its
// own has not played `eat`, and this reads the difference.
//
// THE CUE SOUNDS WHETHER OR NOT ITS FILE LOADED. This process has no Web Audio
// context, so no produced `.wav` can be decoded through the engine here;
// `specs/assets.md` requires a build that keeps playing when its files do not
// arrive — "a load that fails leaves the game running" — so the cue is still
// asked for and still named. What the file itself holds is
// `audio/eat-file-produced`.
//
// THE THREE THINGS THIS SEPARATES. A build that plays no cue on the eat; a build
// that plays one on every tick, or on the approach; and a build that plays
// several on the one tick. The approach is two ticks of ordinary travel down an
// empty row, so any eat cue sounding there belongs to no event at all.
//
// THE WORLD THIS POSES. A chain, a pellet three cells ahead of it down a clear
// row, and nothing else: the obstacle course cleared, the pellet's respawn
// switched off so the drive holds exactly one eat, and a runway east long enough
// that the trailing ticks never reach the wall.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import { CUES } from "../../src/constants";
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

/** Ticks of ordinary travel before the eat, on which no eat cue may sound. */
const LEAD_TICKS = 2;

/** Ticks driven after the eat, so the clip holds the aftermath as well. */
const TRAIL_TICKS = 6;

/** The pellet, at the cell the head reaches on the tick after the lead. */
const PELLET = ahead(HOME_HEAD, "right", LEAD_TICKS + 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the eat cue once, on the tick the pellet is eaten", async () => {
  arrangeStep(h, {
    head: HOME_HEAD,
    dir: "right",
    length: 4,
    pellet: PELLET,
    pelletRespawn: false,
  });

  // Watched after the world is posed, so what is read is the drive alone.
  const cues = watchCues(h);
  const driven = await captureReplay(h, "eat", async () => {
    await h.tick(LEAD_TICKS);
    const approach = [...cues];
    const lastQuietFrame = h.frame();
    const eaten = await h.tick();
    const atEat = { frame: h.frame(), played: [...cues] };
    await h.tick(TRAIL_TICKS);
    return { approach, lastQuietFrame, eaten, atEat };
  });

  // The drive reached the eat: with the respawn switched off, an eaten pellet
  // leaves the board without one.
  assertNull(driven.eaten.pellet, "the pellet after the tick that ate it");

  assertLength(
    cuesNamed(driven.approach, CUES.eat),
    0,
    `eat cues sounded over the ${LEAD_TICKS} ticks of travel before the eat`,
  );

  const eats = cuesNamed(driven.atEat.played, CUES.eat);
  assertLength(eats, 1, "eat cues sounded by the end of the tick that ate");
  assertGreaterThan(
    eats[0].frame,
    driven.lastQuietFrame,
    "the frame the eat cue sounded on, against the last frame before the eating tick",
  );
  assertLessThanOrEqual(
    eats[0].frame,
    driven.atEat.frame,
    "the frame the eat cue sounded on, against the last frame of the eating tick",
  );
});
