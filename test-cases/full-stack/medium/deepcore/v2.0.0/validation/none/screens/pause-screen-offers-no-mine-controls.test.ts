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
// HOW THE CONTROLS ARE FOUND WITHOUT A LAYOUT. `specs/ui.md` fixes the band the
// bar occupies and nothing else about where its controls sit, so the band is
// swept: first in the mine, where the sweep must find a point that answers, and
// then over the pause menu, where every point of the same sweep must do nothing.
// The first half is the arrangement — it is what makes the second half a reading
// rather than a click into empty space — and the point it found is clicked again
// on the pause screen by itself, so the failure names a control that really is
// there.
//
// ISOLATION. An expedition standing at the camp on an empty mine with the ground
// laid back, the drill held, and nothing in the world that a stray click could
// set off.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H, STAGE_W } from "../constants";
import { assertEqual, assertNotNull, assertNull } from "../assert";
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
import { clickStage, sweepStatusBar } from "../panels/mouse";

/** How far apart the sweep's columns sit, in logical units. */
const SWEEP_STEP = 16;

/** The rows of the status bar the sweep clicks along. */
const SWEEP_ROWS: readonly number[] = [HUD_H / 2, HUD_H / 4, (HUD_H * 3) / 4];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers no click on the status bar while the pause menu is up", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);
  await h.advance(2);
  const resting = await h.snapshot();

  /** Whether any of the bar's three controls has answered. */
  const answered = async (): Promise<boolean> => {
    const s = await h.snapshot();
    return (
      s.panel !== null || s.screen !== "in-mine" || s.muted !== resting.muted
    );
  };

  // The arrangement: a point on the bar that really does answer a click in the
  // mine, found by sweeping the band specs/ui.md gives the bar.
  let live: { x: number; y: number } | null = null;
  for (const y of SWEEP_ROWS) {
    for (let x = SWEEP_STEP / 2; x < STAGE_W && live === null; x += SWEEP_STEP) {
      await h.debug.setPanel(null);
      await h.debug.setScreen("in-mine");
      await clickStage(h, x, y);
      if (await answered()) live = { x, y };
    }
    if (live !== null) break;
  }
  await h.debug.setPanel(null);
  await h.debug.setScreen("in-mine");
  await h.advance(1);

  // The reading: the same band, over the pause menu.
  await h.debug.setScreen("paused");
  await h.advance(2);
  const paused = await h.snapshot();
  await captureStill(h, "inert");

  const found = live;
  let atLive = null as Awaited<ReturnType<Harness["snapshot"]>> | null;
  if (found !== null) {
    await clickStage(h, found.x, found.y);
    atLive = await h.snapshot();
  }

  const stirred = await sweepStatusBar(h, async () => {
    const s = await h.snapshot();
    return (
      s.panel !== null || s.screen !== "paused" || s.muted !== paused.muted
    );
  });

  assertNotNull(
    live,
    "specs/ui.md: a status-bar control the sweep found answering a click in the mine",
  );
  assertEqual(
    atLive?.screen,
    "paused",
    "specs/controls.md: the bar control the mine answered on does not answer over the pause menu",
  );
  assertNull(
    atLive?.panel ?? null,
    "specs/controls.md: and it opens no panel there",
  );
  assertEqual(
    stirred,
    false,
    "specs/controls.md: no point of the status bar answers a click on the pause screen",
  );
  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "paused",
    "the pause menu is still up after the whole sweep",
  );
  assertEqual(
    after.muted,
    paused.muted,
    "specs/controls.md: the mute control did not answer either",
  );
});
