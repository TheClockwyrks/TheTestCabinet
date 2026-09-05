// cascade/trail-survives-completion — the painted table stays once the cascade
// is done.
//
// specs/victory.md ends the cascade "once all fifty-two cards have launched and
// no card is in flight", and says of what follows: "the painted table stays
// behind that message". The layer is cleared by a new deal and by nothing else.
// So the pixels a cascade painted are still painted after `cascadeDone`, and a
// build that wipes the table when the last card leaves fails here.
//
// THE SAME POINTS ARE READ TWICE, ONCE NEAR THE END AND ONCE AFTER IT. The grid
// painted while the last cards were still in the air is the set the second
// reading is checked against, so what is compared is the table against its own
// earlier self rather than against any absolute figure — the specification fixes
// no coverage, and could not, because what a cascade covers depends on the launch
// velocities the seeded generator drew.
//
// EVERY POINT IS READ AGAINST ITSELF. The grid is sampled before a single card
// has launched, and a point counts as painted when IT has moved from the colour it
// held then — so a build whose felt carries a gradient or a texture, which
// `specs/overview.md` leaves it free to do, reads nothing painted until something
// paints.
//
// BOTH READINGS ARE OF THE LAYER AND NOT OF THE CARDS. `paintedFelt` samples only
// the band of the table `specs/table.md` leaves empty on the `won` screen and
// excludes the points under the cards the snapshot reports in flight, so the first
// reading cannot count a card that was about to leave as paint that ought to have
// survived. By the second reading the flight is empty, so there is nothing to
// exclude.
//
// EVERY PAINTED POINT MUST SURVIVE, WITH NO SHARE AND NO FLOOR. A point counts as
// painted when it reads differently from its own bare reading, so a point the win
// message covers is still not bare felt and still counts: `specs/screens.md` puts
// `WIN_TEXT` over the painted table, and a message is drawn IN something. So the
// second reading admits no exception, and how far anything reads from anything is
// the reviewer's.
//
// AND `trailStamps` IS READ ALONGSIDE THE PIXELS. `specs/state.md` counts the
// stamps the layer holds since it was last cleared, and `specs/instrumentation.md`
// has only `clearTrail()` and `reset()` zero it, so a build that stopped drawing
// the layer while leaving the counter alone is caught by the pixels and a build
// that quietly cleared it is caught by the counter. Both are asserted across the
// frames after the cascade finished.
//
// The cascade is the game's own, reached through its own win path, and the
// painting is left on — one of the three points in this group that keeps it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  RUNOUT_HZ,
  captureStill,
  createHarness,
  framesFor,
  type Harness,
} from "../harness";
import {
  CASCADE_RUNOUT_SECONDS,
  openCascade,
  paintedFelt,
  readFelt,
} from "./flight";

/** How long the finished table is left standing before it is read again. */
const SETTLE_FRAMES = framesFor(1);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("keeps the painted table once cascadeDone is true", async () => {
  await openCascade(harness, { painting: true });

  await harness.debug.setLaunching(false);
  await harness.advance(1);
  const bare = await readFelt(harness);
  await harness.debug.setLaunching(true);

  // Near the end: every card launched and the last of them still in the air.
  await harness.skipUntil(
    (s) => s.cascadeDone || (s.launched >= DECK_SIZE && s.flyers.length <= 2),
    { maxSeconds: CASCADE_RUNOUT_SECONDS, pollSeconds: 0.25, hz: RUNOUT_HZ },
  );
  const before = await paintedFelt(
    harness,
    bare,
    (await harness.snapshot()).flyers,
  );
  const painted = before.filter(Boolean).length;
  assertGreaterThan(
    painted,
    0,
    "the cascade to have painted some of the table by the time its last cards were in the air, in sampled points",
  );

  const done = await harness.skipUntil((s) => s.cascadeDone, {
    maxSeconds: CASCADE_RUNOUT_SECONDS,
    pollSeconds: 0.25,
    hz: RUNOUT_HZ,
  });
  assertEqual(
    done.hit,
    true,
    "the cascade to finish, so there is a finished table to read",
  );

  const stamped = (await harness.snapshot()).trailStamps;
  await harness.advance(SETTLE_FRAMES);
  await captureStill(harness, "painted");
  const after = await paintedFelt(harness, bare, []);

  const lost = before.filter(
    (wasPainted, index) => wasPainted && !after[index],
  ).length;
  assertEqual(
    lost,
    0,
    `points of the ${painted} the cascade had painted that read as bare felt again a second after it finished — specs/victory.md keeps the painted table behind the win message, and only a new deal clears the layer`,
  );

  assertEqual(
    (await harness.snapshot()).trailStamps,
    stamped,
    `snapshot().trailStamps over the ${SETTLE_FRAMES} frames after cascadeDone became true — only clearTrail() and reset() zero it (specs/instrumentation.md)`,
  );
});
