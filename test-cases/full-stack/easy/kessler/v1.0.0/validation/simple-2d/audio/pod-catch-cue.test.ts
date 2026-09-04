// audio/pod-catch-cue — the pod-catch cue sounds once, on the tick a widen,
// multiball, shield, or pierce pod is caught.
//
// specs/pods.md: "In a tick where the pod's center radius moves from
// `prev_r > 196` to `new_r <= 196` with its center angle within the
// deflector's span ... the pod is caught. ... the `pod-catch` cue plays
// (`pod-catch-narrow` for a `narrow` pod), and the kind's effect applies."
// specs/assets.md ties the produced file to that event: "play a cue on its
// event". One catch, one play, on the catch's own tick — for each of the four
// kinds the item names; the narrow pod's own cue is its own item next door.
//
// THE DRIVES PROVE EACH CATCH. Each kind falls in its own isolated drive: the
// pod still falling after the lead ticks, gone on the crossing tick, and the
// kind's effect standing in the snapshot — the widen timer running, balls
// launched, the shield up, the pierce timer running — so what the cue is read
// against is a catch and not a stray removal.
//
// THE POSE CROSSES STRICTLY. A pod falls at 120 units per second, 2 units of
// radius per tick, so from radius 203 it reads 197 before the crossing tick
// and 195 after it — no reading lands on the 196 catch boundary. The pod
// falls at the deflector's center angle, dead-center in the span.
//
// THE WORLD IS ONE POD AND THE DEFLECTOR, per drive: isolate() empties the
// field and holds both driver switches, and spawnPod leaves the seeded
// generator where it stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { DEFLECTOR_START_ANGLE_DEG } from "../constants";
import {
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";
import type { KesslerSnapshot } from "../surface";
import { driveToEvent, type CueDrive } from "./cues";

/** The cue specs/pods.md has these four catches play. */
const CUE = "pod-catch";

/** The four kinds whose catch plays pod-catch rather than pod-catch-narrow. */
const KINDS = ["widen", "multiball", "shield", "pierce"] as const;

/** How each kind's applied effect shows in the snapshot after the catch. */
const APPLIED: Record<(typeof KINDS)[number], (s: KesslerSnapshot) => boolean> =
  {
    widen: (s) => s.effects.widenTicks > 0,
    multiball: (s) => s.balls.length > 0,
    shield: (s) => s.effects.shieldActive,
    pierce: (s) => s.effects.pierceTicks > 0,
  };

/** Posed start radius: 203 - 2 * 3 = 197 before the crossing tick, 195 after. */
const START_RADIUS = 203;

/** Ticks of plain falling before each catch, on which no cue may sound. */
const LEAD_TICKS = 3;

/** Ticks driven after each catch, so the clip holds the aftermath. */
const TRAIL_TICKS = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds pod-catch once, on the tick each of the four kinds is caught", async () => {
  const drives = await captureReplay(h, "catches", async () => {
    const driven: { kind: (typeof KINDS)[number]; drive: CueDrive }[] = [];
    for (const kind of KINDS) {
      isolate(h);
      spawnPodPolar(h, kind, START_RADIUS, DEFLECTOR_START_ANGLE_DEG);
      const cues = onCue(h);
      driven.push({
        kind,
        drive: await driveToEvent(h, cues, LEAD_TICKS, TRAIL_TICKS),
      });
    }
    return driven;
  });

  for (const { kind, drive } of drives) {
    // The drive reached the catch on the crossing tick and not before.
    assertLength(
      drive.before.pods,
      1,
      `the falling ${kind} pod after the lead ticks`,
    );
    assertLength(
      drive.after.pods,
      0,
      `pods after the crossing tick: the ${kind} pod was caught`,
    );
    assertTrue(
      APPLIED[kind](drive.after),
      `the ${kind} catch applied its effect on the crossing tick`,
    );

    assertLength(
      cuesNamed(drive.quiet, CUE),
      0,
      `${CUE} cues sounded while the ${kind} pod was still falling`,
    );
    assertLength(
      cuesNamed(drive.played, CUE),
      1,
      `${CUE} cues sounded by the end of the tick the ${kind} pod was caught on`,
    );
  }
});
