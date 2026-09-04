// instrumentation/snapshot-fixed-shape — the snapshot carries every documented
// field on each of the six screens.
//
// specs/instrumentation.md, "Snapshot shape": "The shape is fixed and every
// field is present on every screen ... `rings` always holds three entries,
// ring 1 first ... `paddle.angleDeg` and every ring's `angleDeg` are
// normalized into `[0, 360)`", and the `menu` field is "the highlighted item,
// 0 on a screen with no menu". specs/screens.md names the six screens the
// `screen` field takes.
//
// Each screen is entered from a fresh boot through `setScreen` alone, so a
// build whose menus cannot be walked still answers for its snapshot shape, and
// a broken shape on one screen names that screen. Whether a value is RIGHT on
// a given screen belongs to other points; what this one decides is that every
// field is there, typed as documented, with the angles in range and the menu
// index at rest where no menu exists.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThan,
} from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { MENU_FREE_SCREENS, SIX_SCREENS } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the whole documented shape on every screen", async () => {
  for (const screen of SIX_SCREENS) {
    h.reset();
    if (screen !== "title") h.debug.setScreen(screen);
    const s = h.snapshot();

    assertEqual(s.screen, screen, `the ${screen} screen, entered`);
    assertEqual(typeof s.ticks, "number", `ticks on ${screen}`);
    assertEqual(typeof s.wave, "number", `wave on ${screen}`);
    assertEqual(typeof s.score, "number", `score on ${screen}`);
    assertEqual(typeof s.lives, "number", `lives on ${screen}`);
    assertEqual(typeof s.seed, "number", `seed on ${screen}`);
    assertEqual(
      typeof s.interstitialTicks,
      "number",
      `interstitialTicks on ${screen}`,
    );
    assertEqual(typeof s.waveAdvance, "boolean", `waveAdvance on ${screen}`);
    assertEqual(typeof s.podSpawn, "boolean", `podSpawn on ${screen}`);
    assertEqual(Array.isArray(s.balls), true, `balls on ${screen}`);
    assertEqual(Array.isArray(s.pods), true, `pods on ${screen}`);
    assertLength(s.rings, 3, `rings on ${screen}: always three entries`);
    assertEqual(
      typeof s.paddle.spanDeg,
      "number",
      `paddle.spanDeg on ${screen}`,
    );
    assertEqual(
      typeof s.effects.widenTicks,
      "number",
      `effects.widenTicks on ${screen}`,
    );
    assertEqual(
      typeof s.effects.narrowTicks,
      "number",
      `effects.narrowTicks on ${screen}`,
    );
    assertEqual(
      typeof s.effects.pierceTicks,
      "number",
      `effects.pierceTicks on ${screen}`,
    );
    assertEqual(
      typeof s.effects.shieldActive,
      "boolean",
      `effects.shieldActive on ${screen}`,
    );

    // The angles, normalized into [0, 360).
    for (const [name, angle] of [
      ["paddle.angleDeg", s.paddle.angleDeg],
      ["rings[0].angleDeg", s.rings[0].angleDeg],
      ["rings[1].angleDeg", s.rings[1].angleDeg],
      ["rings[2].angleDeg", s.rings[2].angleDeg],
    ] as const) {
      assertGreaterThanOrEqual(angle, 0, `${name} on ${screen}, in [0, 360)`);
      assertLessThan(angle, 360, `${name} on ${screen}, in [0, 360)`);
    }

    // The menu index: a number everywhere, and at rest where no menu exists.
    assertEqual(typeof s.menu.index, "number", `menu.index on ${screen}`);
    if (MENU_FREE_SCREENS.includes(screen)) {
      assertEqual(
        s.menu.index,
        0,
        `menu.index resting at 0 on ${screen}, a screen with no menu`,
      );
    }
  }

  // The frame the last screen of the sweep drew, as the item's evidence.
  await h.tick(1);
  captureStill(h, "screens");
});
