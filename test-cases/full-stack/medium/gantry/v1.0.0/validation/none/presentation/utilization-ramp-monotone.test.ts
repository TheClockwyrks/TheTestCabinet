// presentation/utilization-ramp-monotone — while the tape runs, each member's
// colour reads its utilization on one ramp.
//
// specs/overview.md, "Visual design", the row for utilization: "While the tape
// runs, each member's color reads its utilization on a monotone ramp from slack
// to its limit, a member at breaking point stands out, and a broken member is
// unmistakable." specs/statics.md, "Utilization and breakage": "Utilization is
// the readout the run screen colors members by (specs/ui.md)", and specs/ui.md's
// run screen carries "A legend for the utilization ramp (specs/overview.md), so
// the member coloring reads."
//
// ONE RAMP, THREE MEMBERS. The claim is not that any particular utilization is
// any particular colour — specs/overview.md leaves the palette to the build — but
// that the colours lie on ONE ramp, so a member's colour places it between two
// members it sits between in utilization. That is what is read: three members of
// the same crane, at three utilizations well apart, on one tick of one run. The
// middle one's colour has to be nearer each end than the two ends are to each
// other, which is what "on a ramp between them" means and is true of every ramp
// however it is coloured; and all three have to be far enough apart to read,
// because a ramp nobody can see the steps of is not a readout.
//
// THE THREE ARE CHOSEN BY WHAT THE RUN REPORTS, not written down here. The crane
// is posed, the run started, and `run.forces` — "the latest solve's, in member-id
// order, over the members still intact" — says what each member is carrying; the
// three read are the lowest of the candidates and then the next two at least
// `SEPARATION` above the one before. A validator that named three members and
// their utilizations would be asserting specs/statics.md's arithmetic, which
// belongs to another point.
//
// THE CANDIDATES ARE THE ARM'S LONG MEMBERS, which at this camera pose are drawn
// clear of one another across the upper half of the stage; the tower's are two
// units long and heaped inside one another around the slew ring, where no reading
// can say which member a pixel belongs to. Each colour is read as the biggest
// cluster of agreeing samples along the member, so a sample that landed on
// something crossing in front of it does not become the member's colour.
//
// NOTHING MOVES BUT THE TROLLEY. The tape drives the trolley out along the track,
// which loads the arm without turning it, so every member this point reads stands
// where the build screen drew it. The yard is emptied first: no loads, no
// obstacles, nothing on the hook.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan, assertTrue } from "../assert";
import { STAGE_H, STAGE_W, TROLLEY_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** Two counterweights on the arm, which is what spreads the members' loads. */
const COUNTERWEIGHTS: readonly (readonly [number, number, number])[] = [
  [4, 4, 0],
  [0, 8, 0],
];

/** The tape: drive the trolley to the track's far end, loading the arm. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 4, rate: TROLLEY_MAX_RATE }],
  },
];

/** How far into the run the colours are read, in ticks. */
const AT_TICK = 80;

/** The camera: the start pose, drawn in close, so the arm fills the stage. */
const CAMERA = { yaw: 45, pitch: 30, dist: 20 } as const;

/** The arm members this point may read: the long ones, drawn clear. */
const CANDIDATES: readonly (readonly [Vec3, Vec3])[] = [
  [
    { x: 2, y: 4, z: 0 },
    { x: 0, y: 8, z: 0 },
  ],
  [
    { x: 0, y: 8, z: 0 },
    { x: 4, y: 4, z: 0 },
  ],
  [
    { x: 2, y: 4, z: 2 },
    { x: 0, y: 8, z: 0 },
  ],
  [
    { x: 0, y: 4, z: 2 },
    { x: 0, y: 8, z: 0 },
  ],
];

/** How far apart in utilization the three read members must stand. */
const SEPARATION = 0.25;

/** How far apart two colours on the ramp must read, out of 441. */
const READS = 50;

/** How many points along a member are sampled for its colour. */
const SAMPLES = 5;

/** How near two samples must be to be the same colour, out of 441. */
const AGREES = 25;

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
/**
 * The colour a member is drawn in, read along its projected segment.
 *
 * `SAMPLES` points over the middle of the segment, and the answer is the mean of
 * the largest group of them that agree within `AGREES`. A member is drawn in one
 * colour along its length, so the samples that landed on it agree; a sample that
 * landed on something crossing in front of it does not join that group.
 */
function memberColour(
  frame: Frame,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rgb | null {
  const samples: Rgb[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const t = 0.3 + (0.4 * i) / (SAMPLES - 1);
    samples.push(frame.at(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
  }
  let best: Rgb[] = [];
  for (const sample of samples) {
    const group = samples.filter((other) => apart(sample, other) <= AGREES);
    if (group.length > best.length) best = group;
  }
  if (best.length * 2 <= SAMPLES) return null;
  return [
    best.reduce((sum, c) => sum + c[0], 0) / best.length,
    best.reduce((sum, c) => sum + c[1], 0) / best.length,
    best.reduce((sum, c) => sum + c[2], 0) / best.length,
  ];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("colours three members of one run onto a single utilization ramp", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, { ...MINIMAL_CRANE, counterweights: COUNTERWEIGHTS });
  await poseTape(h, TAPE);
  await h.debug.setCamera(CAMERA.yaw, CAMERA.pitch, CAMERA.dist);
  await startRun(h);
  const running = await runTicks(h, AT_TICK);
  assertTrue(
    running.run.phase === "running",
    `the run still in progress ${AT_TICK} ticks in, which is when this point ` +
      "reads the member colouring (specs/program.md)",
  );

  // What each candidate is carrying, and where it is drawn.
  const read: {
    load: number;
    a: { x: number; y: number };
    b: { x: number; y: number };
  }[] = [];
  for (const [from, to] of CANDIDATES) {
    const member = running.structure.members.find(
      (m) =>
        (m.a.x === from.x &&
          m.a.y === from.y &&
          m.a.z === from.z &&
          m.b.x === to.x &&
          m.b.y === to.y &&
          m.b.z === to.z) ||
        (m.b.x === from.x &&
          m.b.y === from.y &&
          m.b.z === from.z &&
          m.a.x === to.x &&
          m.a.y === to.y &&
          m.a.z === to.z),
    );
    assertTrue(
      member !== undefined,
      `the member between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ` +
        `${to.y}, ${to.z}) to stand in the posed crane (specs/structure.md)`,
    );
    const force = running.run.forces.find((f) => f.id === member!.id);
    assertTrue(
      force !== undefined,
      `a utilization reported for member ${member!.id}, which is intact, ` +
        "since run.forces carries every intact member (specs/statics.md)",
    );
    const a = await h.project(from.x, from.y, from.z);
    const b = await h.project(to.x, to.y, to.z);
    assertTrue(
      a.visible &&
        b.visible &&
        a.x >= 0 &&
        a.x < STAGE_W &&
        a.y >= 0 &&
        a.y < STAGE_H &&
        b.x >= 0 &&
        b.x < STAGE_W &&
        b.y >= 0 &&
        b.y < STAGE_H,
      `the member between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ` +
        `${to.y}, ${to.z}) to be drawn on the stage at this camera pose`,
    );
    read.push({ load: force!.utilization, a, b });
  }

  // The lowest, and then the next two at least SEPARATION above the one before.
  const ordered = [...read].sort((one, two) => one.load - two.load);
  const chosen = [ordered[0]!];
  for (const candidate of ordered) {
    if (candidate.load - chosen[chosen.length - 1]!.load >= SEPARATION) {
      chosen.push(candidate);
    }
  }
  assertTrue(
    chosen.length >= 3,
    `three of the crane's arm members at utilizations at least ` +
      `${SEPARATION} apart ${AT_TICK} ticks into this run, which is the ` +
      "spread this point reads a ramp over; the candidates carry " +
      `${ordered.map((c) => c.load.toFixed(3)).join(", ")}`,
  );
  const [low, middle, high] = chosen as [
    (typeof chosen)[0],
    (typeof chosen)[0],
    (typeof chosen)[0],
  ];

  const frame = await readFrame(h);
  await h.capture("ramp", "Three members at three utilizations");

  const colours = [low, middle, high].map((member) =>
    memberColour(frame, member.a, member.b),
  );
  for (const [index, colour] of colours.entries()) {
    assertTrue(
      colour !== null,
      `a colour read along the member carrying ` +
        `${[low, middle, high][index]!.load.toFixed(3)}, which the run screen ` +
        "colours by its utilization (specs/ui.md)",
    );
  }
  const [slack, between, loaded] = colours as [Rgb, Rgb, Rgb];

  const ends = apart(slack, loaded);
  const lower = apart(slack, between);
  const upper = apart(between, loaded);

  for (const [what, gap] of [
    [`${low.load.toFixed(2)} and ${middle.load.toFixed(2)}`, lower],
    [`${middle.load.toFixed(2)} and ${high.load.toFixed(2)}`, upper],
    [`${low.load.toFixed(2)} and ${high.load.toFixed(2)}`, ends],
  ] as const) {
    assertGreaterThan(
      gap,
      READS,
      `the members carrying ${what} to be drawn in colours a player can tell ` +
        "apart, since each member's colour reads its utilization on a ramp " +
        "from slack to its limit (specs/overview.md)",
    );
  }

  assertLessThan(
    lower,
    ends,
    `the member carrying ${middle.load.toFixed(2)} to be drawn nearer the one ` +
      `carrying ${low.load.toFixed(2)} than the two ends of the run are to ` +
      "each other, since it sits between them on one ramp (specs/overview.md)",
  );
  assertLessThan(
    upper,
    ends,
    `the member carrying ${middle.load.toFixed(2)} to be drawn nearer the one ` +
      `carrying ${high.load.toFixed(2)} than the two ends are to each other, ` +
      "since it sits between them on one ramp (specs/overview.md)",
  );
});
