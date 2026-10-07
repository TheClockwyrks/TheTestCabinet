// presentation/enemy-walk-frames — an enemy's sheet frame is
// `floor(age / WALK_FRAME_TIME) mod 4`.
//
// THE REQUIREMENT, AND WHERE EVERY FIGURE COMES FROM. `specs/assets.md` —
// "Animation": "An enemy draws frame `floor(age / WALK_FRAME_TIME) mod 4` of its
// sheet for as long as it lives", with `WALK_FRAME_TIME` (`0.1`) seconds from the
// table above it, and the sheet is the four files
// `assets/sprites/enemies/<id>/0.png` to `3.png`. `TICK_DT` is `1/60`, so the
// frame advances once every six ticks of age and wraps from `3` to `0`.
//
// THE SCENARIO. One moth, its `age` posed to `0.25` through `setEnemyAge`, which
// `specs/instrumentation.md` says "Sets enemy `id`'s `age` to `seconds`" and
// changes nothing else. `floor(0.25 / 0.1) mod 4` is `2`, which is the figure the
// point is named for, and thirty-six ticks are then driven so the frame is read
// through `3` and past the wrap back to `0`: `age` reaches `0.4` on the ninth
// tick driven and `0.85` on the last.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held. The
// moth stands `200` units out with `enemyMotion` off, so it neither moves nor
// reaches the lamplighter, and `specs/instrumentation.md` keeps its clock running
// while the switch is off — "Every enemy holds its position and heading. `age`
// and `contactCooldown` still count" — which is exactly the faculty this point
// exercises and the only one it leaves on. Nothing else is on the field, so the
// only `20 x 20` sprite a frame can draw is the moth's.
//
// WHAT IS READ. Which of the moth's four produced files each frame drew, against
// the frame the reported `age` gives on that same tick. There is no tolerance:
// the frame index is a whole number the specification computes exactly. The one
// allowance is the sheet's own — `specs/assets.md` fixes four files and never
// requires four different pictures, so both sides of the comparison are read as
// the lowest index drawing the same picture, which leaves the cadence, the order
// and the wrap all decided.

import { afterEach, beforeEach, it } from "vitest";
import { ENEMY_WALK_FRAMES, WALK_FRAME_TIME } from "../constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  stagePoint,
  type Harness,
} from "../harness";
import { drawOfNear, enemySheet } from "./readouts";
import { fileClasses, primeSources } from "./sources";

/** Where the moth stands, clear of the lamplighter and inside the view. */
const MOTH_AT = { dx: 200, dy: -100 };

/** The age posed before the first frame is read: `floor(0.25 / 0.1) mod 4` is `2`. */
const POSED_AGE = 0.25;

/** Ticks read: past the wrap from `3` to `0` and on into the second pass. */
const TICKS = 36;

const SHEET = enemySheet("moth");

/** "An enemy draws frame `floor(age / WALK_FRAME_TIME) mod 4` of its sheet". */
function sheetFrame(age: number): number {
  return Math.floor(age / WALK_FRAME_TIME) % ENEMY_WALK_FRAMES;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws frame floor(age / WALK_FRAME_TIME) mod 4 of an enemy's sheet", async () => {
  const posed = await isolate(h);
  await primeSources(h, SHEET);
  const classes = await fileClasses(h, SHEET);
  assertNotEqual(
    classes.join(","),
    Array.from({ length: ENEMY_WALK_FRAMES }, () => 0).join(","),
    "a moth sheet whose four frames are not all one picture, so its walk " +
      "cycle is something a player can see run (specs/assets.md)",
  );

  const at = posed.run.player;
  await h.debug.spawnEnemy("moth", at.x + MOTH_AT.dx, at.y + MOTH_AT.dy);
  const spawned = (await h.snapshot()).run.enemies[0]!;
  await h.debug.setEnemyAge(spawned.id, POSED_AGE);

  const seen: string[] = [];
  const wanted: string[] = [];
  await captureReplay(h, "frames", async () => {
    for (let tick = 1; tick <= TICKS; tick += 1) {
      const snapshot = await h.step(1);
      const moth = mustEnemy(snapshot, spawned.id);
      const found = await drawOfNear(
        h,
        await h.lastCalls(),
        SHEET,
        stagePoint(snapshot, moth.x, moth.y),
        "a frame of the moth's produced sheet",
      );
      seen.push(String(classes[found.index]!));
      wanted.push(String(classes[sheetFrame(moth.age)]!));
    }
  });

  assertEqual(
    seen.join(","),
    wanted.join(","),
    `the sheet frame drawn on each of ${TICKS} ticks from a posed age of ` +
      `${POSED_AGE}, which is floor(age / ${WALK_FRAME_TIME}) mod ` +
      `${ENEMY_WALK_FRAMES} on that tick's own age (specs/assets.md)`,
  );
});
