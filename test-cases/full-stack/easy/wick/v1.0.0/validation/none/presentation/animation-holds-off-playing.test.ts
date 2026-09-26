// presentation/animation-holds-off-playing — every animation holds still on a
// screen that does not tick.
//
// THE REQUIREMENT. `specs/assets.md` — "Animation": "Every animation of the
// world runs on ticks, so the world holds still on every screen but
// `playing`." `specs/ui.md` says the same from the screen's side: on
// `levelup`, `chest` and `paused` "Nothing" advances, and "The world beneath
// holds exactly the tick it was at." The one animation that sentence carves
// out — the almanac's entry picture, which runs on `simTime` — is not read
// here: this point reads the lamplighter and an enemy of the WORLD, on
// `paused`.
//
// THE SCENARIO, AND WHY IT IS POSED THIS WAY. Both animations the requirement
// names have to be MID-CYCLE when the pause lands, or the point passes on a build
// that simply redraws the same first frame forever. So the lamplighter is walked
// for three ticks with `right` held, which `specs/world.md` makes a tick with a
// non-zero movement direction, and a moth is given an `age` of `0.25`, which
// `specs/assets.md` puts on sheet frame `2`. The pause is then entered through
// `setScreen("paused")`, which `specs/instrumentation.md` defines as setting
// `screen` and nothing else.
//
// WHAT IS READ. Which produced file each of the two was drawn from, on the last
// `playing` frame and then on each of sixty `paused` frames. Both halves are the
// point: the frame the pause lands on must be the one the last tick left, and no
// frame of the pause may move it on.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, so
// the moth neither moves nor is despawned and nothing else is on the field; the
// key is released before the pause, so a build that reads held keys on `paused`
// is not being asked to do anything with them. There is no tolerance: a drawn
// frame index is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  stagePoint,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { drawOfNear, enemySheet } from "./readouts";
import { primeSources } from "./sources";
import { LAMPLIGHTER_FILES, postureName, postureOf } from "./walk";

/** Where the moth stands, and the age that puts it mid-cycle. */
const MOTH_AT = { dx: 200, dy: -100 };
const MOTH_AGE = 0.25;

/** Ticks of held movement before the pause, so the walk cycle is running. */
const WALKED = 3;

/** Frames of `paused` the reading is taken over. */
const PAUSED_FRAMES = 60;

const SHEET = enemySheet("moth");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every drawn frame still across sixty frames of paused", async () => {
  const posed = await isolate(h);
  await primeSources(h, [...LAMPLIGHTER_FILES, ...SHEET]);

  const at = posed.run.player;
  await h.debug.spawnEnemy("moth", at.x + MOTH_AT.dx, at.y + MOTH_AT.dy);
  const spawned = (await h.snapshot()).run.enemies[0]!;
  await h.debug.setEnemyAge(spawned.id, MOTH_AGE);

  await h.hold("ArrowRight");
  const walking = await h.step(WALKED);
  await h.release("ArrowRight");

  const readEnemyFrame = async (snapshot: WickSnapshot): Promise<number> => {
    const moth = mustEnemy(snapshot, spawned.id);
    const found = await drawOfNear(
      h,
      await h.lastCalls(),
      SHEET,
      stagePoint(snapshot, moth.x, moth.y),
      "a frame of the moth's produced sheet",
    );
    return found.index;
  };

  const lastPlaying = await postureOf(h, await h.lastCalls());
  const lastEnemyFrame = await readEnemyFrame(walking);

  await h.debug.setScreen("paused");
  for (let frame = 1; frame <= PAUSED_FRAMES; frame += 1) {
    const snapshot = await h.step(1);
    assertEqual(
      snapshot.screen,
      "paused",
      `the screen on paused frame ${frame}, which nothing here leaves ` +
        "(specs/ui.md)",
    );
    const posture = await postureOf(h, await h.lastCalls());
    assertEqual(
      postureName(posture),
      postureName(lastPlaying),
      `the lamplighter's drawn frame on paused frame ${frame}, which is the ` +
        "one the last playing tick left (specs/assets.md)",
    );
    assertEqual(
      await readEnemyFrame(snapshot),
      lastEnemyFrame,
      `the moth's drawn sheet frame on paused frame ${frame}, which is the ` +
        "one the last playing tick left (specs/assets.md)",
    );
  }
  await captureStill(h, "held");
});
