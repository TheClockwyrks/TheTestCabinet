// hud/next-wave-preview — with nothing selected and nothing hovered, a build
// phase draws the coming wave's type and its count.
//
// THE RULE. specs/hud.md, The next-wave preview: "In the `opening` phase or a
// build phase, with nothing selected and no shop entry hovered, the information
// area draws the coming wave's type and its count." specs/instrumentation.md
// reports that wave as `nextWave`, "the wave a build or opening phase is
// preparing for", with "its `type` and `count` ... the type and the size
// specs/waves.md gives that wave".
//
// THE PREVIEW IS READ AGAINST WHAT THE BUILD SAYS IS COMING, NOT AGAINST THE WAVE
// TABLE. This item's domain is `presentation` and its requirement is that the
// panel DRAWS the coming wave; which wave is coming is `waves.wave-composition`
// and `waves.wave-size`. So the check reads `nextWave` off the snapshot and holds
// the panel to that, and a build whose wave table is wrong is failed once, there,
// rather than twice.
//
// `nextWave` IS REQUIRED TO BE THERE, because the specification says so for the
// wave posed: it is `null` only "when that number falls outside 1 through
// waveCount", and both waves below are well inside a 26-wave run. A build
// reporting none has nothing to preview and is told that rather than passing on a
// panel that drew nothing.
//
// TWO WAVES, BECAUSE THE PREVIEW IS OF THE COMING WAVE AND NOT OF A FIXED ONE.
// Wave 7 of a 26-wave run is due a Mote wave of 28, and wave 11 a Swarm wave of
// 77 (specs/waves.md), so the second reading is of a different type AND a
// different count. A panel that letters one wave's card and leaves it fails the
// second reading, and it fails on whichever of the two halves the build fixed.
//
// THE TYPE IS READ BY ITS NAME, which specs/surge.md gives for each of the six,
// and as a substring ignoring case, because the words are the specification's and
// the framing is the build's.
//
// NOTHING IS SELECTED AND NOTHING IS HOVERED, and both are read back, because
// specs/hud.md gives the information area three contents and the preview is the
// one a bare build phase selects. `startRun` leaves both clear, and the world
// gate is shut, so the build timer running down cannot start the wave and turn
// the preview into a wave in progress under the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, readsNumber, readsText, textsOf } from "./read";

/** The name specs/surge.md gives each unit type, which is what a preview reads. */
const NAMES: Readonly<Record<string, string>> = {
  mote: "Mote",
  sprint: "Sprint",
  hulk: "Hulk",
  swarm: "Swarm",
  drift: "Drift",
  core: "Core",
};

/**
 * The two waves previewed.
 *
 * specs/waves.md gives wave 7 of a 26-wave run a Mote wave of 28 and wave 11 a
 * Swarm wave of 77, so the two readings differ in the type and in the count, and
 * neither count is a figure the rest of this panel carries.
 */
const WAVES = [7, 11];

/** The run the preview is read on: the deepest wave total this case has. */
const MODE = "containment";
const DIFFICULTY = "hard";
const MONEY = 9999;
const LIVES = 17;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the coming wave's type and count in a build phase", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);

  for (const wave of WAVES) {
    h.debug.setWave(wave);
    const { info } = await readPanel(h);
    if (wave === WAVES[0]) captureStill(h, "preview");

    const snapshot = h.snapshot();
    assertNull(
      snapshot.selected,
      `nothing selected while the build phase of wave ${wave} previews the ` +
        `coming wave (specs/hud.md, The next-wave preview)`,
    );
    assertNull(
      snapshot.hoverShop,
      `no shop entry hovered while the build phase of wave ${wave} previews ` +
        `the coming wave (specs/hud.md, The next-wave preview)`,
    );
    assertNotNull(
      snapshot.nextWave,
      `a coming wave reported for the build phase of wave ${wave} of ` +
        `${snapshot.waveCount}, which is inside the run's progression, so ` +
        `nextWave is not null (specs/instrumentation.md)`,
    );

    const coming = snapshot.nextWave as { type: string; count: number };
    const drew = JSON.stringify(textsOf(info));

    assertTrue(
      readsText(info, NAMES[coming.type]),
      `the coming wave's type, drawn as "${NAMES[coming.type]}", in the ` +
        `build phase of wave ${wave} (specs/hud.md, The next-wave preview; ` +
        `specs/surge.md); the panel's information area drew ${drew}`,
    );
    assertTrue(
      readsNumber(info, coming.count),
      `the coming wave's count of ${coming.count}, which snapshot() reports ` +
        `for the build phase of wave ${wave} (specs/hud.md, The next-wave ` +
        `preview); the panel's information area drew ${drew}`,
    );
  }
});
