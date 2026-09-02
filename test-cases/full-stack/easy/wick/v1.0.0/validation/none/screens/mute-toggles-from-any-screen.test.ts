// screens/mute-toggles-from-any-screen — `mute` flips the mute bit on every one
// of the nine screens.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "The game binds the
// `mute` action to the runtime's mute bit and toggles it from any screen, then
// mirrors that bit into `muted` every frame." specs/controls.md ("Actions and
// bindings"): "`mute` | `KeyM` | edge | toggles sound, on every screen", and
// every row of ("What each screen reads") ends with `mute`. specs/ui.md ("Menu
// navigation") says it once more: "`mute` is read on every screen." The nine
// screens are `SCREENS`, the `Screen` values specs/ui.md tabulates.
//
// WHY THE WORLD IS POSED AS IT IS. All nine screens are visited in one drive,
// each reached by the transition that reaches it — `howto` posed as confirming
// `HOW TO PLAY` does, `almanac` posed as confirming `THE ALMANAC` does,
// `playing` as a fresh run, `levelup` by a queued level-up, `chest` by a
// collected chest, `paused` by `KeyP`, and the two endings by the ticks that end
// a run — and `KeyM` is pressed once on each. Each press is read against the
// reading taken immediately before it rather than against a fixed value, because
// a toggle's answer is a flip: a build that answered on eight screens fails on
// the ninth by name. The night is isolated before the run
// screens, so nothing spawns into a tick and no gain opens an overlay this
// drive did not queue. Every press is a REAL `KeyM` through Chromium's input
// pipeline held across exactly one frame, which is the frame that mirrors the
// bit.
//
// THE TOLERANCE. None: a boolean is an exact comparison, and the screens
// visited are compared against the nine the specification names, so a drive
// that skipped one fails rather than passing on eight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCREENS, type ScreenName } from "../constants";
import {
  captureStill,
  createHarness,
  openChest,
  poseScreen,
  pressBack,
  pressConfirm,
  pressMute,
  pressPause,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { endDawn, endFallen, night, openOffers } from "./stage";

/** Three candidates of an empty loadout's pool. */
const OFFERS = ["ember", "pin", "wick"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips muted on each of the nine screens", async () => {
  const visited: ScreenName[] = [];

  /** Press KeyM on the screen `standing` reports, and record that it was visited. */
  const mute = async (
    standing: WickSnapshot,
    screen: ScreenName,
  ): Promise<WickSnapshot> => {
    assertEqual(standing.screen, screen, `the screen KeyM is pressed on`);
    const after = await pressMute(h);
    assertEqual(after.screen, screen, `the screen after KeyM on ${screen}`);
    assertEqual(after.muted, !standing.muted, `muted after KeyM on ${screen}`);
    visited.push(screen);
    return after;
  };

  await mute(await h.snapshot(), "title");
  await mute(await poseScreen(h, "howto"), "howto");
  await mute(await poseScreen(h, "almanac"), "almanac");

  await mute(await night(h), "playing");
  await mute(await openOffers(h, OFFERS, 1), "levelup");
  await pressConfirm(h);
  await mute(await openChest(h), "chest");
  await poseScreen(h, "playing");

  await mute(await pressPause(h), "paused");
  await pressPause(h);
  await mute(await endFallen(h), "fallen");

  await pressBack(h);
  await poseScreen(h, "playing");
  await mute(await endDawn(h), "dawn");
  await captureStill(h, "muted");

  assertEqual(
    [...visited].sort().join(","),
    [...SCREENS].sort().join(","),
    "the screens KeyM was pressed on",
  );
});
