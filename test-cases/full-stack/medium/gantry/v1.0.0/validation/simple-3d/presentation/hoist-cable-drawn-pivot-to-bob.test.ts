// presentation/hoist-cable-drawn-pivot-to-bob — the hoist cable is drawn from the
// pivot to the bob.
//
// specs/rigging.md § The pivot and the bob: "The hoist cable hangs from the pivot:
// the trolley point, on the rail track at the trolley's position, rotated with
// the arm. Its length is the hoist axis's value `L`... The cable is inextensible:
// the bob stays at distance `L` from the pivot. IT IS DRAWN FROM PIVOT TO BOB and
// is otherwise massless." So the drawn cable is the hoist axis made visible:
// lengthen the axis and the drawn line reaches further down, and it stops where
// the bob is.
//
// THE READING IS ONE RUN AT TWO CABLE LENGTHS, with no load attached — the
// sentence holds "whether or not a load is attached", and the bare hook is the
// simpler world. The hoist axis is posed longer between the two pictures, which
// is a change the cable alone answers for: `setAxis` "sets an axis's value,
// leaving it stopped with no live command" (specs/instrumentation.md), and the
// pendulum's own constraint puts the bob at the new distance on the tick that
// follows, straight below a pivot it was already hanging under.
//
// WHAT IS ASSERTED. The stretch of WORLD between where the bob hung and where it
// hangs now is drawn in the second reading and was not in the first: that is the
// cable following the axis's value. And the world beyond the lower bob, along the
// same line, is left alone in both: the cable ends at the bob rather than running
// on. The control is taken a good way past the bob — a hook is drawn there too,
// and how big a hook is drawn is the build's own business (specs/assets.md), so
// the reading keeps well clear of it.
//
// THE STAGING is the same as every run reading in this category: Over the Wall's
// own crane on its own site, whose track stands at `y = 12` so that a cable eight
// units long still hangs clear of the ground; the yard emptied to nothing; the
// trolley run out BY THE TAPE, since a posed jump is a real pivot velocity and
// snaps the cable (specs/rigging.md § The pendulum tick, step 5); and a last tape
// step slow enough that nothing else moves while the pictures are taken.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import {
  DESIGNS,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  TICK_HZ,
  runTicks,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Over the Wall, whose crane carries its track at `y = 12`. */
const SITE = 2;

/** Where the trolley is run out to, and the two cable lengths read. */
const TROLLEY = 8;
const SHORT = 3;
const LONG = 8;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "trolley", target: TROLLEY, rate: 4 }] },
  { kind: "move", commands: [{ axis: "slew", target: 360, rate: 0.01 }] },
];

/** Where along the new stretch of cable the picture is read. */
const ALONG = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85];

/** How far past the lower bob the controls stand, in world units. */
const BEYOND = [2, 4];

/** Ticks driven per span while the carriage runs out, and the cap on the run. */
const RUN_OUT_SPAN = 60;
const RUN_OUT_CAP = 420;

/**
 * Slack on a point of the drawn cable, in world units.
 *
 * A cable is drawn with a thickness of the build's own choosing and may be
 * modelled as a rope with a little sag, so a body standing for it need not pass
 * exactly through a point on the mathematical line. A fifth of a unit is that
 * slack, and a fortieth of the five units of cable this reading lets out.
 */
const TOLERANCE = 0.2;
/** How many of the eight points along the new stretch must be painted. */
const MOST = 7;

/* -------------------------------------------------------------------------- */
/* Reading the yard                                                           */
/* -------------------------------------------------------------------------- */
//
// THIS ENGINE'S HALF OF THIS POINT IS WHERE THE PICTURE IS READ. Under this
// engine the yard is the engine's own retained scene — "what `render` added on
// one frame is still there on the next… this is what lets a check find an object
// by name and read its world position with no pixels involved" (`rendering.ts`)
// — and this process has no GPU, so the yard has no pixels at all. An engineless
// build owns its own renderer, so its version of this point photographs the page
// and reads colours at projected stage points; here the same question is asked in
// WORLD units, of the bodies the build put in the scene. That is the stronger
// reading of the two: a body drawn in the right part of the picture but in the
// wrong place in the world passes there and fails here.
//
// NOTHING IS FOUND BY NAME. What a build calls the objects it renders is its own;
// where it puts them is not.

/** One body the yard is drawn from, and where it stands in the world. */
interface Body {
  /** Everything about it a redraw would have to keep to be the same body. */
  signature: string;
  box: THREE.Box3;
}

/**
 * Every body the yard is drawn from, with its world extent.
 *
 * A body is anything the build put in the scene that occupies space — a mesh, a
 * line, a cloud of points. Lights and bare groups occupy none and are skipped:
 * they carry no extent for a reading about a place to be about.
 */
