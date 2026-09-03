// assets/hook-model-turned-to-the-grip — the hook block is drawn turned by the
// grip axis's value.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … the hook at the bob turned to the grip's yaw …". specs/program.md gives
// the grip as one of the four axes the tape drives, and specs/rigging.md has it
// turn nothing but the hook — "turning the grip applies no force to anything" —
// so the grip's value shows on screen in exactly one place: the yaw the hook
// block is drawn at.
//
// THE READING IS THE SAME PAGE AT TWO GRIP VALUES, with nothing else touched: the
// carriage is parked, the bob is posed under it on a cable of exactly the hoist
// axis's length and given no velocity, and the tape's one move is a grip command
// at a rate of a thousandth of a degree a second, which keeps the run running
// without turning anything itself.
//
// THIRTY-SEVEN DEGREES, NOT NINETY. A hook block sculpted with `voxel` at eight
// voxels to the unit is a block of cubes, so it has at most a finite rotational
// symmetry, and a turn is invisible only when it lands exactly on one of that
// symmetry's steps. Ninety is the step a block roughly square in plan is most
// likely to be built with — specs/assets.md sizes the hook `0.6 x 1 x 0.6` —
// and thirty-seven is a step of no symmetry of order below three hundred and
// sixty, so any hook that turns at all is drawn differently at it.
//
// THIS ENGINE'S HALF OF THE POINT IS WHERE THE TURN IS READ. Under this engine
// the yard is the engine's own retained scene — "what `render` added on one frame
// is still there on the next… this is what lets a check find an object by name
// and read its world position with no pixels involved" (`rendering.ts`) — and
// this process has no GPU, so there is no block to photograph. There is the body
// the build put in the scene for the hook, and a body turned about its own
// vertical stands differently in the world from one left square to it. No camera
// comes into it, so no camera is posed.
//
// AND A PATCH OF EMPTY YARD IS READ BESIDE IT, across the yard and square to the
// camera. It has to come back unchanged: that is what tells a hook that turned
// from a build that redraws the whole stage between two ticks.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertTrue, fail } from "../assert";
import { HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/**
 * The tape's one move, and why it is on the slew axis rather than the grip.
 *
 * The run has to still be running for the grip to be posed at all, so the tape
 * needs a step that never completes; and it cannot be a grip step, because
 * specs/instrumentation.md's `setAxis` sets an axis's value "leaving it stopped
 * with no live command", so posing the grip would finish a grip step and end the
 * run. The slew is unbounded (specs/program.md), so a slew target of a hundred
 * thousand degrees is in range and never arrives — and at a rate of a thousandth
 * of a degree a second, which specs/program.md accepts as "greater than `0` and
 * at most the axis's max", the arm turns by under a fifty-thousandth of a degree
 * between the two readings.
 */
const CRAWL: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 100_000, rate: 0.001 }],
};

/** The carriage, and the bob hanging straight under it at the cable's length. */
const TROLLEY_AT = 4;
const BOB: Vec3 = { x: 4, y: 4 - HOIST_START, z: 0 };

/** The two grip values read. */
const REST = 0;
const TURNED = 37;

/**
 * How far around the bob the hook's own body reaches, in world units.
 *
 * specs/assets.md sizes the hook "about `0.6 x 1 x 0.6` units" and says of the
 * part figures that they "are the intent, not a tolerance", so a box this far
 * each way holds any block a build sculpts to that intent — including one hung
 * from the bob rather than centred on it, which reaches a full unit from it —
 * while the carriage two units above it and the crane four units away stay
 * outside.
 */
