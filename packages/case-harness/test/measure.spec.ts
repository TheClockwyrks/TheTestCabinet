// The two things a case turns on about how a reading crosses back out of the
// page: the width a text call is measured at, and the narrowing its snapshots go
// through.
//
// Both are `CaseConfig` members, and both are off unless a case asks — one costs
// a crossing per frame read, and the other is a function only the case can write.
// So each is checked against a fixture kit that turns exactly that one on, and
// against the default kit that does not.

import { expect, it } from "vitest";
import { textDraws } from "../src/index";
import {
  createHarness,
  createMeasuringHarness,
  createProjectingHarness,
  shout,
  type FixtureSnapshot,
  type Harness,
} from "./fixture";

it("measures a text call in the page, under the font in force at it", async () => {
  const h: Harness = await createMeasuringHarness();
  try {
    // What the page itself makes of the build's own heading, under the font the
    // build set. Asked of the same browser under the same fonts, so the check
    // states that the harness measured it and not what any one font stack is.
    const expected = (await h.page.evaluate(() => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (ctx === null) throw new Error("no 2D context");
      ctx.font = "10px sans-serif";
      return ctx.measureText("TITLE").width;
    })) as number;
    expect(expected).toBeGreaterThan(0);

    const [draw] = textDraws(await h.frameCalls());
    expect(draw?.text).toBe("TITLE");
    // The fixture draws left-aligned, so the run starts at the anchor and runs
    // its measured width to the right of it.
    expect(draw?.left).toBe(8);
    expect(draw?.right).toBeCloseTo(8 + expected, 6);
  } finally {
    await h.dispose();
  }
});

it("leaves a text call unmeasured when the case did not ask", async () => {
  const h: Harness = await createHarness();
  try {
    const [draw] = textDraws(await h.frameCalls());
    // The same call off the default kit: a point at its anchor, which is what
    // every case that reads only WHICH strings were drawn was already getting.
    expect(draw?.left).toBe(8);
    expect(draw?.right).toBe(8);
  } finally {
    await h.dispose();
  }
});

it("projects every snapshot that crosses back out of the page", async () => {
  const h: Harness = await createProjectingHarness();
  try {
    // The opening read, taken before anything reset the build — and the screen
    // name derived off it.
    expect(h.openingSnapshot?.screen).toBe(
      shout({ screen: "title" } as FixtureSnapshot).screen,
    );
    expect(h.openingScreen).toBe("TITLE");

    // The surface's own `snapshot`, which is where every read of it lands —
    // `h.snapshot()` here, and `h.debug.snapshot()` for a case whose surface
    // declares one, both through the one call that crosses into the page.
    expect((await h.snapshot()).screen).toBe("TITLE");

    // The states a driven run reads: a recorded drive, and a march that skips
    // the recording and not the simulation.
    expect((await h.step(2)).screen).toBe("TITLE");
    expect((await h.skipUntil((s) => s.frames >= 4)).snapshot.screen).toBe(
      "TITLE",
    );

    // And the sample a sweep decides on.
    const swept = await h.until((s) => s.screen === "TITLE", { maxFrames: 4 });
    expect(swept.hit).toBe(true);
    expect(swept.snapshot.screen).toBe("TITLE");
  } finally {
    await h.dispose();
  }
});

it("leaves the snapshot alone when the case narrows nothing", async () => {
  const h: Harness = await createHarness();
  try {
    expect((await h.snapshot()).screen).toBe("title");
  } finally {
    await h.dispose();
  }
});
