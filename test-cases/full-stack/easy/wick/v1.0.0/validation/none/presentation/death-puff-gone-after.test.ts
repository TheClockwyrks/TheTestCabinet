// presentation/death-puff-gone-after — the puff is gone once `PUFF_TIME` has
// passed, and stays gone.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "Animation": the death puff
// is drawn "frame `floor(t / (PUFF_TIME / 4))` for `t` the seconds of ticks since
// the tick it died, in `[0, PUFF_TIME)`, and is gone after." `PUFF_TIME` is `0.4`
// seconds, which `specs/world.md`'s timer rule makes `round(0.4 x TICK_HZ)`
// (`24`) ticks, so the twenty-fourth tick after the death is the first tick
// outside the half-open span and every tick after it is outside too.
//
// WHY THIS IS ITS OWN POINT. The sibling point reads the twenty-four ticks the
// puff plays over. This one reads the other side of the same half-open span: a
// build whose puff never stops leaves a picture standing where the danger is
// gone, and one that keeps a dead enemy's marker forever fills the field with
// them. The two fail separately, so a grade says which half a build missed.
//
// HOW THE ENEMY IS KILLED, AND WHY THE MOTH STANDS WHERE IT DOES. Exactly as the
// sibling point: Flare at level `1`, due at once, `100` damage over a `640`
// radius against a moth's `5` health, so the kill lands on the firing tick;
// `weaponFire` goes back off after it. The moth stands `300` units out and `150`
// up, inside the view and far beyond `pickupRadius` (`48`), so its gem stays
// where it fell.
//
// WHAT IS READ. Whether ANY of the four produced puff files is drawn at all,
// anywhere on the frame, over the twelve ticks from the twenty-fourth on. Not
// "near the death position": a build that moved its expired puff somewhere else
// has still left it drawn, and the requirement is that it is gone. There is no
// tolerance — a picture is drawn or it is not — beyond the one tick
// `specs/world.md`'s timer rule allows the span itself, which is why the reading
// starts on the tick after the twenty-fourth.

import { afterEach, beforeEach, it } from "vitest";
import { PUFF_TIME, TICK_HZ } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  disable,
  enemyById,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { drawsOf } from "./readouts";
import { primeSources } from "./sources";
import { PUFF_FILES } from "./sheets";

/** Where the moth stands: inside the view, clear of the centre and of attraction. */
const MOTH_AT = { dx: 300, dy: -150 };

/** "`in [0, PUFF_TIME)` ... and is gone after": twenty-four ticks. */
const PUFF_TICKS = Math.round(PUFF_TIME * TICK_HZ);

/** The tick the reading starts on: one past the span, for the timer rule's slack. */
const FIRST_READ = PUFF_TICKS + 1;

/** How many ticks past that are read, so "and stays gone" is decided too. */
const READ_TICKS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no puff from PUFF_TIME after a moth died onward", async () => {
  const posed = await isolate(h);
  await primeSources(h, PUFF_FILES);

  const at = posed.run.player;
  const moth = await placeEnemy(
    h,
    "moth",
    at.x + MOTH_AT.dx,
    at.y + MOTH_AT.dy,
  );
  const firing = await fireWeapon(h, "flare", 1);
  await disable(h, "weaponFire");
  assertEqual(
    enemyById(firing.after, moth.id),
    undefined,
    "the moth to be dead on the tick Flare fired, which is the tick the " +
      "puff's span is counted from (specs/weapons.md)",
  );

  await h.step(FIRST_READ);
  for (let tick = FIRST_READ; tick < FIRST_READ + READ_TICKS; tick += 1) {
    const drawn = await drawsOf(h, await h.lastCalls(), PUFF_FILES);
    assertLength(
      drawn,
      0,
      `draws of the produced puff sheet ${tick} ticks after the death, which ` +
        `is past PUFF_TIME (${PUFF_TIME}s, ${PUFF_TICKS} ticks) and a tick ` +
        "the puff is gone on (specs/assets.md)",
    );
    await h.step(1);
  }
  await captureStill(h, "gone");
});
