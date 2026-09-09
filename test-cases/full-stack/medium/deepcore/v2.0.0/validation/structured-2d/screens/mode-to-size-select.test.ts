// screens/mode-to-size-select — choosing a mode opens the size choice, which
// quotes each size's Core depth.
//
// specs/ui.md: on `mode-select`, "a mode goes to `size-select`", and
// "`size-select` shows each size's Core depth in meters before it is chosen".
// specs/world.md fixes those depths exactly: 1250 m at Quick, 2500 m at Standard
// and 5000 m at Marathon, which is `coreRow * METERS_PER_ROW` at each size.
//
// SO THE COPY HERE IS NOT FREE. The three depths are figures the specification
// states, so the frame is read for each of them as a number, however the build
// words the rest of the screen. The four entries of `SIZE_ITEMS` are read the
// same way.
//
// BOTH MODES, because the requirement is that CHOOSING A MODE opens the size
// choice, and a build that wired only one of the two entries through would pass a
// check that took either one alone.
//
// ISOLATION. The mode choice reached directly through the surface rather than
// through the title, because a build with a broken title and a working mode
// choice must pass this and fail that one.

import { afterEach, beforeEach, it } from "vitest";
import {
  METERS_PER_ROW,
  MODES,
  MODE_ITEMS,
  SIZE_ITEMS,
  WORLD_SIZES,
} from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  coreRowFor,
  createHarness,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { drawnCopy } from "./frames";

/**
 * Whether the frame quoted `meters` as a number of its own.
 *
 * A thousands separator is a build's own formatting, so `2,500` and `2 500` read
 * the same as `2500` here; the figure is what specs/world.md fixes.
 *
 * Leading zeros are not part of that boundary. The specification fixes the
 * figure and leaves how it is written to the build, so a readout padded to a
 * fixed width — `000050`, the odometer idiom `padStart` produces — is the
 * figure 50 as surely as `50` is. Any run of zeros standing directly before
 * the figure is absorbed into it, while a non-zero digit there still ends the
 * reading: `000050` shows 50, `150` and `504` do not. A zero run that is
 * itself a group of a larger grouped figure is not padding: `1,050` shows
 * 1050, not 50. That guard falls on the zeros alone, so a figure standing
 * after a separator with no padding before it, the `7` of a `10,7` pair,
 * reads as it did without the padding allowance.
 */
function quoted(copy: string, meters: number): boolean {
  const plain = copy.replace(/(\d)[,\u00A0\u202F ](?=\d{3}\b)/g, "$1");
  return new RegExp(`\\b(?:(?<!\\d[,\\u00A0\\u202F ])0+)?${meters}\\b`).test(
    plain,
  );
}

/** Where each mode sits on `MODE_ITEMS`. */
const MODE_INDEX = {
  standard: MODE_ITEMS.indexOf("STANDARD"),
  hardcore: MODE_ITEMS.indexOf("HARDCORE"),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the size choice from either mode, quoting all three Core depths", async () => {
  for (const mode of MODES) {
    h.debug.reset();
    h.debug.setScreen("mode-select");
    h.debug.setMenuIndex(MODE_INDEX[mode]);
    await h.tap(ACTION_KEY.activate);

    const calls = await h.frameCalls();
    if (mode === "standard") captureStill(h, "sizes");

    assertEqual(
      h.snapshot().screen,
      "size-select",
      `specs/ui.md: choosing ${mode.toUpperCase()} goes to size-select`,
    );
    for (const item of SIZE_ITEMS) {
      assertEqual(
        drewText(calls, item),
        true,
        `specs/ui.md: the size choice draws ${item}`,
      );
    }
    const copy = drawnCopy(calls);
    for (const size of WORLD_SIZES) {
      const meters = coreRowFor(size) * METERS_PER_ROW;
      assertEqual(
        quoted(copy, meters),
        true,
        `specs/ui.md: the size choice shows the ${size} Core depth, ${meters} m`,
      );
    }
  }
});
