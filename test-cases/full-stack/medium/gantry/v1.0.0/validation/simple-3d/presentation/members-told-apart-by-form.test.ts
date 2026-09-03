// presentation/members-told-apart-by-form — a strut, a cable and a rail are told
// apart by form and not by hue alone.
//
// specs/overview.md, "Visual design", the row for members by material: "A strut,
// a cable, and a rail are told apart at a glance, by form and not by hue alone."
// specs/assets.md, "What is drawn in code": the members are "each as real drawn
// geometry telling strut, cable, and rail apart".
//
// HUE IS DISCARDED BY CONSTRUCTION. What this point reads is not colour but the
// SHAPE each material occupies: the set of world points a body reaches when that
// member is placed. Two materials drawn as the same geometry in two colours fill
// the same set and fail here; two drawn as different geometry fill different sets
// and pass whatever colours they are drawn in. So the reading answers the
// sentence's own question — told apart by form, not by hue.
//
// THE THREE STAND BETWEEN THE SAME TWO NODES, one at a time, with the camera and
// the pointer untouched and the yard emptied around them, so the only thing that
// can differ between the three masks is how the material itself is drawn. The
// nodes are chosen horizontal because specs/structure.md refuses a rail that is
// not ("it is a rail member and is not horizontal"), and six units apart because
// that is `STRUT_MAX_LEN` and `RAIL_MAX_LEN`, the longest all three accept.
//
// THE MASK IS A GRID OF WORLD POINTS around the segment rather than a patch of
// stage, AND THIS IS THIS ENGINE'S HALF OF THE POINT. This engine's yard has no
// pixels at all — the picture is rendered through WebGL, which this process has
// no driver for — and the scene it renders is right there, "live and retained…
// what lets a check find an object and read its world position with no pixels
// involved" (`rendering.ts`). So the shape a material fills is read where the
// specification states it: in the world. Nothing is found by name; what is read
// is what the yard SHOWS between the two nodes that it did not show with them
// bare.
//
// THE MASKS ARE COMPARED BY OVERLAP. Two shapes that are the same cover each
// other; two that differ do not, and the share of their union their intersection
// covers is how much of the pair is common. Anything below `SHARED` is two
// materials a player can tell apart at a glance without reading their colour —
// a shape that is thicker, or carries a head, or is a line where the other is a
// beam.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertLessThan, assertTrue } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type MaterialName,
} from "../harness";

const SITE = 0;

/** The two nodes all three materials stand between: horizontal, six units. */
const FROM = { x: 6, y: 6, z: 0 } as const;
const TO = { x: 12, y: 6, z: 0 } as const;

/** The three materials specs/structure.md gives. */
const MATERIALS: readonly MaterialName[] = ["strut", "cable", "rail"];

/** How far around the segment the mask reaches, in world units. */
const MARGIN = 0.6;

/**
 * How many points the mask holds along, across and through the segment.
 *
 * The two cross-axes are read finely — a fortieth of the margin apart, about
 * three hundredths of a world unit — because what tells one material from
 * another is how much of the space around the line it fills, and a member is a
 * slender thing: a grid coarser than the thinnest of them would read them all as
 * one line of points.
 */
const ALONG = 21;
const ACROSS = 41;

/** Where the pointer is parked: a stage corner, so no node is highlighted. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/**
 * The most of a pair's union its intersection may cover.
 *
 * Not a figure the specification states: it is what "told apart at a glance"
 * is worth as overlap. Two shapes covering four fifths of each other are the
 * same shape with a rim of difference — a hue change and a hair of thickness —
 * and a player reading the yard at speed would not separate them; anything a
 * material genuinely draws differently, a thinner line, a head, a second rail,
 * parts from the other by far more than a fifth of the pair.
 */
const SHARED = 0.8;

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
 * Every body the yard SHOWS, with its world extent.
 *
 * Only what is shown. A build is free to keep a pool of bodies and hide the ones
 * it is not using — the engine's scene is retained, so "what `render` added on
 * one frame is still there on the next" — and a hidden body fills no space in the
 * picture, which is what this point is about. Visibility is read up the whole
 * chain of parents, because hiding a group hides everything under it.
 */
function shown(harness: Harness): Body[] {
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

/** The bodies `after` shows that `before` did not. */
function added(
  before: readonly Body[],
  after: readonly Body[],
): Body[] {
  const was = new Set(before.map((body) => body.signature));
  return after.filter((body) => !was.has(body.signature));
}

/** Whether any of `bodies` reaches a world point. */
function fills(
  read: readonly Body[],
  at: THREE.Vector3,
): boolean {
  return read.some((body) => body.box.containsPoint(at));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the three materials as three different shapes", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  // Every world point a member between those two nodes could fill: the box
  // around the segment, opened out by a margin for whatever thickness, head or
  // halo the build gives it.
  const from = new THREE.Vector3(FROM.x, FROM.y, FROM.z);
  const to = new THREE.Vector3(TO.x, TO.y, TO.z);
  const along = to.clone().sub(from).normalize();
  const across = new THREE.Vector3(0, 1, 0);
  const other = new THREE.Vector3().crossVectors(along, across).normalize();
  across.crossVectors(other, along).normalize();

  const grid: THREE.Vector3[] = [];
  for (let ia = 0; ia < ALONG; ia += 1) {
    const base = from.clone().lerp(to, (ia + 0.5) / ALONG);
    for (let ib = 0; ib < ACROSS; ib += 1) {
      for (let ic = 0; ic < ACROSS; ic += 1) {
        grid.push(
          base
            .clone()
            .addScaledVector(across, ((ib / (ACROSS - 1)) * 2 - 1) * MARGIN)
            .addScaledVector(other, ((ic / (ACROSS - 1)) * 2 - 1) * MARGIN),
        );
      }
    }
  }

  const empty = shown(h);

  const masks = new Map<MaterialName, boolean[]>();
  for (const material of MATERIALS) {
    await h.debug.clearStructure();
    await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, material);
    await h.advance(1);
    const structure = (await h.snapshot()).structure;
    assertTrue(
      structure.members.length === 1 &&
        structure.members[0]!.material === material,
      `the one ${material} this point poses to stand between ` +
        `(${FROM.x}, ${FROM.y}, ${FROM.z}) and (${TO.x}, ${TO.y}, ${TO.z}) ` +
        "(specs/structure.md)",
    );

    const drawn = added(empty, shown(h));
    if (material === "rail") {
      await h.capture(
        "materials",
        "A strut, a cable and a rail between the same nodes",
      );
    }

    const mask = grid.map((point) => fills(drawn, point));
    assertTrue(
      mask.some((on) => on),
      `the ${material} to fill something between its two nodes, which is ` +
        "what a member drawn as real geometry does (specs/assets.md)",
    );
    masks.set(material, mask);
  }

  for (let i = 0; i < MATERIALS.length; i += 1) {
    for (let j = i + 1; j < MATERIALS.length; j += 1) {
      const one = masks.get(MATERIALS[i]!)!;
      const two = masks.get(MATERIALS[j]!)!;
      let both = 0;
      let either = 0;
      for (let k = 0; k < one.length; k += 1) {
        if (one[k]! && two[k]!) both += 1;
        if (one[k]! || two[k]!) either += 1;
      }
      assertLessThan(
        both / either,
        SHARED,
        `the ${MATERIALS[i]} and the ${MATERIALS[j]} to be drawn as ` +
          "different shapes between the same two nodes, since the three " +
          "materials are told apart by form and not by hue alone " +
          "(specs/overview.md)",
      );
    }
  }
});
