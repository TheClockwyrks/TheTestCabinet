// presentation/pending-node-marked — the node a member placement is waiting on is
// marked on the build screen.
//
// specs/controls.md § The build tools: "Strut, cable, rail: the first click picks
// a node and holds it pending, VISIBLY MARKED; the second click on another node
// places the member between them and clears the pending node." specs/ui.md
// § Build says the same from the screen's side: the build screen shows the yard
// "with the picked node highlighted and A PENDING FIRST NODE MARKED". Without the
// mark a player cannot see which node the second click will run the member from.
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED. `setPendingNode(x, y, z)`
// "holds that lattice node as the pending first node of a member placement, as a
// first click does" (specs/instrumentation.md), so this reaches the state the
// requirement is about without going through picking, which is another point's
// business: a build whose picking is broken and whose marking is right must fail
// the picking items and pass this one.
//
// THE POINTER IS PARKED IN A CORNER OF THE STAGE, away from every node, so the
// picked-node highlight — the other mark the same sentence asks for — is not
// standing at the node under test. It does not move between the two pictures, so
// whatever it is doing it is doing in both.
//
// THE READING IS A BEFORE AND AFTER, because what a build marks a pending node
// WITH is its own: a ring, a glow, a coloured cube. What is fixed is that the
// mark is AT that node, so the picture is read where the build itself says the
// node landed (`project`), and at two other lattice nodes of the same yard that
// the mark may not reach.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The node held pending: a ground lattice node well inside the frame. */
const NODE = { x: 4, y: 0, z: 4 } as const;

/** Two other lattice nodes, four units off, that the mark may not reach. */
const AWAY = [
  { x: 8, y: 0, z: 4 },
  { x: -4, y: 0, z: 4 },
] as const;

/** Where the pointer is parked: the stage's far corner, away from every node. */
const PARKED = { x: STAGE_W - 10, y: 10 } as const;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** How far from the node's projected point a mark may stand, logical pixels. */
const ON_TOLERANCE = 12;
/** How far from another node the mark must keep, logical pixels. */
const OFF_TOLERANCE = 12;

interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
interface At {
  x: number;
  y: number;
}

async function picture(harness: Harness): Promise<Picture> {
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await harness.paintFrame();
  const png = await harness.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

function colorAt(shot: Picture, at: At): [number, number, number] {
  const x = Math.min(
    Math.max(Math.round((at.x / STAGE_W) * shot.width), 0),
    shot.width - 1,
  );
  const y = Math.min(
    Math.max(Math.round((at.y / STAGE_H) * shot.height), 0),
    shot.height - 1,
  );
  const i = (y * shot.width + x) * 4;
  return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
}

function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function changeNear(a: Picture, b: Picture, at: At, radius: number): number {
  let most = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const point = { x: at.x + dx, y: at.y + dy };
      most = Math.max(most, apart(colorAt(a, point), colorAt(b, point)));
    }
  }
  return most;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the node a placement is holding pending", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.screen, "build", "the screen opening a site shows");
  assertEqual(
    before.pendingNode,
    null,
    "the pending node an opened site leaves, before this point poses one " +
      "(specs/state.md)",
  );

  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the node (${NODE.x}, ${NODE.y}, ${NODE.z}) to be drawn on the stage at ` +
      "the start camera pose, so this point has a picture to read " +
      "(specs/instrumentation.md)",
  );
  const others: At[] = [];
  for (const node of AWAY) {
    const other = await h.project(node.x, node.y, node.z);
    assertTrue(
      other.visible,
      `the node (${node.x}, ${node.y}, ${node.z}) to be drawn on the stage ` +
        "at the start camera pose, so this point has a control to read " +
        "(specs/instrumentation.md)",
    );
    others.push(other);
  }

  const unmarked = await picture(h);
  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  await h.advance(1);
  const marked = await picture(h);
  await h.capture("pending", "The node held pending");

  const held = (await h.snapshot()).pendingNode;
  assertEqual(
    held === null ? null : `${held.x}, ${held.y}, ${held.z}`,
    `${NODE.x}, ${NODE.y}, ${NODE.z}`,
    "the node the game is holding pending once one is posed, which this " +
      "point's picture is about (specs/instrumentation.md)",
  );

  assertGreaterThan(
    changeNear(unmarked, marked, at, ON_TOLERANCE),
    CHANGED,
    `the picture within ${ON_TOLERANCE} logical pixels of the projected node ` +
      `(${NODE.x}, ${NODE.y}, ${NODE.z}) to change when that node is held ` +
      "pending, since the first click of a member placement holds a node " +
      "pending and marks it visibly (specs/controls.md § The build tools, " +
      "specs/ui.md § Build)",
  );

  for (const [index, other] of others.entries()) {
    const node = AWAY[index]!;
    assertLessThanOrEqual(
      changeNear(unmarked, marked, other, OFF_TOLERANCE),
      CHANGED,
      `the picture around the node (${node.x}, ${node.y}, ${node.z}), which ` +
        "holding another node pending may not change: the mark stands at the " +
        "node the second click will run the member from (specs/controls.md " +
        "§ The build tools)",
    );
  }
});
