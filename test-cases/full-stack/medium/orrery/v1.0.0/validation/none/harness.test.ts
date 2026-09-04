// Orrery — the harness's own suite. CASE-PROVIDED, and the SAME TEXT in all three
// engine projects.
//
// NOT A REVIEW ITEM. No entry of `test-case.toml` names this file, so it decides
// no point and synthesizes no verdict; the runner runs only the suites the
// resolved variant's checklist names. What it is for is the thing the 1058 suites
// cannot check for themselves: that the harness they are written against WORKS,
// and that it works the same way under all three engines.
//
// SO IT IS ONE TEXT, THREE TIMES. Every line below sits unchanged in
// `validation/none/`, `validation/simple-2d/` and `validation/structured-2d/`.
// That is the property the whole design rests on — a suite deciding one review
// item is the same text in all three projects — and this file is where it is
// exercised rather than merely intended. A change to one project's `harness.ts`
// that makes this file need editing has broken it.
//
// It asserts through the same `../assert` helpers a real check does, so a failure
// here reads the way a failure there reads.

import { afterEach, beforeEach, describe, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
  assertNull,
  assertTrue,
} from "./assert";
import {
  ARM_MIN_LEN,
  ORRERY_DEBUG_VERSION,
  SPEEDS,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { at, hexCenter, onField, targetHex } from "./field";
import { machineCost, machinePeriod, spokesOf } from "./parts";
import { BARE, EAST, ORIGIN, WEST } from "./fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureReplay,
  captureStill,
  clearWorld,
  createHarness,
  drag,
  imageDraws,
  openBareRun,
  openTitle,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  poseOf,
  pressAction,
  spawnMote,
  watchCues,
  writeTape,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

describe("standing the game up", () => {
  it("opens on the title with the surface answering", async () => {
    await openTitle(h);
    const snapshot = await h.snapshot();
    assertEqual(snapshot.screen, "title", "a reset game opens on the title");
    assertEqual(snapshot.mode, "campaign");
    assertEqual(snapshot.version, ORRERY_DEBUG_VERSION);
    assertEqual(snapshot.completion, true, "the completion switch rests on");
    assertNull(snapshot.challenge, "no challenge is open away from the editor");
    assertNull(snapshot.sim, "no run is live while editing");
    assertEqual(snapshot.editor.parts.length, 0);
    assertEqual(snapshot.editor.period, 1, "an empty machine's period is 1");
  });

  it("reports the surface as present", async () => {
    assertNull(h.surfaceFault, "the build installs the whole surface");
    const probed = await h.probe(["snapshot", "startRun", "spawnMote"]);
    assertEqual(probed.ops.snapshot, "function");
    assertEqual(probed.ops.startRun, "function");
    assertEqual(probed.ops.spawnMote, "function");
  });
});

describe("the clock", () => {
  it("advances whole frames and accumulates simTime", async () => {
    await openTitle(h);
    const before = (await h.snapshot()).simTime;
    const frames = h.frame();
    await h.advance(10);
    assertEqual(h.frame() - frames, 10, "ten frames were driven");
    const after = (await h.snapshot()).simTime;
    assertGreaterThan(after, before, "every update adds its dt to simTime");
  });

  it("runs a span of game time in one frame or in many, to the same place", async () => {
    await openBareRun(h, { challenge: BARE });
    await h.advanceSeconds(1, 1);
    const inOne = (await h.snapshot()).sim?.cycle ?? -1;
    await openBareRun(h, { challenge: BARE });
    await h.advanceSeconds(1, 30);
    const inThirty = (await h.snapshot()).sim?.cycle ?? -1;
    assertEqual(
      inThirty,
      inOne,
      "an interval reaches the same state however it was divided",
    );
  });

  it("advances whole cycles at the run's own speed", async () => {
    await openBareRun(h, { challenge: BARE });
    const opened = await h.snapshot();
    assertNotNull(opened.sim, "startRun leaves a live run");
    assertEqual(opened.sim?.cycle, 0, "a run opens at cycle 0");
    assertEqual(
      opened.sim?.speed,
      1,
      "a run opens at DEFAULT_SPEED_INDEX (specs/simulation.md)",
    );
    await advanceCycles(h, 3);
    const after = await h.snapshot();
    assertEqual(after.sim?.cycle, 3, "three whole cycles ran");
    assertEqual(after.sim?.fraction, 0, "a whole cycle lands on a boundary");
  });

  it("advances a fraction of a cycle without crossing its boundary", async () => {
    await openBareRun(h, { challenge: BARE });
    await advanceFraction(h, 0.5);
    const snapshot = await h.snapshot();
    assertEqual(snapshot.sim?.cycle, 0, "half a cycle crosses no boundary");
    assertBetween(snapshot.sim?.fraction ?? -1, 0.4, 0.6);
  });

  it("counts a second of game time at every speed step", async () => {
    for (const [index, rate] of SPEEDS.entries()) {
      await openBareRun(h, { challenge: BARE, speed: index });
      await h.advanceSeconds(1, 10);
      const snapshot = await h.snapshot();
      assertEqual(
        snapshot.sim?.cycle,
        rate,
        `speed ${index} runs SPEEDS[${index}] cycles a second`,
      );
    }
  });
});

describe("posing an isolated world", () => {
  it("opens a run with an empty field and the completion switch held off", async () => {
    await openBareRun(h, { challenge: BARE });
    const snapshot = await h.snapshot();
    assertEqual(snapshot.completion, false, "the switch is held off");
    assertEqual(snapshot.sim?.motes.length, 0, "clearMotes emptied the field");
    assertEqual(
      snapshot.editor.parts.length,
      0,
      "clearMachine emptied the machine",
    );
    assertEqual(
      snapshot.challenge?.source,
      "custom",
      "a loaded challenge is custom",
    );
    assertEqual(snapshot.challenge?.name, BARE.name);
  });

  it("places back exactly one mote", async () => {
    await openBareRun(h, { challenge: BARE });
    const mote = await spawnMote(h, ORIGIN, "dust");
    const snapshot = await h.snapshot();
    assertEqual(snapshot.sim?.motes.length, 1, "one mote, and nothing else");
    assertEqual(snapshot.sim?.motes[0]?.id, mote);
    assertEqual(snapshot.sim?.motes[0]?.type, "dust");
    assertNull(
      snapshot.sim?.motes[0]?.wheel ?? null,
      "a real mote is no fixture",
    );
  });

  it("places back exactly one part, and answers its id", async () => {
    await openBareRun(h, { challenge: BARE });
    const arm = await placePart(h, "arm", ORIGIN, 0);
    const snapshot = await h.snapshot();
    assertEqual(snapshot.editor.parts.length, 1);
    assertEqual(snapshot.editor.parts[0]?.id, arm);
    assertEqual(snapshot.editor.parts[0]?.kind, "arm");
    assertEqual(snapshot.editor.parts[0]?.length, ARM_MIN_LEN);
    assertNotNull(
      poseOf(snapshot, arm),
      "a part added to a live run takes a pose",
    );
  });

  it("places back one rise, one set, and one track", async () => {
    await openBareRun(h, { challenge: BARE });
    const rise = await placeRise(h, 0, WEST);
    const set = await placeSet(h, 0, EAST);
    const track = await placeTrack(h, [at(0, 2), at(1, 2), at(2, 2)]);
    const snapshot = await h.snapshot();
    assertEqual(snapshot.editor.parts.length, 3);
    assertEqual(
      snapshot.editor.parts.map((part) => part.id).join(","),
      `${rise},${set},${track}`,
    );
    assertEqual(
      snapshot.editor.parts[2]?.cells?.length,
      3,
      "the track was laid whole",
    );
    assertEqual(snapshot.editor.parts[2]?.closed, false, "and left open");
  });

  it("clears the world back to nothing", async () => {
    await openBareRun(h, { challenge: BARE });
    await placePart(h, "arm", ORIGIN, 0);
    await spawnMote(h, at(1, 0), "dust");
    await clearWorld(h);
    const snapshot = await h.snapshot();
    assertEqual(snapshot.editor.parts.length, 0);
    assertEqual(snapshot.sim?.motes.length, 0);
  });
});

describe("the faculty gates", () => {
  it("holds a part's motion still by leaving its tape blank", async () => {
    await openBareRun(h, { challenge: BARE });
    const arm = await placePart(h, "arm", ORIGIN, 0);
    await advanceCycles(h, 2);
    const snapshot = await h.snapshot();
    assertEqual(
      poseOf(snapshot, arm)?.rotation,
      0,
      "a blank tape rests the part for every cycle",
    );
  });

  it("moves a part under a tape it was given", async () => {
    await openBareRun(h, { challenge: BARE });
    const arm = await placePart(h, "arm", ORIGIN, 0);
    await writeTape(h, arm, ["rotate-cw"]);
    const written = await h.snapshot();
    assertEqual(written.editor.period, 1, "a one-cell tape gives period 1");
    await advanceCycles(h, 1);
    assertEqual(
      poseOf(await h.snapshot(), arm)?.rotation,
      1,
      "rotate-cw turns the arm one step clockwise",
    );
  });

  it("gives a gripper its hold with no grab ever running", async () => {
    await openBareRun(h, { challenge: BARE });
    const arm = await placePart(h, "arm", ORIGIN, 0);
    const mote = await spawnMote(h, at(1, 0), "dust");
    await h.debug.setGrip(arm, 0, mote);
    const snapshot = await h.snapshot();
    assertEqual(snapshot.sim?.grips.length, 1, "the gripper is holding");
    assertEqual(snapshot.sim?.grips[0]?.mote, mote);
    await h.debug.releaseGrip(arm, 0);
    assertEqual(
      (await h.snapshot()).sim?.grips.length,
      0,
      "and it opened again",
    );
  });
});

describe("the keyboard and the pointer", () => {
  it("moves the title menu with a registered action", async () => {
    await openTitle(h);
    const moved = await pressAction(h, "down");
    assertEqual(moved.menuIndex, 1, "down moves the highlight by one");
  });

  it("targets a hex from a stage position, and drags between two", async () => {
    assertTrue(onField(ORIGIN));
    const centre = hexCenter(ORIGIN);
    assertEqual(targetHex(centre.x, centre.y)?.q, 0);
    assertEqual(targetHex(centre.x, centre.y)?.r, 0);
    await openBareRun(h, { challenge: BARE });
    const arm = await placePart(h, "arm", ORIGIN, 0);
    await h.debug.stopRun();
    await drag(h, hexCenter(ORIGIN), hexCenter(at(1, 0)));
    const moved = await h.snapshot();
    const part = moved.editor.parts.find((entry) => entry.id === arm);
    assertEqual(part?.q, 1, "the drag translated the part by its offset");
    assertEqual(part?.r, 0);
    assertNull(moved.editor.drag, "a drag ends at its release");
  });

  it("mirrors the pointer into the state", async () => {
    await openBareRun(h, { challenge: BARE });
    await h.debug.pointerMove(400, 300);
    await h.advance(1);
    const snapshot = await h.snapshot();
    assertEqual(snapshot.pointer.x, 400);
    assertEqual(snapshot.pointer.y, 300);
  });
});

describe("what a frame drew, and what it sounded", () => {
  it("hands back the operations one frame issued", async () => {
    await openTitle(h);
    const calls = await h.frameCalls();
    assertGreaterThan(calls.length, 0, "a title frame draws something");
    assertEqual(
      (await h.lastCalls()).length,
      calls.length,
      "the last closed frame is the one just driven",
    );
  });

  it("reads the sprites a frame drew, where the build drew any", async () => {
    await openBareRun(h, { challenge: BARE });
    await spawnMote(h, ORIGIN, "sol");
    const draws = imageDraws(await h.frameCalls());
    for (const draw of draws) {
      assertGreaterThan(
        draw.image.id,
        0,
        "every drawn source carries an identity",
      );
      assertGreaterThanOrEqual(draw.image.width, 0);
    }
  });

  it("samples the canvas at the stage's own size", async () => {
    await openTitle(h);
    const fit = h.viewport();
    assertEqual(fit.width, STAGE_W);
    assertEqual(fit.height, STAGE_H);
    assertEqual(
      fit.scale,
      1,
      "the default harness is one device pixel per unit",
    );
    const pixel = await h.pixel(STAGE_W / 2, STAGE_H / 2);
    assertEqual(pixel.length, 4, "a pixel is [r, g, b, a]");
    const rect = await h.pixelRect(0, 0, 8, 8);
    assertEqual(rect.width, 8);
    assertEqual(rect.height, 8);
  });

  it("collects the sounds a frame emitted", async () => {
    // The one check in this file that reads what the build SOUNDED, so the one
    // that needs an ARMED harness — and a harness is armed only at creation,
    // because the gesture that opens the build's audio is a real key press and the
    // only safe moment for it is before the opening `reset` that puts the state
    // back. So the shared one is disposed and replaced here rather than every
    // check in the file being armed: a fault in the arming then cannot reach the
    // clock, the poses, the pixels or the evidence writers, none of which are
    // about sound.
    await h.dispose();
    h = await createHarness({ armAudio: true });

    await openBareRun(h, { challenge: BARE });
    const played = watchCues(h);
    await placePart(h, "arm", ORIGIN, 0);
    await h.advance(2);
    for (const cue of played) {
      assertGreaterThan(
        cue.frame,
        0,
        "a cue is stamped with the frame it sounded on",
      );
    }
    assertGreaterThanOrEqual(await h.sounds(), 0);
    assertGreaterThanOrEqual(await h.loopingSounds(), 0);
  });
});

describe("the spec-derived oracle", () => {
  it("computes a machine's cost and period the way specs/parts.md does", () => {
    assertEqual(machineCost([{ kind: "arm", q: 0, r: 0, rotation: 0 }]), 20);
    assertEqual(
      machineCost([{ kind: "track", cells: [at(0, 0), at(1, 0)] }]),
      10,
      "a track costs its entry per cell",
    );
    assertEqual(machinePeriod([]), 1, "an empty machine's period is 1");
    assertEqual(
      machinePeriod([{ kind: "arm", tape: ["grab", null, "drop"] }]),
      3,
    );
  });

  it("counts an arm's spokes the way specs/parts.md does", () => {
    assertEqual(spokesOf("arm", 2).join(","), "2");
    assertEqual(spokesOf("biarm", 0).join(","), "0,3");
    assertEqual(spokesOf("triarm", 1).join(","), "1,3,5");
    assertEqual(spokesOf("hexarm", 0).join(","), "0,1,2,3,4,5");
    assertEqual(spokesOf("wheel", 0).length, 0, "a wheel carries no gripper");
  });
});

describe("the media helpers", () => {
  it("run their scenario and write nothing outside a run", async () => {
    await openTitle(h);
    const answered = await captureReplay(h, "pilot", async () => {
      await h.advance(2);
      return h.frame();
    });
    assertGreaterThan(answered, 0, "a capture hands the scenario's value back");
    await captureStill(h, "pilot");
  });
});
