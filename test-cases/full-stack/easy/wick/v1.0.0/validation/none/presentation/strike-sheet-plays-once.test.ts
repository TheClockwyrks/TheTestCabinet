// presentation/strike-sheet-plays-once — Spark's four-frame sheet runs once
// through over the flash, one frame every three ticks.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "Animation": "A strike draws
// frame `floor(t / (SPARK_FLASH / 4))` and a burst frame
// `floor(t / (FLARE_FLASH / 6))`, for `t` the seconds of ticks since the tick the
// zone appeared, so each sheet plays once through over its flash." Its row of "The
// weapon effects" gives the files and the span: "strike | Spark |
// `assets/sprites/effects/spark/0.png` to `3.png` | a sheet of `4`, played once |
// `80 x 80` | the strike's `area` circle, for `SPARK_FLASH` (`0.2`) seconds".
// `SPARK_FLASH` is `0.2`, so a frame is shown for `0.05` seconds — three ticks by
// `specs/world.md`'s timer rule — and the four run over twelve.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, one
// hound `300` units out, and Spark alone, held at level `1` and due at once. Spark
// needs a target within `SPARK_RANGE` (`600`) to fire at all, and the hound is the
// only one, so where the strike lands is not a random draw; a hound carries `120`
// health against Spark's `15`, so it survives the flash and nothing else joins the
// frame. `weaponFire` goes back off the moment it has fired.
//
// WHAT IS READ. Which of the four produced strike files the frame drew at the
// strike's own place, on each of the twelve ticks the zone is live, against the
// frame the floor puts that tick on. Where the effect is drawn and how large is
// the sibling point's; this one is about which frame of the sheet arrives when.
//
// THE ALLOWANCES, AND WHY EACH COSTS THE POINT NOTHING. One tick either side of a
// boundary, as `./sheets` states with its reason: `t` is a tick count in seconds,
// and a build that accumulates it and one that divides it disagree in the last
// bits of a float, which moves a boundary by a tick. And frames are compared UP TO
// the sheet's own identical pictures, since `specs/assets.md` fixes four files and
// never requires four different ones. The cadence, the order, and the run to the
// last frame are all still decided.

import { afterEach, beforeEach, it } from "vitest";
import { SPARK_FLASH, dueTicks } from "../constants";
import { assertLength, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  mustZone,
  placeEnemy,
  stagePoint,
  type Harness,
} from "../harness";
import { drawFromAt, effectFiles } from "./readouts";
import { fileClasses, primeSources } from "./sources";
import { frameAllowed, play, runsInOrder } from "./sheets";

/** The target Spark needs, well inside SPARK_RANGE and clear of the centre. */
const TARGET_AT = { dx: 300, dy: 0 };

const FILES = effectFiles("spark");

/** "frame `floor(t / (SPARK_FLASH / 4))`", over `SPARK_FLASH` seconds of ticks. */
const SHEET = play(FILES, SPARK_FLASH / FILES.length);
const TICKS = dueTicks(SPARK_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the strike sheet once through over its flash", async () => {
  const posed = await isolate(h);
  await primeSources(h, FILES);
  const classes = await fileClasses(h, FILES);
  const at = posed.run.player;
  await placeEnemy(h, "hound", at.x + TARGET_AT.dx, at.y + TARGET_AT.dy);

  await captureReplay(h, "strike", async () => {
    const firing = await fireWeapon(h, "spark", 1);
    await disable(h, "weaponFire");
    assertLength(
      firing.zones,
      1,
      "the zones Spark's firing tick created, which at level 1 with one enemy " +
        "in range is one strike (specs/weapons.md)",
    );
    const strike = firing.zones[0]!;

    const drawn: number[] = [];
    for (let tick = 0; tick < TICKS; tick += 1) {
      const snapshot = tick === 0 ? firing.after : await h.step(1);
      const live = mustZone(snapshot, strike.id);
      const found = await drawFromAt(
        h,
        await h.lastCalls(),
        FILES,
        stagePoint(snapshot, live.x, live.y),
        "a frame of the produced strike sheet over the strike",
      );
      drawn.push(found.index);
      assertTrue(
        frameAllowed(SHEET, classes, tick, found.index),
        `the strike frame drawn ${tick} tick(s) after it landed, which is ` +
          `floor(t / ${SPARK_FLASH / FILES.length}) for t the seconds since ` +
          `(specs/assets.md); frame ${found.index} was drawn, after ` +
          `[${drawn.join(", ")}]`,
      );
    }
    assertTrue(
      runsInOrder(SHEET, classes, drawn),
      "the strike sheet's frames to run 0, 1, 2, 3 in order over the flash " +
        `(specs/assets.md); [${drawn.join(", ")}] were drawn`,
    );
  });
});
