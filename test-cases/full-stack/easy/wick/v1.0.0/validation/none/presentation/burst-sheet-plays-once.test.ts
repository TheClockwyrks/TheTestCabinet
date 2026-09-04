// presentation/burst-sheet-plays-once — Flare's six-frame sheet runs once through
// over the flash, one frame every four ticks.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "Animation": "A strike draws
// frame `floor(t / (SPARK_FLASH / 4))` and a burst frame
// `floor(t / (FLARE_FLASH / 6))`, for `t` the seconds of ticks since the tick the
// zone appeared, so each sheet plays once through over its flash." Its row of "The
// weapon effects" gives the files and the span: "flare burst | Flare |
// `assets/sprites/effects/flare/0.png` to `5.png` | a sheet of `6`, played once |
// `128 x 128` | the burst's circle, for `FLARE_FLASH` (`0.4`) seconds".
// `FLARE_FLASH` is `0.4`, so a frame is shown for a fifteenth of a second — four
// ticks by `specs/world.md`'s timer rule — and the six run over twenty-four.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held and
// Flare alone, held at level `1` and due at once. "Flare fires whether or not any
// enemy exists", so nothing is alive and nothing else is on the frame;
// `weaponFire` goes back off the moment it has fired, and Flare's own cooldown is
// sixty seconds besides.
//
// WHAT IS READ. Which of the six produced flare files the frame drew at the
// burst's own place, on each of the twenty-four ticks the zone is live, against
// the frame the floor puts that tick on. Where the effect is drawn and how large
// is the sibling point's; this one is about which frame of the sheet arrives when.
//
// THE ALLOWANCES, AND WHY EACH COSTS THE POINT NOTHING. One tick either side of a
// boundary, as `./sheets` states with its reason, which this sheet needs more than
// any other: `4 / 60` divided by `0.4 / 6` is `0.9999999999999999` in binary
// floating point, so two builds computing the specification's own expression land
// either side of the boundary at the fourth tick. And frames are compared UP TO
// the sheet's own identical pictures, since `specs/assets.md` fixes six files and
// never requires six different ones. The cadence, the order, and the run to the
// last frame are all still decided.

import { afterEach, beforeEach, it } from "vitest";
import { FLARE_FLASH, dueTicks } from "../constants";
import { assertLength, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  mustZone,
  stagePoint,
  type Harness,
} from "../harness";
import { drawFromAt, effectFiles } from "./readouts";
import { fileClasses, primeSources } from "./sources";
import { frameAllowed, play, runsInOrder } from "./sheets";

const FILES = effectFiles("flare");

/** "frame `floor(t / (FLARE_FLASH / 6))`", over `FLARE_FLASH` seconds of ticks. */
const SHEET = play(FILES, FLARE_FLASH / FILES.length);
const TICKS = dueTicks(FLARE_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the flare sheet once through over its flash", async () => {
  await isolate(h);
  await primeSources(h, FILES);
  const classes = await fileClasses(h, FILES);

  await captureReplay(h, "burst", async () => {
    const firing = await fireWeapon(h, "flare", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.zones,
      1,
      "the zones Flare's firing tick created, which is one burst " +
        "(specs/weapons.md)",
    );
    const burst = firing.zones[0]!;

    const drawn: number[] = [];
    for (let tick = 0; tick < TICKS; tick += 1) {
      const snapshot = tick === 0 ? firing.after : await h.step(1);
      const live = mustZone(snapshot, burst.id);
      const found = await drawFromAt(
        h,
        await h.lastCalls(),
        FILES,
        stagePoint(snapshot, live.x, live.y),
        "a frame of the produced flare sheet over the burst",
      );
      drawn.push(found.index);
      assertTrue(
        frameAllowed(SHEET, classes, tick, found.index),
        `the burst frame drawn ${tick} tick(s) after it fired, which is ` +
          `floor(t / (${FLARE_FLASH} / ${FILES.length})) for t the seconds ` +
          `since (specs/assets.md); frame ${found.index} was drawn, after ` +
          `[${drawn.join(", ")}]`,
      );
    }
    assertTrue(
      runsInOrder(SHEET, classes, drawn),
      "the flare sheet's frames to run 0 through 5 in order over the flash " +
        `(specs/assets.md); [${drawn.join(", ")}] were drawn`,
    );
  });
});
