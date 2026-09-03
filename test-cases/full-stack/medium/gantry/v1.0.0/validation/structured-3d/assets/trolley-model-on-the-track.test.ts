// assets/trolley-model-on-the-track — the carriage is drawn at the trolley's own
// position along the track, not somewhere fixed on it.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … the trolley on the track at the trolley position …".
// specs/structure.md gives the track its origin — "The end nearer the slew axis
// is the track's origin. The trolley's position is measured along it" — and
// specs/state.md reports where the carriage has reached as the run's `pivot`,
// "the point the cable hangs from", which is the point under the carriage.
//
// TWO POSITIONS ALONG THE TRACK, because one cannot tell a carriage drawn at the
// trolley position from a carriage parked at the track's origin, at its far end,
// or at any other fixed point that happens to coincide with it once. What is read
// at each is the run's own pivot, so what the drawing is held to is the build's
// own answer for where the carriage has reached rather than a track this file
// worked out.
//
// WHERE A MODEL IS DRAWN, UNDER AN ENGINE. specs/assets.md has an engine build
// load each model "through the engine's own asset loader under its asset root",
// so a model on screen is a `ModelComponent` the world holds. `drawnFromModel`
// answers the placements of one committed file — it decodes that file for itself
// through the same loader and matches a component's model against it by contents,
// so a subject drawn from another subject's file does not answer — and
// `drawnModelBox` answers the box each placement FILLS: the model's own extent,
// scaled and turned and stood where the component stands. The component's
// transform is the model's origin, which an exporter is free to put at a corner,
// so the box is what "where it is drawn" means.
//
// THE ENGINELESS PROJECT DECIDES THIS BY SERVING THE FILE WITH ANOTHER MODEL'S
// BYTES and reading which pixels change. There is no rasterizer here —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so the reading is the picture's contents rather than its
// pixels.
//
// THE WORLD IS THE CRANE ALONE: no loads, no obstacles, and a tape of one grip
// move, the only axis whose motion "applies no force to anything"
// (specs/rigging.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  drawnFromModel,
  drawnModelBox,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The subject's produced model, under the asset root specs/assets.md fixes. */
const MODEL = "models/trolley.glb";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Two positions along the track, a long way apart on it. */
const POSITIONS = [1, 4] as const;

/**
 * How far outside the box a model fills the point it is drawn at may stand.
 *
 * specs/assets.md sizes each model only "about" its figure and says of the part
 * figures that they "are the intent, not a tolerance", so a build is free to
 * sculpt a block a little short of the point it is drawn around. A quarter of a
 * unit is two voxels at `VOXELS_PER_UNIT` (`8`), and far short of
 * `LATTICE_PITCH` (`2`), so a model drawn at the neighboring node does not
 * answer.
 */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the trolley at the point on the track the trolley axis stands at", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);

  const seen: { at: Vec3; centre: Vec3 }[] = [];
  for (const position of POSITIONS) {
    await h.debug.setAxis("trolley", position);
    await h.advance(1);

    // The build's own answer for where the carriage has reached.
    const at = (await h.snapshot()).run.pivot;
    const boxes = (await drawnFromModel(h, MODEL)).map((one) =>
      drawnModelBox(one),
    );
    const over = boxes.filter(
      (box) =>
        box !== null &&
        at.x >= box.min.x - SLACK &&
        at.x <= box.max.x + SLACK &&
        at.z >= box.min.z - SLACK &&
        at.z <= box.max.z + SLACK,
    );
    assertTrue(
      over.length > 0,
      `the trolley model drawn over the pivot at trolley ${position}, ` +
        `(${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}): "the ` +
        'trolley on the track at the trolley position" (specs/assets.md). It ' +
        `is drawn at ${JSON.stringify(boxes.map((box) => box?.centre))}`,
    );
    seen.push({ at, centre: over[0]!.centre });
  }

  // And it MOVED: a carriage drawn at a fixed point on the track would stand
  // over the pivot at whichever position happened to coincide with it and
  // nowhere else, so both readings above passing is only half the sentence.
  const first = seen[0]!;
  const second = seen[1]!;
  assertGreaterThan(
    Math.hypot(
      second.centre.x - first.centre.x,
      second.centre.z - first.centre.z,
    ),
    distance3(
      { x: first.at.x, y: 0, z: first.at.z },
      { x: second.at.x, y: 0, z: second.at.z },
    ) / 2,
    `the distance the drawn carriage moved between trolley ${POSITIONS[0]} ` +
      `and trolley ${POSITIONS[1]}, against how far the pivot itself moved: ` +
      "the carriage is drawn at the trolley position rather than at a fixed " +
      "point on the track (specs/assets.md)",
  );

  await h.capture(
    "trolley",
    "The trolley drawn at its position along the track",
  );
});
