// screens/pause-screen-offers-no-mine-controls — the pause screen carries its own
// menu and nothing of the mine's.
//
// `specs/ui.md` pins the status bar to the mine: it "occupies `y` in `[0, HUD_H]`
// and is always fully visible while `in-mine`", and it lists "the inventory,
// pause, and mute controls" among what it shows. `specs/controls.md` then fixes
// what becomes of a control the game cannot act on: "A control is drawn as
// operable only where it acts. Where the game cannot act on a control in the
// state it is in, that control is drawn disabled or is not drawn at all, and it
// neither highlights under the pointer nor answers a press."
//
// The pause screen's own controls are `PAUSE_ITEMS`, and the mine's belong to the
// mine. A build that leaves the bar's buttons live over the pause menu offers a
// player a bag that opens nothing and a pause button on the pause screen.
//
// HOW THE CONTROLS ARE FOUND WITHOUT A LAYOUT. `specs/overview.md` hands the
// layout to the build and `specs/instrumentation.md` has the build report it, so
// each of the three is asked for by name through `controlRect`. In the mine every
// one of them must report a region and the bar must be live, which is the
// arrangement — it is what makes the second half a reading rather than a press
// into empty space. On the pause screen each is read again: a control the build
// no longer draws reports `null`, which is one of the two conformant answers, and
// a control it still draws is pressed where it drew it and must do nothing.
//
// ISOLATION. An expedition standing at the camp on an empty mine with the ground
// laid back, the drill held, and nothing in the world that a stray press could
// set off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type ControlName,
  type Harness,
} from "../harness";
import { clickRegion, controlRegion } from "../panels/mouse";

/** The three controls `specs/ui.md` puts on the status bar. */
const BAR_CONTROLS: readonly ControlName[] = ["inventory", "pause", "mute"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers no press on the status bar while the pause menu is up", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);
  await h.advance(2);

  // The arrangement: every bar control reports a region in the mine, and the bar
  // is live there — the inventory control opens the inventory, which is the one
  // of the three whose effect is a field nothing else in this scene touches.
  const inMine: Record<string, boolean> = {};
  for (const control of BAR_CONTROLS) {
    inMine[control] = (await h.debug.controlRect(control, null)) !== null;
  }
  await clickRegion(h, await controlRegion(h, "inventory"));
  const live = (await h.snapshot()).panel;

  await h.debug.setPanel(null);
  await h.debug.setScreen("in-mine");
  await h.advance(1);

  // The reading: the same three, over the pause menu.
  await h.debug.setScreen("paused");
  await h.advance(2);
  const paused = await h.snapshot();
  await captureStill(h, "inert");

  /** Whether pressing `control` on the pause screen stirred anything. */
  const stirred: Record<string, boolean> = {};
  for (const control of BAR_CONTROLS) {
    const rect = await h.debug.controlRect(control, null);
    if (rect === null) {
      // Not drawn at all, which `specs/controls.md` names as one of the two
      // conformant answers. There is nothing to press.
      stirred[control] = false;
      continue;
    }
    await clickRegion(h, rect);
    const after = await h.snapshot();
    stirred[control] =
      after.screen !== "paused" ||
      after.panel !== null ||
      after.muted !== paused.muted;
    // Put the screen back, so one control that did answer cannot decide the
    // reading the next one takes.
    await h.debug.setPanel(null);
    await h.debug.setScreen("paused");
    await h.debug.setMuted(paused.muted);
    await h.advance(1);
  }

  for (const control of BAR_CONTROLS) {
    assertEqual(
      inMine[control],
      true,
      `specs/ui.md: the status bar draws its ${control} control while in-mine, ` +
        `and specs/instrumentation.md has controlRect report where`,
    );
  }
  assertEqual(
    live,
    "inventory",
    "specs/ui.md: the bar's inventory control opens the inventory in the mine",
  );
  for (const control of BAR_CONTROLS) {
    assertEqual(
      stirred[control],
      false,
      `specs/controls.md: the bar's ${control} control answers no press over ` +
        `the pause menu`,
    );
  }
  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "paused",
    "the pause menu is still up after every press",
  );
});
