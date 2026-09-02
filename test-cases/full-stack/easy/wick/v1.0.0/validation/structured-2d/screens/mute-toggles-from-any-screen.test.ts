// Wick — screens/mute-toggles-from-any-screen: `mute` flips the sound from
// every one of the eight screens.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, Audio: "The game
// binds the `mute` action to `world.audio.setMuted` and toggles it from any
// screen, then mirrors `world.audio.muted()` into `muted` every frame."
// `specs/ui.md`, "Menu navigation", adds "`mute` is read on every screen", and
// `specs/controls.md` gives `mute` to every screen's row and binds it to
// `KeyM`. `specs/instrumentation.md` makes `muted` the game's readable copy of
// the runtime's bit, "refreshed in every frame".
//
// WHAT IS READ. `muted` before and after each press, on each of the eight
// screens in turn: every press must flip it, so the bit alternates down the
// list and a screen that swallows the key is the one whose reading stops
// alternating. Nothing about sound itself is read here; the loops are
// `screens/mute-keeps-loop-looping` and `screens/unmute-returns-loop`.
//
// THE DRIVE. Each screen reached by its own route: `reset` for `title`, the
// debug surface for `howto`, an isolated `playing` world for `playing`, the
// tick that opens each overlay for `levelup` and `chest`, the debug surface
// for `paused`, and the ending rule for `fallen` and `dawn`. Every `playing`
// scenario is isolated with every driver switch off, so nothing changes the
// screen under the press.
//
// THE TOLERANCE. None: a boolean, read before and after.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  endDawn,
  endFallen,
  isolate,
  openChest,
  openLevelUp,
  poseScreen,
  tap,
  type Harness,
  type Screen,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("flips muted on title, howto, playing, levelup, chest, paused, fallen, and dawn", async () => {
  /** Reach each screen, in turn, by the route the specification gives it. */
  const reach: ReadonlyArray<readonly [Screen, () => Promise<void>]> = [
    ["title", async () => h.reset()],
    [
      "howto",
      async () => {
        h.reset();
        poseScreen(h, "howto");
      },
    ],
    ["playing", async () => void isolate(h)],
    [
      "levelup",
      async () => {
        isolate(h);
        await openLevelUp(h, 1);
      },
    ],
    [
      "chest",
      async () => {
        isolate(h);
        await openChest(h);
      },
    ],
    [
      "paused",
      async () => {
        isolate(h);
        poseScreen(h, "paused");
      },
    ],
    [
      "fallen",
      async () => {
        isolate(h);
        await endFallen(h);
      },
    ],
    [
      "dawn",
      async () => {
        isolate(h);
        await endDawn(h);
      },
    ],
  ];

  for (const [screen, arrive] of reach) {
    await arrive();
    const before = h.snapshot();
    assertEqual(before.screen, screen, "the screen the press is made on");

    const after = await tap(h, "KeyM");
    captureStill(h, "muted");

    assertEqual(after.screen, screen, `the screen after KeyM on ${screen}`);
    assertEqual(after.muted, !before.muted, `muted after KeyM on ${screen}`);
  }
});
