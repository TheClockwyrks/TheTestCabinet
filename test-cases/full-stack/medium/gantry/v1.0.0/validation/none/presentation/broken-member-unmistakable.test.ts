// presentation/broken-member-unmistakable — a member that breaks stops being
// drawn as an intact one.
//
// specs/overview.md, "Visual design", the row for utilization: "While the tape
// runs, each member's color reads its utilization on a monotone ramp from slack
// to its limit, a member at breaking point stands out, and a broken member is
// unmistakable." specs/statics.md, "Utilization and breakage": "every member
// whose utilization exceeds `1` breaks: all of them are removed at once,
// permanently for the rest of the run, and they join the run's list of broken
// members in ascending member-id order."
//
// WHICH LEAVES THE BUILD TWO ANSWERS AND ASKS FOR EITHER. A broken member may
// leave the drawing altogether or be drawn in a broken state; what the
// specification fixes is that it is unmistakable, so what is on screen where it
// stood does not go on looking like an intact member. That is the reading: the
// frame on the tick before the break and the frame on the tick after, compared
// along the segment where the build's own `project` puts the member that
// `run.broken` names.
//
// THE CONTROL IS AN INTACT MEMBER DRAWN WELL CLEAR OF IT. Two frames a tick apart
// differ wherever anything moved, so the control is what says the change is this
// member's: the member the run still carries, furthest from the broken one on the
// stage, has to stand as it was. A build that repainted the yard, or that lost
// the whole structure from the picture, answers the first half and fails here.
//
// NOTHING IN THE YARD MOVES. The yard is emptied — no loads, no obstacles — and
// the tape turns the `grip`, which specs/rigging.md says "turns the bare hook,
// visibly and to no other effect", at one degree a second: the run is live, the
// tape is not finished, and no axis carries the crane anywhere. So between the
// two frames the only thing that has happened in the yard is the break.
//
// THE CRANE IS THE SMALLEST ONE THAT STANDS with one of its four mast ties left
// out and a counterweight hung at the arm's tip, which puts a single member over
// its capacity on the run's first tick. Which member that is, this check does not
// say: it reads `run.broken`, which specs/state.md defines as "Member ids, in the
// order they broke".

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { GRIP_MAX_RATE, STAGE_H, STAGE_W } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type MemberView,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The mast tie left out, which is what puts one member over its capacity. */
const OMITTED = 16;

/** The crane: the smallest one that stands, one tie short, with ballast at the tip. */
const CRANE: CraneDesign = {
  ...MINIMAL_CRANE,
  members: MINIMAL_CRANE.members.filter((_member, index) => index !== OMITTED),
  counterweights: [[4, 4, 0]],
};

/**
 * The tape: turn the grip, slowly, a long way.
 *
 * A run needs a tape (`empty-program` refuses the start, specs/program.md), and
 * this is the one that changes nothing: the grip turns the bare hook and applies
 * "no force to anything" (specs/rigging.md), and a target this far off keeps the
 * step live for far longer than this check watches, so the run neither ends nor
 * moves the crane.
 */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 1 }] },
];

/** The camera: the start pose, drawn in close, so the crane fills the stage. */
const CAMERA = { yaw: 45, pitch: 30, dist: 20 } as const;

/** How many points are read along a member's projected segment. */
const SAMPLES = 10;

/** How many of them the broken member's drawing must part at. */
const NEEDED = 8;

/** How long a member's projected segment must be to be read, in pixels. */
const READABLE = 60;

/** How far from the broken member the control must stand, in pixels. */
const CLEAR = 60;

/** A change in the picture that is a thing being drawn, out of 441. */
const DREW = 50;

/** A difference small enough to be anti-aliasing rather than a drawing. */
const UNCHANGED = 25;

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */
//
// An engineless build draws the yard through WebGL, so nothing here reads pixels
// off a 2D context: what a check reads is the page's own composited frame, taken
// with `page.screenshot` — the same picture `h.capture` writes as the review
// item's evidence. The PNG goes back INTO the page to be decoded, because the
// page carries an image decoder and this process carries none.
//
// A point is addressed in LOGICAL STAGE UNITS, the units `project` answers in
// and the units `specs/overview.md` lays the stage out in, and the canvas's own
// box on the page is what turns one into the other: the stage is fitted into it
// at one uniform scale, centred, exactly as that file states.

/** A colour read off the frame, each channel 0-255. */
type Rgb = readonly [number, number, number];

/** One composited frame, read at logical stage points. */
interface Frame {
  at(x: number, y: number): Rgb;
}

