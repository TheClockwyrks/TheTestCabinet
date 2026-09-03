// presentation/pad-outline-turned-to-the-target-yaw — a pad is drawn turned to
// the yaw the load is wanted at.
//
// `specs/overview.md` § Visual design: "Anchor points, each load's starting
// position, and each pad's footprint AND REQUIRED YAW are marked so a site is
// readable before anything is built." A pad's required yaw is its load's target
// yaw (`specs/world.md`), which the site reports.
//
// TWO YAWS, NOT ONE. What yaw a build draws a pad at when the target is zero is
// its own zero; that the outline FOLLOWS the target is the requirement. So one
// load is posed at each of two target yaws and the drawn yaws are compared
// against the turn between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  addOneLoad,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

const CLASS = "crate" as const;
const FROM = { x: 7, y: 0, z: -3, yaw: 0 };

/** The same pad at two required yaws. */
const SQUARE = { x: -6, y: 0, z: 8, yaw: 0 };
const TURNED = { x: -6, y: 0, z: 8, yaw: 90 };

/** How far the drawn turn may fall from the target's. */
const TOLERANCE = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

const turn = (from: number, to: number): number => {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

it("turns a pad's outline to its load's required yaw", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("build");

  await addOneLoad(h, CLASS, 40, FROM, SQUARE);
  await h.advance(1);
  const square = entriesOf(await h.drawn(), "mark", "pad");
  assertTrue(square.length > 0, "a pad mark among what the frame drew");

  await addOneLoad(h, CLASS, 40, FROM, TURNED);
  await h.advance(1);
  const turned = entriesOf(await h.drawn(), "mark", "pad");

  await h.capture("pad-yaw", "A pad outline turned to its required yaw");

  assertTrue(turned.length > 0, "a pad mark after the target yaw changed");
  const moved = Math.abs(turn(square[0]!.yaw, turned[0]!.yaw));
  assertTrue(
    Math.abs(moved - Math.abs(TURNED.yaw - SQUARE.yaw)) <= TOLERANCE,
    "the pad outline to turn with its required yaw: the target turned " +
      `${Math.abs(TURNED.yaw - SQUARE.yaw)} degrees and the outline turned ` +
      `${moved.toFixed(1)} (specs/overview.md)`,
  );
});
