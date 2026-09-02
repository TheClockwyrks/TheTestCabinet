// audio/cue-menu-confirm — confirming an item of the title menu or of an end
// screen's menu plays the menu-confirm cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`menu-confirm` |
// `CUES.menuConfirm` | An item of `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS`
// is confirmed", and under the table: "Each is played on the tick its event
// happens, or on the frame for a menu event". specs/ui.md ("Menu navigation")
// repeats it and draws the line: "`menu-confirm` plays when an item of
// `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS` is confirmed; an accepted offer
// plays `choose` alone, and closing the chest overlay plays nothing." So both
// menus below play `menu-confirm` on the frame their `confirm` press lands.
//
// WHY THE ITEMS ARE CONFIRMED WITH A REAL KEY. specs/controls.md binds `confirm`
// to `Enter` and `down` to `ArrowDown`, and the surface carries no operation for
// the keyboard: specs/instrumentation.md hands it to the runtime, where "a
// dispatched keyboard event moves the lamplighter and works the menus exactly as
// a player's key does". Each tap is down, one frame, up, so exactly one frame
// carries each press.
//
// WHY EACH MENU IS REACHED THE WAY IT IS.
//   - THE TITLE. `reset` restores "the `title` screen with `menuIndex`,
//     `almanacTab`, and `almanacScroll` all `0`", and specs/ui.md lists
//     `TITLE_ITEMS` as `LIGHT THE LAMP`, `THE ALMANAC`, `HOW TO PLAY`. One
//     `down` per item above it moves the highlight onto `HOW TO PLAY`, whose
//     confirmation "Sets `screen = howto`" — the item the review point names,
//     and the one that does not begin a run, so the frame carries
//     `menu-confirm` without a run's music starting under it. Each moving frame
//     is a frame of its own and carries `menu-move`, which is
//     `audio/cue-menu-move`'s point.
//   - THE END SCREEN. An isolated night, then `setScreen("fallen")`, which from
//     `playing` "Ends the run exactly as that ending does"
//     (specs/instrumentation.md). specs/ui.md gives it `END_ITEMS` as
//     `TRY AGAIN`, `TITLE` with "`menuIndex` is `0` on arriving", so `confirm`
//     alone takes `TRY AGAIN`, which "starts a fresh run and sets
//     `screen = playing`".
// Each confirmation is asserted off the screen it reached before its cue is read,
// so a build whose menu did nothing reports that rather than a missing cue.
//
// THE TOLERANCE. None: a cue sounded on the frame or it did not, and each frame
// is exact because a tap carries its press on one frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  pressConfirm,
  pressDown,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, SETTLE_FRAMES } from "./cues";

/** Where `HOW TO PLAY` sits in `TITLE_ITEMS`. */
const HOWTO_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays menu-confirm on HOW TO PLAY and on TRY AGAIN", async () => {
  await h.armAudio();
  await h.debug.reset();
  await h.step(SETTLE_FRAMES);

  const cues = await watchNamedCues(h);
  const confirmed = await captureReplay(h, "confirm", async () => {
    let highlighted = await h.snapshot();
    for (let i = 0; i < HOWTO_INDEX; i += 1) highlighted = await pressDown(h);
    const howto = await pressConfirm(h);
    const howtoFrame = h.frame();

    await isolate(h);
    await h.debug.setScreen("fallen");
    const again = await pressConfirm(h);
    const againFrame = h.frame();

    return { highlighted, howto, howtoFrame, again, againFrame };
  });

  assertEqual(
    confirmed.highlighted.menuIndex,
    HOWTO_INDEX,
    "the title highlight the downs moved onto HOW TO PLAY",
  );
  assertEqual(
    confirmed.howto.screen,
    "howto",
    "the screen confirming HOW TO PLAY reached",
  );
  assertHeard(
    cues,
    confirmed.howtoFrame,
    "menu-confirm",
    "the menu-confirm cues on the frame HOW TO PLAY was confirmed",
  );

  assertEqual(
    confirmed.again.screen,
    "playing",
    "the screen confirming TRY AGAIN reached",
  );
  assertHeard(
    cues,
    confirmed.againFrame,
    "menu-confirm",
    "the menu-confirm cues on the frame TRY AGAIN was confirmed",
  );
});
