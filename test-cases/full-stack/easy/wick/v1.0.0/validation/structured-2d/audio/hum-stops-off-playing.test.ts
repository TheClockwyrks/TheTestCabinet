// Wick — audio/hum-stops-off-playing: the hum stops when the screen leaves
// `playing`, Halo still held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`hum` is looping
// on every frame exactly when `screen` is `playing` and a held weapon is
// `halo` or `corona` ... and it stops on the frame either stops being true."
// Off `playing` the screen conjunct is false however the loadout stands, so
// the threshold is `false` on every frame of the screen the run left to.
//
// WHY BOTH SCREENS ARE DRIVEN HERE. The rule's screen conjunct is one
// requirement, and `specs/ui.md` gives the hum no reprieve for the screens
// that hold the world still: `levelup` and `paused` are the two ordinary ways
// a run leaves `playing` without ending, and a build that stops the hum on
// one and not the other has met the rule on one route. Both are read on their
// own frames.
//
// WHY THE WORLDS ARE POSED AS THEY ARE. Both are isolated runs holding Halo
// alone, with the hum let up and read as `true` first, so what each decides
// is the STOP. The loadout is untouched across the transition, so the
// conjunct that changed is the screen one alone.
//
//   - The OVERLAY route poses one level-up and runs the one `playing` tick
//     that opens it (`specs/progression.md`). The run holds no passive and
//     one weapon, so the pool is far larger than `OFFER_COUNT` and the
//     overlay fills its draw; no key is pressed afterwards, so it stays open.
//   - The PAUSE route poses `paused`, which `specs/instrumentation.md` makes
//     the real pause, "Exactly as `pause` does". Posing it keeps the `pause`
//     binding out of an audio point.
//
// `weaponFire` stays off so Halo's pulses never run, and neither world holds
// an enemy, projectile, zone, gem, or pickup.
//
// THE TOLERANCE. One frame for the reconciliation, which the specification
// itself grants, and no gap after it. The reading is a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  openLevelUp,
  poseScreen,
  type Harness,
} from "../harness";
import { isolatedRun, loopTrace } from "./cues";

/** Frames read after each transition: the reconciling frame and half a second. */
const FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has hum not looping on the frames after the run leaves playing for an overlay or a pause", async () => {
  await captureReplay(h, "stopped", async () => {
    await isolatedRun(h);
    holdWeapon(h, "halo", 1);
    await h.advance(1);
    assertEqual(
      h.looping(CUES.hum),
      true,
      "whether the hum was up on playing before the overlay opened",
    );

    const opened = await openLevelUp(h, 1);
    assertEqual(opened.screen, "levelup", "the screen the overlay opened on");
    assertEqual(
      opened.run.weapons.some((weapon) => weapon.id === "halo"),
      true,
      "whether Halo was still held under the overlay",
    );
    const overlay = await loopTrace(h, CUES.hum, FRAMES);
    assertEqual(
      overlay.filter((looping) => looping).length,
      0,
      `frames of the open overlay on which hum was still looping, of ${FRAMES} (specs/ui.md, The loops)`,
    );

    await isolatedRun(h);
    holdWeapon(h, "halo", 1);
    await h.advance(1);
    assertEqual(
      h.looping(CUES.hum),
      true,
      "whether the hum was up on playing before the pause",
    );

    const paused = poseScreen(h, "paused");
    assertEqual(paused.screen, "paused", "the screen the pause left");
    assertEqual(
      paused.run.weapons.some((weapon) => weapon.id === "halo"),
      true,
      "whether Halo was still held under the pause",
    );
    const pause = await loopTrace(h, CUES.hum, FRAMES);
    assertEqual(
      pause.filter((looping) => looping).length,
      0,
      `frames of the pause on which hum was still looping, of ${FRAMES} (specs/ui.md, The loops)`,
    );
  });
});
