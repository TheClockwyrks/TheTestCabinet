// screens/pause-screen-offers-no-mine-controls — the pause screen carries its own
// menu and nothing of the mine's.
//
// `specs/ui.md` pins the status bar to the mine: it "occupies `y` in `[0, HUD_H]`
// and is always fully visible while `in-mine`", and it lists "the inventory,
// pause, and mute controls" among what it shows. `specs/controls.md` then fixes
// what becomes of a control the game cannot act on: "A control is drawn as
// operable only where it acts. Where the game cannot act on a control in the
// state it is in, that control is drawn disabled or is not drawn at all, and it
// neither highlights under the pointer nor answers a click."
//
// The pause screen's own controls are `PAUSE_ITEMS`, and the mine's belong to the
// mine. A build that leaves the bar's buttons live over the pause menu offers a
// player a bag that opens nothing and a pause button on the pause screen.
//
// HOW THE CONTROLS ARE FOUND WITHOUT A LAYOUT. The build reports it.
// `specs/instrumentation.md`'s `controlRect(control, null)` gives the region a
// pointer drives each of the three from, so the regions are READ while the mine
// is up — a reading, not a click, so nothing of the mine's own behavior is on the
// line here — and then the pause menu is raised and each of those points is
// clicked. A build that also reports a region for one of the three ON the pause
// screen has that region clicked as well, so a bar laid out differently there is
// covered too.
//
// ISOLATION. An expedition standing at the camp on an empty mine with the ground
// laid back, the miner and the drill both held, and nothing in the world that a
// stray click could set off.

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
  type Harness,
} from "../harness";
import type { ControlName } from "../surface";
import { centerOf, clickStage, controlRegion } from "../panels/mouse";

/** The three the status bar carries, by the names specs/ui.md gives them. */
const BAR: readonly ControlName[] = ["inventory", "pause", "mute"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("answers no click on the status bar while the pause menu is up", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinMiner(h);
  pinDrill(h);
  await h.advance(2);

  // Where the build put each of the three while the mine is up. Read only.
  const points = BAR.map((control) => ({
    control,
    at: centerOf(controlRegion(h, control)),
  }));

  h.debug.setScreen("paused");
  await h.advance(2);
  const paused = h.snapshot();
  captureStill(h, "inert");

  /** Whether anything the bar could have done has happened. */
  const answered = (): boolean => {
    const s = h.snapshot();
    return (
      s.panel !== null || s.screen !== "paused" || s.muted !== paused.muted
    );
  };

  const stirred: string[] = [];
  for (const point of points) {
    await clickStage(h, point.at.x, point.at.y);
    await h.advance(1);
    if (answered()) stirred.push(point.control);

    // And wherever the build reports that control ON the pause screen, if it
    // reports one there at all: a bar drawn disabled still has a region.
    const here = h.debug.controlRect(point.control, null);
    if (here !== null) {
      const at = centerOf(here);
      await clickStage(h, at.x, at.y);
      await h.advance(1);
      if (answered() && !stirred.includes(point.control)) {
        stirred.push(point.control);
      }
    }
  }

  assertEqual(
    stirred.join(", "),
    "",
    "specs/controls.md: status-bar controls that answered a click on the pause screen",
  );
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the pause menu is still up after every point was clicked",
  );
  assertEqual(
    h.snapshot().panel,
    null,
    "specs/controls.md: and no panel was opened from it",
  );
  assertEqual(
    h.snapshot().muted,
    paused.muted,
    "specs/controls.md: the mute control did not answer either",
  );
});
