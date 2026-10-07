// machinery/bore-radius — a bore clears every core within 90 units of the extraction point.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Bore"): "The **extraction point**
// is the field position the marked core held at the moment its run was
// extracted, and bore removes every core whose center lies within `BORE_RADIUS`
// of that point, measured as straight-line distance across the field." And ("The
// four kinds") `BORE_RADIUS` is 90. `specs/channel.md` ("The order of a tick")
// puts the bore after the removal that granted it: step 4, resolving "against
// the positions that removal left".
//
// HOW THE EXTRACTION IS DRIVEN. By a merge rather than by a shot, so nothing in
// the injector enters the reading. `specs/channel.md` ("Advance") rides every
// non-lead segment at 180 units/s against a lead segment on the level's 22, so
// the one segment that can close on another is the one directly behind the lead
// one. A single core of the run's charge is posed one unit further back than the
// channel spacing; on the first tick its advance carries it past the merge
// position, "the head is clamped to exactly that position" and the two become
// one — and `specs/extraction.md` ("Extraction on a merge") extracts the
// same-charge run spanning the join, three cores long here.
//
// WHY EVERY CORE IT MEASURES IS AHEAD OF THE REMOVAL. `specs/extraction.md`
// ("Removals and recoil"): "Every remaining core ahead of the frontmost core the
// removal took keeps its arc position." Every core this check reads is ahead of
// the extracted run, so neither the extraction's recoil nor the bore's own moves
// any of them, and each stands exactly where it was posed plus the arc the lead
// segment rode while the drive ran. That common advance is read back off the
// surviving head — which is 150 units from the extraction point and so beyond
// every reading here — rather than assumed, which is what makes the extraction
// point a measurement of the state on the tick it resolved rather than a
// prediction.
//
// WHY THE TRAIN TURNS THE CORNER. The cores of one segment stand a channel
// spacing apart, so on a straight leg only multiples of 28 are available and the
// nearest pair straddling 90 would be 84 and 112. Laid across the vertex at
// `(920, 40)` — `specs/channel.md`'s twelfth-vertex table, arc 880 — the same
// spacing gives straight-line distances of 55.6, 62.4 and 79.1 units inside the
// radius and 100.9 and 125.1 outside it, so the pair that decides the point sits
// 11 units either side of the bound instead of 26. The reading is a straight
// line across the field, exactly as the spec measures it, and not an arc
// distance.
//
// WHAT THIS CHECK DOES NOT DECIDE. `specs/machinery.md` ("The active machinery")
// also says "`bore` never becomes the active machinery and leaves the active
// machinery and its remaining time untouched". That is a separate requirement a
// build can miss on its own — a bore with a correct radius that evicts the timed
// machinery it resolved beside is a distinct defect — and it is graded by
// `machinery/bore-takes-no-slot`, which drives the same scenario with a choke
// running across it. This one reads the radius alone, over a hall carrying no
// timed machinery at all.
//
// THE TOLERANCE. None on the radius: each core is unambiguously inside or
// outside, by a margin of 11 units on the closest pair, and the check asserts
// presence rather than a distance. A core is matched to its posed arc position
// within the case's standing arc tolerance of 0.5 units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue } from "../assert";
import { ARC_TOL, BORE_RADIUS, SPACING, type ChargeId } from "../constants";
import {
  arcPositions,
  captureReplay,
  channelPoint,
  coreCount,
  createHarness,
  distance,
  poseHall,
  type Harness,
  type PosedCore,
} from "../harness";

/** The level the hall opens on; the bore's radius is the same on every level. */
const LEVEL = 1;

/** The charge the extracted run is made of. */
const RUN_CHARGE: ChargeId = "halide";

/** The arc position of the marked core: the tail of the lead segment. */
const MARKED_S = 824;

/**
 * The lead segment, head first and one channel spacing apart, laid across the
 * vertex at arc 880 so the straight-line distances are not multiples of 28.
 *
 * The two behind carry the run's charge; the rest alternate two others, so the
 * maximal same-charge run spanning the join is exactly three long.
 */
