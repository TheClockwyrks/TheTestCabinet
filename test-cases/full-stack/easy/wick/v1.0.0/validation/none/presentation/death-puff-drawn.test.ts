// presentation/death-puff-drawn — a death puff plays once, from the tick an enemy
// died, over the place it died at.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "Animation": "The death
// puff is drawn centered on the position an enemy died at, frame
// `floor(t / (PUFF_TIME / 4))` for `t` the seconds of ticks since the tick it
// died, in `[0, PUFF_TIME)`, and is gone after. It is a picture, and it damages
// nothing." `PUFF_TIME` is `0.4` from the table above it and the sheet is the
// four files `assets/sprites/puff/0.png` to `3.png` on a `24 x 24` canvas, so a
// frame is shown for `0.1` seconds — six ticks — and the four run over
// twenty-four.
//
// HOW THE ENEMY IS KILLED, AND WHY THAT WAY. Flare, held at level `1` and due at
// once: "On firing, every enemy within `radius` of the player's center takes
// `damage` on that tick" (`specs/weapons.md`), at `100` damage over a `640`
// radius against a moth's `5` health, so the kill lands on the firing tick and
// nothing about the reading depends on how much of the tick's damage arrived.
// `weaponFire` goes back off immediately after, so Flare's one firing is all the
// night does.
//
// WHY THE MOTH STANDS WHERE IT DOES. `300` units out and `150` up: inside the
// view, far clear of the lamplighter's own sprite at the stage centre, and far
// beyond `pickupRadius` (`48` with no Lure held), so the gem it drops on the
// same tick stays where it fell instead of flying through the puff.
//
// WHAT IS READ. Which of the four produced puff files each frame drew, and where
// it landed. The centre is the position the moth died at, mapped through the
// camera; there is no tolerance on the frame index, which the specification
// computes exactly, and `BLIT_TOL` on the centre, one unit, which is a build
// rounding a fractional world position to the pixel grid.
//
// THE ONE ALLOWANCE. Two ticks either side of a boundary the floor puts a frame
// at, as `./sheets` states with its reason: `t` is a tick count in seconds, and a
// build that accumulates it and one that divides it disagree in the last bits of
// a float. The order and the cadence are still decided.

import { afterEach, beforeEach, it } from "vitest";
import { PUFF_TIME, TICK_HZ } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  disable,
  enemyById,
  fireWeapon,
  isolate,
  placeEnemy,
  stagePoint,
  type Harness,
} from "../harness";
import { drawOfNear } from "./readouts";
import { fileClasses, primeSources } from "./sources";
import { frameAllowed, PUFF_FILES, PUFF_PLAY } from "./sheets";

/** Where the moth stands: inside the view, clear of the centre and of attraction. */
const MOTH_AT = { dx: 300, dy: -150 };

/** "in `[0, PUFF_TIME)`": twenty-four ticks, the tick of the death included. */
const TICKS = Math.round(PUFF_TIME * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the puff sheet once over the place a moth died", async () => {
  const posed = await isolate(h);
  await primeSources(h, PUFF_FILES);
  const classes = await fileClasses(h, PUFF_FILES);

  const at = posed.run.player;
  const moth = await placeEnemy(
    h,
    "moth",
    at.x + MOTH_AT.dx,
    at.y + MOTH_AT.dy,
  );

  await captureReplay(h, "puff", async () => {
    const firing = await fireWeapon(h, "flare", 1);
    await disable(h, "weaponFire");
    assertEqual(
      enemyById(firing.after, moth.id),
      undefined,
      "the moth to be dead on the tick Flare fired, which is the tick the " +
        "puff is drawn from (specs/weapons.md)",
    );

    for (let tick = 0; tick < TICKS; tick += 1) {
      const snapshot = tick === 0 ? firing.after : await h.step(1);
      const found = await drawOfNear(
        h,
        await h.lastCalls(),
        PUFF_FILES,
        stagePoint(snapshot, moth.x, moth.y),
        "a frame of the produced death puff sheet, centred on the position " +
          "the moth died at",
      );
      assertTrue(
        frameAllowed(PUFF_PLAY, classes, tick, found.index),
        `the puff frame drawn ${tick} tick(s) after the death, which is ` +
          `floor(t / ${PUFF_TIME / PUFF_FILES.length}) for t the seconds ` +
          `since (specs/assets.md); frame ${found.index} was drawn`,
      );
    }
  });
});
