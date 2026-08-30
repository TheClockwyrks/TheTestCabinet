// panels/clicking-a-building-needs-the-miner-at-it — a click reaches only the
// building the miner is standing at.
//
// `specs/controls.md`: "Clicking a surface building activates it, exactly as
// `activate` does while standing at it", and "A control is drawn as operable
// only where it acts. Where the game cannot act on a control in the state it is
// in, that control is drawn disabled or is not drawn at all, and it neither
// highlights under the pointer nor answers a click." `specs/world.md` adds that
// "The miner activates one by standing at it" and that no two footprints
// overlap, so a miner standing at one building is standing at no other.
//
// The positive direction is `panels/clicking-a-building-activates-it`; this is
// the negative one, and it is the direction a build gets wrong by hanging a hit
// area on every building in the camp whatever the miner is doing.
//
// HOW "NOT STANDING AT IT" IS ESTABLISHED WITHOUT A REACH FIGURE. No spec fixes
// how close "standing at" is, so the check never names a distance. Instead it
// stands the miner where `activate` opens ONE named building's panel — which is
// the specification's own definition of standing at that building — and clicks a
// DIFFERENT one from there. The footprints do not overlap, so the miner is not
// standing at the one it clicked, and the click must do nothing.
//
// A building that is off the edge of the viewport is skipped rather than
// clicked, because a point outside the stage is not a click a player could make;
// the count of the ones that were really clicked is asserted at the end, so a
// run that skipped everything fails instead of passing on nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  inViewport,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  standAtBuilding,
  worldToStage,
  type Harness,
} from "../harness";
import { clickStage } from "./mouse";

/** The building the miner stands at while the others are clicked. */
const HOME = "fuel-depot";

/** Frames the clip runs on at the end, so the recording shows the camp. */
const SETTLE = 45;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ignores a click on a building the miner is not standing at", async () => {
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  const boxes = await h.debug.buildings();
  await standAtBuilding(h, HOME);
  await pinMiner(h);
  await h.debug.clearSave();
  await h.advance(2);

  // The specification's own test of standing at a building: `activate` opens it.
  await h.tap(ACTION_KEY.activate);
  const opened = (await h.snapshot()).panel;
  await h.debug.setPanel(null);
  await h.advance(1);

  const run = await captureReplay(h, "ignored", async () => {
    let clicked = 0;
    const answered: string[] = [];
    for (const box of boxes) {
      if (box.id === HOME) continue;
      await h.debug.setPanel(null);
      await h.debug.clearSave();
      await h.advance(1);
      const at = worldToStage(
        await h.snapshot(),
        box.x + box.w / 2,
        box.y + box.h / 2,
      );
      if (!inViewport(at.x, at.y)) continue;
      clicked += 1;
      await clickStage(h, at.x, at.y);
      await h.advance(1);
      const after = await h.snapshot();
      if (after.panel !== null || after.hasSave) answered.push(box.id);
    }
    await h.advance(SETTLE);
    return { clicked, answered, settled: await h.snapshot() };
  });

  assertEqual(
    opened,
    HOME,
    `specs/controls.md: the miner is standing at ${HOME}, so activate opens it`,
  );
  assertGreaterThan(
    run.clicked,
    0,
    "buildings on screen that the miner was not standing at",
  );
  assertEqual(
    run.answered.join(", "),
    "",
    "specs/controls.md: buildings that answered a click the miner was not standing at",
  );
  assertNull(run.settled.panel, "no panel is open at the end of the run");
  assertEqual(
    run.settled.hasSave,
    false,
    "specs/gameplay.md: the Save Pad did not save from across the camp",
  );
});