const LEAD: PosedCore[] = [
  [MARKED_S + SPACING * 7, "sulfur", null], // 1020 — 150.9 units out
  [MARKED_S + SPACING * 6, "cobalt", null], // 992 — 125.1 units out
  [MARKED_S + SPACING * 5, "sulfur", null], // 964 — 100.9 units out
  [MARKED_S + SPACING * 4, "cobalt", null], // 936 — 79.1 units out
  [MARKED_S + SPACING * 3, "sulfur", null], // 908 — 62.4 units out
  [MARKED_S + SPACING * 2, "cobalt", null], // 880 — 55.6 units out
  [MARKED_S + SPACING, RUN_CHARGE, null], // 852 — in the extracted run
  [MARKED_S, RUN_CHARGE, "bore"], // 824 — the marked core
];

/** The head of the lead segment, whose advance the drive reads back. */
const HEAD_S = LEAD[0][0];

/** How far behind the merge position the closing core starts. */
const CLOSING_GAP = 60;

/**
 * The core that closes the gap and completes the run.
 *
 * A segment behind the lead one rides 180 units/s (`specs/channel.md`,
 * "Advance") against a lead segment on the level's 22, so from 60 units further
 * back than the channel spacing it takes about 23 ticks to arrive — a run-up the
 * replay can show, and one the reading does not depend on, since the arc every
 * core rode while it closed is measured off the surviving head rather than
 * assumed.
 */
const CLOSER_S = MARKED_S - SPACING - CLOSING_GAP;

const CORES: PosedCore[] = [...LEAD, [CLOSER_S, RUN_CHARGE, null]];

/** Where the closing core stands once the merge has clamped it. */
const CLOSER_MERGED_S = MARKED_S - SPACING;

/**
 * How long the drive waits for the merge, in ticks.
 *
 * `specs/channel.md` fixes the closing rate — 180 units/s behind a lead segment
 * riding the level's 22 — so {@link CLOSING_GAP} closes in 60 / (180 - 22)
 * seconds, 22.8 ticks. The cap is over twice that, and it is also what keeps the
 * arrangement's margins honest: the lead segment rides while it closes, and the
 * further it rides past the vertex the closer the pair straddling the radius
 * comes to it. At the 22.8 ticks the spec's own rates give, the two sit 10.5 and
 * 12.2 units either side of 90; at the cap they still sit 9.0 and 15.2 units
 * either side, and every classification below is computed from the arc actually
 * ridden rather than from an assumed one.
 */
const MERGE_MAX_TICKS = 60;

/** Ticks recorded after the bore resolves, so the replay shows what it left. */
const TRAILING_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`clears every core within ${BORE_RADIUS} units of the extraction point and leaves the next one standing`, async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: CORES,
  });

  const swept = await captureReplay(h, "bore", async () => {
    const merged = await h.stepUntil((s) => coreCount(s) < CORES.length, {
      maxTicks: MERGE_MAX_TICKS,
      poll: 1,
    });
    await h.step(TRAILING_TICKS);
    return merged;
  });
  assertTrue(
    swept.hit,
    `the run holding the bore mark was extracted within ${MERGE_MAX_TICKS} ticks`,
  );

  // The whole lead segment rode the same arc while the drive ran, and its head is
  // far outside the radius, so what the head gained is what every core gained.
  const standing = arcPositions(swept.snapshot);
  const advance = Math.max(...standing) - HEAD_S;
  assertLessThan(
    Math.abs(advance),
    SPACING / 2,
    "the arc the surviving head rode, which identifies it as the core posed at the head",
  );

  const extraction = channelPoint(MARKED_S + advance);
  const posed: { s: number; label: string }[] = [
    ...LEAD.map(([s]) => ({ s, label: `posed at arc ${s}` })),
    { s: CLOSER_MERGED_S, label: "the core the merge brought in" },
  ];

  let expectedSurvivors = 0;
  for (const core of posed) {
    const at = core.s + advance;
    const away = distance(channelPoint(at), extraction);
    const present = standing.some((s) => Math.abs(s - at) <= ARC_TOL);
    const inside = away < BORE_RADIUS;
    if (!inside) expectedSurvivors += 1;
    assertEqual(
      present,
      !inside,
      `whether the core ${away.toFixed(1)} units from the extraction point (${core.label}) is still on the channel`,
    );
  }

  assertEqual(
    standing.length,
    expectedSurvivors,
    "the cores left standing once the extraction and its bore had resolved",
  );
});