function bodies(harness: Harness): Body[] {
  const found: Body[] = [];
  harness.engine.scene.traverse((object) => {
    const drawn = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isPoints?: boolean;
    };
    if (
      drawn.isMesh !== true &&
      drawn.isLine !== true &&
      drawn.isPoints !== true
    ) {
      return;
    }
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const material = (object as THREE.Mesh).material as
      | Partial<THREE.MeshStandardMaterial>
      | undefined;
    found.push({
      signature: [
        object.type,
        object.visible ? "1" : "0",
        box.min
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
        box.max
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
        material?.color?.getHexString() ?? "",
        material?.emissive?.getHexString() ?? "",
        material?.opacity ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Every body one reading holds that the other does not, either way round. */
function changedBodies(
  before: readonly Body[],
  after: readonly Body[],
): Body[] {
  const tally = (read: readonly Body[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const body of read) {
      counts.set(body.signature, (counts.get(body.signature) ?? 0) + 1);
    }
    return counts;
  };
  const was = tally(before);
  const now = tally(after);
  return [
    ...after.filter(
      (body) => (now.get(body.signature) ?? 0) > (was.get(body.signature) ?? 0),
    ),
    ...before.filter(
      (body) => (now.get(body.signature) ?? 0) < (was.get(body.signature) ?? 0),
    ),
  ];
}

/** How many of `changed` reach within `radius` world units of `at`. */
function changedNear(
  changed: readonly Body[],
  at: { x: number; y: number; z: number },
  radius: number,
): number {
  const ball = new THREE.Sphere(new THREE.Vector3(at.x, at.y, at.z), radius);
  return changed.filter((body) => body.box.intersectsSphere(ball)).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the cable down to the bob the hoist length puts there", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, DESIGNS[SITE]!);
  await poseTape(h, TAPE);
  await startRun(h);

  // Driven in spans rather than a tick at a time: the move is `TROLLEY` units
  // at rate 4 with an acceleration of 4 (specs/program.md), so it is over well
  // inside the cap however a build ramps it, and all this reading needs is that
  // the carriage HAS arrived before the pictures are taken. A tick-by-tick sweep
  // reads the state across the surface once per tick and pays for the reading
  // many times over; a span-by-span one reads it once per span and still fails
  // the item, on the same cap, if the carriage never arrives.
  const out = await runOut(h);
  const pivot = out.run.pivot;
  await h.debug.setAxis("hoist", SHORT);
  await h.debug.setBob(pivot.x, pivot.y - SHORT, pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(2);

  const hanging = await h.snapshot();
  assertEqual(
    hanging.run.phase,
    "running",
    "the run this reading is taken during (specs/program.md)",
  );
  assertEqual(
    hanging.run.attached,
    null,
    "the load on the hook, which this reading has none of: the cable is drawn " +
      "from pivot to bob whether or not a load is attached (specs/rigging.md)",
  );
  const high = hanging.run.bob.pos;

  const before = bodies(h);

  await h.debug.setAxis("hoist", LONG);
  await h.advance(1);
  const lowered = await h.snapshot();
  assertEqual(
    lowered.run.phase,
    "running",
    "the run once the cable is let out, which the second picture is of",
  );
  const low = lowered.run.bob.pos;
  const after = bodies(h);
  const changed = changedBodies(before, after);
  await h.capture("cable", "The cable drawn at two hoist lengths");

  assertEqual(
    Math.round(lowered.run.axes.hoist.value * 1e6) / 1e6,
    LONG,
    "the hoist axis's value the second picture is drawn at " +
      "(specs/instrumentation.md)",
  );
  const span = Math.hypot(low.x - high.x, low.y - high.y, low.z - high.z);
  assertGreaterThan(
    span,
    ALONG.length * TOLERANCE * 2,
    `the world units between the bob on a cable of ${SHORT} and the bob on ` +
      `a cable of ${LONG}, which this reading needs long enough to sample ` +
      "along",
  );
  const direction = {
    x: (low.x - high.x) / span,
    y: (low.y - high.y) / span,
    z: (low.z - high.z) / span,
  };

  const bare = ALONG.filter((t) => {
    const at = {
      x: high.x + (low.x - high.x) * t,
      y: high.y + (low.y - high.y) * t,
      z: high.z + (low.z - high.z) * t,
    };
    return changedNear(changed, at, TOLERANCE) === 0;
  });
  assertGreaterThan(
    ALONG.length - bare.length,
    MOST - 1,
    `the points along the stretch between the two bobs that letting the ` +
      `cable out from ${SHORT} to ${LONG} paints over, out of ` +
      `${ALONG.length}: the cable is drawn from the pivot to the bob, and the ` +
      "bob stands at the hoist axis's value below the pivot " +
      "(specs/rigging.md § The pivot and the bob)",
  );

  for (const past of BEYOND) {
    const at = {
      x: low.x + direction.x * past,
      y: low.y + direction.y * past,
      z: low.z + direction.z * past,
    };
    assertLessThanOrEqual(
      changedNear(changed, at, TOLERANCE),
      0,
      `the yard ${past} world units past the lower bob, on the line the ` +
        "cable hangs along, which letting the cable out may not paint: the " +
        "cable is drawn from the pivot TO THE BOB (specs/rigging.md § The " +
        "pivot and the bob)",
    );
  }
});

/**
 * Run until the carriage has reached the end of its move, in spans.
 *
 * The cap is not a quiet ceiling: a reading whose carriage never arrived would
 * fall through to assertions about a cable hanging somewhere else, so a run that
 * has not arrived by `RUN_OUT_CAP` fails the item and says so.
 */
async function runOut(h: Harness): Promise<GantrySnapshot> {
  let state: GantrySnapshot | null = null;
  for (let driven = 0; driven < RUN_OUT_CAP; driven += RUN_OUT_SPAN) {
    state = await runTicks(h, Math.min(RUN_OUT_SPAN, RUN_OUT_CAP - driven));
    if (state.run.axes.trolley.value >= TROLLEY - 1e-9) return state;
  }
  return fail(
    `the trolley to run out to ${TROLLEY} within ${RUN_OUT_CAP} ticks ` +
      `(${(RUN_OUT_CAP / TICK_HZ).toFixed(2)}s of run clock): the step moves ` +
      `it there at rate 4 with an acceleration of 4 (specs/program.md)`,
    state === null
      ? "the run was never driven"
      : `it stands at ${state.run.axes.trolley.value.toFixed(3)} and the run ` +
          `is "${state.run.phase}"` +
          (state.run.cause === null ? "" : ` (${state.run.cause})`),
  );
}
