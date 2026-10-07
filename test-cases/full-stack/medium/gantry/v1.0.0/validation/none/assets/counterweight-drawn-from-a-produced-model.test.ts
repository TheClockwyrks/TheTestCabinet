// assets/counterweight-drawn-from-a-produced-model — the counterweight in the yard is the
// committed `counterweight` model, decoded and drawn.
//
// `specs/assets.md` opens with the whole of the requirement: the build "produces
// every model and sound the game uses with them, commits the produced files, and
// wires them in", each committed as `assets/models/<model>.glb` "under the model
// name the table below gives it", and "the name a file carries is what says which
// subject or which cue it is". Its § What is drawn in code draws the line from
// the other side: the yard, the aids, the members, the cable, the pads and every
// readout are the build's own geometry, and the eight models are not.
//
// THE READING IS WHAT THE FRAME DREW, NEVER THE PICTURE. `drawn()` reports one
// entry per thing the last frame put on screen, and a model's entry carries "the
// produced file its geometry came from, or `null` when the build drew it in code"
// (`specs/instrumentation.md`). So a counterweight drawn from the committed file and a
// counterweight the build drew as its own geometry are told apart by what the build
// says it drew them from, which is the fact the requirement is about.
//
// A COUNTERWEIGHT NEEDS A NODE THE STRUCTURE USES. `specs/structure.md` refuses
// one "on a node the structure does not use", so the world is one member and the
// block on its foot, and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

/** The subject, as `specs/assets.md` names its model. */
const SUBJECT = "counterweight";

const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the counterweight from the produced `counterweight` model", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.debug.setRing(0, 2, 0);
  // A counterweight goes on a node THE STRUCTURE USES — "A counterweight
  // placement is refused on a node the structure does not use"
  // (`specs/structure.md`) — so one member is placed first and the block goes on
  // its foot.
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.debug.addCounterweight(0, 0, 0);
  await h.advance(1);

  const drawn = await h.drawn();
  const models = entriesOf(drawn, "model", SUBJECT);

  await h.capture("counterweight", "A counterweight on its node");

  assertTrue(
    models.length > 0,
    `a \`${SUBJECT}\` model among what the frame drew — ` +
      `it drew ${drawn.filter((e) => e.kind === "model").length} model(s): ` +
      `${[...new Set(drawn.filter((e) => e.kind === "model").map((e) => e.name))].join(", ") || "none"}`,
  );
  assertEqual(
    models[0]!.source,
    `${SUBJECT}.glb`,
    `the produced file the ${SUBJECT} was drawn from (specs/assets.md)`,
  );
});
