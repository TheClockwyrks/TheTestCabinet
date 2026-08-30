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
import { assertEqual } from "../assert";
import {
  MODES,
  MODE_ITEMS,
  SIZE_ITEMS,
  WORLD_SIZES,
  coreDepthMetersFor,
} from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import { drawnCopy } from "./frames";

/**
 * Whether the frame quoted `meters` as a number of its own.
 *
 * A thousands separator is a build's own formatting, so `2,500` and `2 500` read
 * the same as `2500` here; the figure is what specs/world.md fixes.
 */
function quoted(copy: string, meters: number): boolean {
  const plain = copy.replace(/(\d)[,\u00A0\u202F ](?=\d{3}\b)/g, "$1");
  return new RegExp(`\\b${meters}\\b`).test(plain);
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

afterEach(async () => {
  await h.dispose();
});

it("opens the size choice from either mode, quoting all three Core depths", async () => {
  await h.debug.setAutoStep(false);

  for (const mode of MODES) {
    await h.debug.reset();
    await h.debug.setScreen("mode-select");
    await h.debug.setMenuIndex(MODE_INDEX[mode]);
    await h.tap(ACTION_KEY.activate);

    const calls = await h.frameCalls();
    if (mode === "standard") await captureStill(h, "sizes");

    assertEqual(
      (await h.snapshot()).screen,
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
      assertEqual(
        quoted(copy, coreDepthMetersFor(size)),
        true,
        `specs/ui.md: the size choice shows the ${size} Core depth, ${coreDepthMetersFor(size)} m`,
      );
    }
  }
});
