// scoring.depth-scaling: a deeper maze holds MORE predators (one more per depth,
// capped at two of each — six total — by DEPTH 4) and a shorter sonar range, while
// predator SPEEDS do not change with depth.
//
// Both depth settings, and the moment each takes effect in the sim, are `act`, so the
// clip shows the roster and sonar recomputing across two depths. To evidence that
// speed does not scale, the same predator is posed to wander at each depth and its
// steady patrol speed is read back — it should be the same at both.
//
// A PULSE IS FIRED AT EACH DEPTH, for two reasons. The sonar range is most of what this
// item is about, and a clip in which no pulse is ever emitted shows a reviewer nothing of
// it — the two numbers change in the snapshot and nowhere on screen. And firing one turns
// the reported range into something the build has to act on: `snapshot.sonar.range` and
// the `range` a pulse actually carries are the same quantity (`E`, in tiles), so a build
// that reports the scaling correctly while flooding the same distance regardless is
// caught here rather than passing on its own bookkeeping.
import {
  startPlaying,
  findFarTile,
  pred,
  TICK,
  ticksFor,
} from "../_helpers.mjs";

/**
 * Fire the sonar and return the wavefront it put in flight, after letting it travel.
 *
 * The wavefront taken is the FRESHEST one — the forager pulse whose front has traveled
 * least. The two depths are read a second apart and a pulse outlives that, so the first
 * depth's front is still in the corridors when the second is fired; picking whichever
 * entry happened to be first in the list reads the old pulse's range and reports the
 * second depth as never having scaled.
 */
async function actPulse(api) {
  const freshest = (s) =>
    s.pulses
      .filter((p) => p.source === "forager")
      .sort((a, b) => a.front - b.front)[0] ?? null;
  const had = (await api.snapshot()).pulses.filter(
    (p) => p.source === "forager",
  ).length;
  await api.call("clearCooldowns");
  await api.call("press", "Space");
  const fired = await api.until(
    (s) => s.pulses.filter((p) => p.source === "forager").length > had,
    { max: ticksFor(0.5), poll: TICK },
  );
  const pulse = fired.hit ? freshest(fired.snap) : null;
  await api.advance(90); // 0.75 s of the front sweeping out through the corridors
  return pulse;
}

export default function item() {
  let s1;
  let s4;
  let count1;
  let count4;
  let speed1;
  let speed4;
  let pulse1;
  let pulse4;

  return {
    id: "scoring.depth-scaling",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      // Depth 1: the roster is one of each — three predators.
      await api.call("setDepth", 1);
      s1 = await api.snapshot();
      count1 = s1.predators.length;
      const far1 = findFarTile(s1, s1.forager, 8);
      await api.call("setPredator", "gloamfin", {
        tx: far1.tx,
        ty: far1.ty,
        mode: "wander",
      });
      await api.advance(30); // 30 ticks = 0.25 s: let it settle to its patrol speed
      speed1 = pred(await api.snapshot(), "gloamfin").speed;
      pulse1 = await actPulse(api);

      // Depth 4: the roster caps at two of each — six predators.
      await api.call("setDepth", 4);
      s4 = await api.snapshot();
      count4 = s4.predators.length;
      const far4 = findFarTile(s4, s4.forager, 8);
      await api.call("setPredator", "gloamfin", {
        tx: far4.tx,
        ty: far4.ty,
        mode: "wander",
      });
      await api.advance(30);
      speed4 = pred(await api.snapshot(), "gloamfin").speed;
      pulse4 = await actPulse(api);
    },

    async assert(api, check) {
      check.expectEq("depth 1 holds three predators (one of each)", count1, 3);
      check.expectEq("depth 4 holds six predators (two of each)", count4, 6);
      check.expectGt("a deeper maze holds more predators", count4, count1);
      check.expectClose(
        "sonar range is 9 tiles at depth 1",
        s1.sonar.range,
        9,
        1,
      );
      check.expectLt(
        "sonar range shrinks at greater depth",
        s4.sonar.range,
        s1.sonar.range,
      );
      check.expectGe("sonar range never drops below 5", s4.sonar.range, 5);
      check.expectClose(
        "predator speed does not change with depth",
        speed4,
        speed1,
        3,
      );
      check.expectOk("a pulse is emitted at depth 1", pulse1 !== null);
      check.expectOk("a pulse is emitted at depth 4", pulse4 !== null);
      if (!pulse1 || !pulse4) return;
      check.expectClose(
        "the pulse fired at depth 1 carries the range the HUD reports",
        pulse1.range,
        s1.sonar.range,
        0.5,
      );
      check.expectClose(
        "the pulse fired at depth 4 carries the shorter range that depth reports",
        pulse4.range,
        s4.sonar.range,
        0.5,
      );
    },
  };
}
