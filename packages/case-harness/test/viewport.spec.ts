// The fit: how a case's stage is mapped onto whatever window the harness opened.
//
// Computed rather than read from the build, deliberately — under no engine the
// fit is the build's own work, so asking it would be asking a build to grade
// itself. Which makes this arithmetic load-bearing twice over: every pixel a
// check reads is addressed through it, and the one check that is ABOUT the fit is
// decided against it.

import { expect, it } from "vitest";
import { fitViewport as fit, toDevice } from "../src/index";
import { STAGE, fitViewport, kit } from "./fixture";

it("is the identity at the stage's own size", () => {
  const view = fit(STAGE.width, STAGE.height, 1, STAGE);

  expect(view).toEqual({
    width: STAGE.width,
    height: STAGE.height,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    cssScale: 1,
    cssOffsetX: 0,
    cssOffsetY: 0,
  });
  expect(toDevice(view, 105, 55)).toEqual({ x: 105, y: 55 });
});

it("scales uniformly and splits the leftover into two bars", () => {
  // A window twice as wide as the stage and three times as tall: the scale is the
  // smaller of the two, so the whole stage fits, and the height it does not use
  // becomes two equal bars.
  const view = fit(STAGE.width * 2, STAGE.height * 3, 1, STAGE);

  expect(view.scale).toBe(2);
  expect(view.offsetX).toBe(0);
  expect(view.offsetY).toBe((STAGE.height * 3 - STAGE.height * 2) / 2);
  // Centred: the bars above and below are the same, so the stage's own centre is
  // the window's.
  expect(toDevice(view, STAGE.width / 2, STAGE.height / 2)).toEqual({
    x: STAGE.width,
    y: (STAGE.height * 3) / 2,
  });
});

it("keeps the device and the CSS mappings apart", () => {
  // On a device pixel ratio of 1 — the shape almost every check runs at — the two
  // agree, which is exactly why carrying only one of them is a trap. A pixel is
  // addressed in DEVICE pixels and the pointer is moved in CSS ones.
  const view = fit(STAGE.width, STAGE.height, 2, STAGE);

  expect(view.scale).toBe(2);
  expect(view.cssScale).toBe(1);
  expect(view.offsetX).toBe(0);
  expect(view.cssOffsetX).toBe(0);
  expect(toDevice(view, 10, 10)).toEqual({ x: 20, y: 20 });
});

it("binds the stage to the case, so a check states only the window", () => {
  // The kit's `fitViewport` is the free one with the case's own stage already in
  // it — which is the whole reason the stage is config rather than an argument a
  // suite repeats.
  expect(fitViewport(STAGE.width * 2, STAGE.height * 3)).toEqual(
    fit(STAGE.width * 2, STAGE.height * 3, 1, kit.config.stage),
  );
  expect(fitViewport(STAGE.width, STAGE.height, 2).scale).toBe(2);
});