/** How far apart two colours are, on the 0-441 (`sqrt(3) * 255`) scale. */
function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The picture on screen right now, as a colour lookup in stage units. */
async function readFrame(h: Harness): Promise<Frame> {
  const box = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as { x: number; y: number; width: number; height: number } | null;
  assertTrue(
    box !== null,
    "a <canvas> on the page for the build to draw the yard in",
  );
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await h.paintFrame();
  const shot = (await h.page.screenshot({ type: "png" })).toString("base64");
  const decoded = (await h.page.evaluate(async (png: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height);
    // Base64 rather than an array of numbers: a whole frame is two million
    // entries, and it is built in chunks because `String.fromCharCode` is
    // applied to its arguments and that many of them overflow the stack.
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < pixels.data.length; i += chunk) {
      binary += String.fromCharCode(...pixels.data.subarray(i, i + chunk));
    }
    return { width: image.width, height: image.height, b64: btoa(binary) };
  }, shot)) as { width: number; height: number; b64: string };
  const bytes = Buffer.from(decoded.b64, "base64");
  const fit = box as { x: number; y: number; width: number; height: number };
  const scale = Math.min(fit.width / STAGE_W, fit.height / STAGE_H);
  const originX = fit.x + (fit.width - STAGE_W * scale) / 2;
  const originY = fit.y + (fit.height - STAGE_H * scale) / 2;
  return {
    at(x, y) {
      const px = Math.round(originX + x * scale);
      const py = Math.round(originY + y * scale);
      if (px < 0 || py < 0 || px >= decoded.width || py >= decoded.height) {
        return [0, 0, 0];
      }
      const at = (py * decoded.width + px) * 4;
      return [bytes[at]!, bytes[at + 1]!, bytes[at + 2]!];
    },
  };
}
/** A member's projected segment, and the points read along it. */
interface Drawn {
  member: MemberView;
  a: { x: number; y: number };
  b: { x: number; y: number };
  along: { x: number; y: number }[];
}

/** How far a stage point lies from a segment. */
function toSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length),
        );
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes the picture where a broken member stood and leaves the rest of the crane alone", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, TAPE);
  await h.debug.setCamera(CAMERA.yaw, CAMERA.pitch, CAMERA.dist);

  const started = await startRun(h);
  assertTrue(
    started.run.broken.length === 0,
    "no member broken at the run's first tick, since nothing has ticked at " +
      "the call (specs/state.md)",
  );
  assertTrue(
    started.run.axes.grip.rate <= GRIP_MAX_RATE,
    "the grip command this tape carries to be one the editor accepts " +
      "(specs/program.md)",
  );

  // Where each member is drawn, from the build's own projection. Nothing turns
  // the arm, so this holds for both frames.
  const drawn: Drawn[] = [];
  for (const member of started.structure.members) {
    const a = await h.project(member.a.x, member.a.y, member.a.z);
    const b = await h.project(member.b.x, member.b.y, member.b.z);
    const onStage = (p: { x: number; y: number }): boolean =>
      p.x >= 0 && p.x < STAGE_W && p.y >= 0 && p.y < STAGE_H;
    if (!a.visible || !b.visible || !onStage(a) || !onStage(b)) continue;
    const along = Array.from({ length: SAMPLES }, (_unused, i) => {
      const t = (i + 0.5) / SAMPLES;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    });
    drawn.push({ member, a, b, along });
  }

  const before = await readFrame(h);
  const ticked = await runTicks(h, 1);
  const after = await readFrame(h);
  await h.capture("broken", "The frame after the break");

  assertGreaterThanOrEqual(
    ticked.run.broken.length,
    1,
    "a member to break on this run's first tick, since the posed crane " +
      "carries one past its capacity (specs/statics.md)",
  );

  // The broken member read is the one drawn longest, so the reading has the most
  // of the picture to stand on; the control is the intact member drawn furthest
  // from it.
  const gone = drawn
    .filter(({ member }) => ticked.run.broken.includes(member.id))
    .filter(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y) >= READABLE)
    .sort(
      (one, two) =>
        Math.hypot(two.b.x - two.a.x, two.b.y - two.a.y) -
        Math.hypot(one.b.x - one.a.x, one.b.y - one.a.y),
    );
  assertGreaterThanOrEqual(
    gone.length,
    1,
    `a broken member drawn at least ${READABLE} logical pixels long, which ` +
      "is what this check reads its drawing along",
  );
  const broken = gone[0]!;

  const controls = drawn
    .filter(({ member }) => !ticked.run.broken.includes(member.id))
    .filter(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y) >= READABLE)
    .map((candidate) => ({
      candidate,
      away: Math.min(
        ...candidate.along.map((point) => toSegment(point, broken.a, broken.b)),
      ),
    }))
    .sort((one, two) => two.away - one.away);
  assertGreaterThanOrEqual(
    controls.length,
    1,
    `an intact member drawn at least ${READABLE} logical pixels long to read ` +
      "as the control, which the crane still carries",
  );
  assertGreaterThanOrEqual(
    controls[0]!.away,
    CLEAR,
    `the control member to be drawn at least ${CLEAR} logical pixels clear of ` +
      "the broken one, so the two readings are of two different places",
  );
  const control = controls[0]!.candidate;

  const parted = broken.along.filter(
    (point) =>
      apart(before.at(point.x, point.y), after.at(point.x, point.y)) > DREW,
  ).length;
  assertGreaterThanOrEqual(
    parted,
    NEEDED,
    `${NEEDED} of the ${SAMPLES} points along member ${broken.member.id}'s ` +
      `projected segment — from (${broken.member.a.x}, ${broken.member.a.y}, ` +
      `${broken.member.a.z}) to (${broken.member.b.x}, ${broken.member.b.y}, ` +
      `${broken.member.b.z}), which run.broken names — to change on the tick ` +
      "it breaks, since a broken member is unmistakable (specs/overview.md)",
  );

  const disturbed = control.along.filter(
    (point) =>
      apart(before.at(point.x, point.y), after.at(point.x, point.y)) >
      UNCHANGED,
  ).length;
  assertLessThanOrEqual(
    disturbed,
    0,
    `member ${control.member.id}, which the run still carries and which is ` +
      "drawn clear of the broken one, to stand unchanged across the same " +
      "tick: it is the BROKEN member that stops being drawn as an intact one " +
      `(specs/overview.md); it changed at ${disturbed} of the ${SAMPLES} ` +
      "points read along it",
  );
});
