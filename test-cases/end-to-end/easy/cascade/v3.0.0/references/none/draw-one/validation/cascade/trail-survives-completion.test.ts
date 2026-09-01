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
// THE TOLERANCE IS FOR THE MESSAGE AND FOR NOTHING ELSE. `specs/screens.md` puts
// `WIN_TEXT` over the painted table once the cascade is done, and the
// specification fixes neither its size nor its place, so some of the points
// painted a moment earlier are behind it. A message is drawn IN something, so
// those points are still not bare felt and mostly still count; a tenth of the
// grid is generous room for one that is drawn in a colour close to the table's.
// Everything else must still be painted.
//
// The cascade is the game's own, reached through its own win path, and the
// painting is left on — one of the three points in this group that keeps it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { DECK_SIZE } from "../constants";
import {
  type Harness,
  captureStill,
  createHarness,
  framesFor,
} from "../harness";
import {
  CASCADE_RUNOUT_SECONDS,
  openCascade,
  paintedFelt,
  readFelt,
} from "./flight";

/**
 * How much of the painted table must survive the end of the cascade.
 *
 * Nine tenths of the points painted while the last cards were still flying. The
 * missing tenth is room for the win message drawn over them, whose size and
 * place `specs/screens.md` leaves to the build.
 */
const SURVIVING_SHARE = 0.9;

/**
 * How far a painted point must sit from the bare table, out of 441.
 *
 * `specs/overview.md`'s legibility table requires that "a card of either face
 * reads apart from the table it sits on", which the case fixes as `90` of `441`
 * in `presentation/face-distinct-from-table`. The painted layer is made of cards
 * stamped onto the table, so that is the figure that says a point has been
 * painted, and it is applied identically to both readings.
 */
const PAINTED_APART = 90;

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
    { maxSeconds: CASCADE_RUNOUT_SECONDS, pollSeconds: 0.25 },
  );
  const before = await paintedFelt(
    harness,
    bare,
    PAINTED_APART,
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
  });
  assertEqual(
    done.hit,
    true,
    "the cascade to finish, so there is a finished table to read",
  );

  await harness.advance(SETTLE_FRAMES);
  await captureStill(harness, "painted");
  const after = await paintedFelt(harness, bare, PAINTED_APART, []);

  const survived = before.filter(
    (wasPainted, index) => wasPainted && after[index],
  ).length;
  assertGreaterThanOrEqual(
    survived / painted,
    SURVIVING_SHARE,
    `the share of the ${painted} painted points still painted a second after the cascade finished, and ${survived} of them were`,
  );
});
