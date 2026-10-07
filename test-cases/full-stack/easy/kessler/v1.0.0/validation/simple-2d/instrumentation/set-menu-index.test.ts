// instrumentation/set-menu-index — the pose moves the menu highlight.
//
// specs/instrumentation.md, `setMenuIndex(n)`: "Sets the highlighted menu entry
// to `n`, a whole number from `0` to the entry count of the current screen's
// menu minus `1`. The highlight moves exactly as `up` and `down` move it, and
// no cue sounds."
//
// THE READ IS THE SNAPSHOT'S `menu.index`, which specs/screens.md fixes as "the
// highlighted entry". Both menu-bearing screens are posed, each over both of
// its entries, because the requirement is the pose reaching the entry it names
// rather than one screen answering.
//
// THE SILENCE IS READ OFF THE CUES THE ENGINE BROADCAST, and what is counted is
// the two cues specs/screens.md gives the menu — `menu-move`, which `up` and
// `down` play, and `menu-select`, which `confirm` plays. A pose is neither, so
// neither may sound. Whatever else the build has running underneath — a bed
// looping on `title`, as specs/assets.md requires — is not this point's
// business.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  cuesNamed,
  onCue,
  openHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses the highlight on every entry of both menus, silently", async () => {
  h.debug.reset();
  const cues = onCue(h);

  for (const [screen, entries] of [
    ["title", TITLE_ITEMS],
    ["paused", PAUSE_ITEMS],
  ] as const) {
    h.debug.setScreen(screen);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      h.debug.setMenuIndex(index);
      const posed = h.snapshot();
      assertEqual(
        posed.menu.index,
        index,
        `${screen}: the highlight after setMenuIndex(${index})`,
      );
    }
  }
  captureStill(h, "posed-highlight");

  assertLength(cuesNamed(cues, "menu-move"), 0, "menu-move over the poses");
  assertLength(cuesNamed(cues, "menu-select"), 0, "menu-select over the poses");
});