const HALF = 1.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the hook turned by the grip axis's value", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [CRAWL]);
  await startRun(h);

  const at = await park(REST);
  const block = new THREE.Box3(
    new THREE.Vector3(at.x - HALF, at.y - HALF, at.z - HALF),
    new THREE.Vector3(at.x + HALF, at.y + HALF, at.z + HALF),
  );
  const square = bodies(h);

  const turnedAt = await park(TURNED);
  await h.capture("grip", "The hook at grip 0 and grip 37");
  const turned = bodies(h);

  assertTrue(
    Math.hypot(turnedAt.x - at.x, turnedAt.y - at.y, turnedAt.z - at.z) < 0.05,
    `the bob to stand where it stood, (${at.x.toFixed(2)}, ` +
      `${at.y.toFixed(2)}, ${at.z.toFixed(2)}), with only the grip axis ` +
      'posed — specs/rigging.md says turning the grip "applies no force to ' +
      "anything\", so what changes over the block is the block's own yaw",
  );

  const moved = differing(square, turned).filter(
    (body) => !block.containsBox(body.box),
  );
  if (moved.length > 0) {
    const one = moved[0]!;
    fail(
      "everything the yard draws outside the block's own extent to stand " +
        `where it stood at grip ${REST} and grip ${TURNED}, since turning the ` +
        "grip turns the bare hook and applies no force to anything " +
        "(specs/rigging.md) — otherwise what changes over the hook says " +
        "nothing about the hook",
      `${moved.length} bodies outside it moved: one spans ` +
        `(${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) to ` +
        `(${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }

  assertTrue(
    within(square, block) !== within(turned, block),
    "the hook to be drawn turned to the grip's yaw, so the block at the bob " +
      `stands differently at grip ${TURNED} from at grip ${REST} — a hook ` +
      "drawn at a fixed yaw stands identically at both (specs/assets.md)",
  );
});

/** One body the yard shows, and where it stands in the world. */
interface Body {
  signature: string;
  box: THREE.Box3;
}

/** Every body the yard SHOWS, with its world extent. */
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
    for (
      let node: THREE.Object3D | null = object;
      node !== null;
      node = node.parent
    ) {
      if (!node.visible) return;
    }
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial> | undefined;
    found.push({
      signature: [
        object.type,
        box.min.toArray().map((one) => one.toFixed(3)).join(),
        box.max.toArray().map((one) => one.toFixed(3)).join(),
        material?.color?.getHexString() ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Everything a reading holds wholly inside `box`, as one comparable value. */
function within(read: readonly Body[], box: THREE.Box3): string {
  return read
    .filter((body) => box.containsBox(body.box))
    .map((body) => body.signature)
    .sort()
    .join("\n");
}

/**
 * Every body that STANDS somewhere else between two readings.
 *
 * Where, and not what it is drawn in. The run is live between the two readings —
 * it has to be, for the grip to be posed at all — so the members are recoloured
 * by their utilization on every tick (specs/overview.md § Visual design) and a
 * comparison that held their colours still would be failing a build for doing
 * what the specification asks. What may not move is where anything stands, and
 * the tape's slew crawls at a thousandth of a degree a second, which carries an
 * arm node under a hundredth of a world unit over a tick — so the extents are
 * rounded to the hundredth they are held still at.
 */
function differing(before: readonly Body[], after: readonly Body[]): Body[] {
  const place = (body: Body): string =>
    [
      body.box.min.toArray().map((one) => one.toFixed(2)).join(),
      body.box.max.toArray().map((one) => one.toFixed(2)).join(),
    ].join("|");
  const was = new Set(before.map(place));
  const now = new Set(after.map(place));
  return [
    ...after.filter((body) => !was.has(place(body))),
    ...before.filter((body) => !now.has(place(body))),
  ];
}

/** Pose the run still at one grip value, and answer where the bob stands. */
async function park(grip: number): Promise<Vec3> {
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setAxis("grip", grip);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  if (Math.abs(run.axes.grip.value - grip) > 0.5) {
    fail(
      `the grip axis to stand at ${grip} after it is posed there, which ` +
        "specs/instrumentation.md's `setAxis` establishes",
      `it reads ${run.axes.grip.value}`,
    );
  }
  if (run.phase !== "running") {
    fail(
      "the run to still be running with the bob parked under the carriage, so " +
        "this point reads a hook hanging rather than a crane coming down " +
        "(specs/statics.md)",
      `it is "${run.phase}"` + (run.cause === null ? "" : ` (${run.cause})`),
    );
  }
  return run.bob.pos;
}
