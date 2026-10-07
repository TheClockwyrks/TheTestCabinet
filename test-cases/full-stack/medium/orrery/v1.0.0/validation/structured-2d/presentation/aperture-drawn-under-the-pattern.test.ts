// presentation/aperture-drawn-under-the-pattern — the aperture goes down first and
// the pattern the hex is asking for is painted over it.
//
// THE RULE, stated under `specs/assets.md`'s sheet table: "Each rise and each set on
// the field draws frame `floor(state.simTime / APERTURE_FRAME_TIME) mod
// APERTURE_FRAMES` of its own sheet, centered on its anchor hex, UNDER THE PATTERN
// THE BUILD DRAWS IN CODE, so both apertures turn continuously." What that pattern
// is, and that it is the build's own drawing rather than a produced file, is
// `specs/assets.md`'s "What stays drawn in code" table: "The reagent pattern a rise
// shows and the product pattern a set shows | `specs/parts.md`". `specs/parts.md`
// requires it to be there: "A rise shows its reagent's pattern and a set shows its
// product's pattern."
//
// WHAT "UNDER" IS READ AS. A frame's operations are an ordered list and a canvas
// composites in that order, so what is drawn LATER sits on top. The reading is
// therefore positional: find where in the frame's operations the aperture sprite
// was drawn on the anchor hex, and require that the hex is drawn INTO again
// afterwards. A build that painted its pattern and then covered it with the
// aperture frame has every one of the hex's own marks before that draw, and fails.
//
// THE RADIUS IS `MOTE_R` (`22`), the figure `specs/field.md` fixes as the radius a
// mote's drawn form stays inside, which is the mark a one-mote reagent pattern is
// asking the hex for. It is comfortably inside the hex — a hex's corner stands
// `HEX_PITCH / sqrt(3)` (about `27.7`) out — so the chrome of the cell's own
// outline is not counted as the pattern.
//
// WHAT IS NOT READ. How a build draws a reagent pattern is the build's: a filled
// disc, a ring, a glyph, a letter. So the check counts OPERATIONS THAT LAND ON THE
// HEX rather than looking for a shape, which is the same reading `drawing.ts` is
// built for and holds "whatever shape the build chose to draw it as".
//
// THE WORLD IS ONE RISE IN THE EDITOR, on `BARE`, whose reagent is a single `sol`
// on `(0, 0)`: a one-hex pattern, so the hex the pattern is asking for and the hex
// the aperture is centered on are the same hex, and no other part is placed to draw
// anything near it.
//
// THE VERDICT. The anchor hex carries one aperture frame, and at least one drawing
// operation lands inside `MOTE_R` of that hex's centre after the aperture was
// drawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { APERTURE_SPRITE_SIZE, MOTE_R } from "../constants";
import { distance, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  apply,
  captureStill,
  createHarness,
  imageRef,
  numbers,
  openChallengeDocument,
  placeRise,
  walk,
  type Harness,
  type Point,
} from "../harness";

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

/** One recorded drawing operation: where it landed, and what it drew there. */
interface Landed {
  /** Its position among the frame's drawing operations, in order. */
  index: number;
  /** Where it landed, in stage units. */
  at: Point;
  /** The natural width of the source, for an image draw; `0` for a shape. */
  canvas: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the rise's pattern onto the hex after the aperture frame", async () => {
  await openChallengeDocument(h, BARE);
  const rise = await placeRise(h, 0, ORIGIN, 0);

  await h.advance(1);
  await captureStill(h, "layers");

  const posed = await h.snapshot();
  assertLength(
    posed.editor.parts,
    1,
    "the machine is one rise and nothing else",
  );
  assertEqual(
    posed.challenge?.reagents[0]?.motes.length,
    1,
    "BARE's reagent is one mote, so the pattern and the aperture share one hex",
  );
  assertEqual(
    posed.editor.parts[0]?.id,
    rise,
    "and that part is the rise placed above",
  );

  // Every drawing operation of the frame that landed on the anchor hex, in order.
  // An image draw is placed by its CENTRE, which is where `specs/assets.md` puts a
  // sprite; every other operation is placed by the point it names.
  const centre = hexCenter(ORIGIN);
  const landed: Landed[] = [];
  let index = 0;
  walk(await h.lastCalls(), (method, args, current) => {
    const at: Point | null = ((): Point | null => {
      if (method === "drawImage") {
        const image = imageRef(args[0]);
        if (image === null) return null;
        const named =
          args.length >= 9
            ? numbers(args.slice(5), 4)
            : args.length >= 5
              ? numbers(args.slice(1), 4)
              : null;
        const plain = named === null ? numbers(args.slice(1), 2) : null;
        const dx = named?.[0] ?? plain?.[0];
        const dy = named?.[1] ?? plain?.[1];
        if (dx === undefined || dy === undefined) return null;
        const dw = named?.[2] ?? image.width;
        const dh = named?.[3] ?? image.height;
        const near = apply(current, dx, dy);
        const far = apply(current, dx + dw, dy + dh);
        return { x: (near.x + far.x) / 2, y: (near.y + far.y) / 2 };
      }
      const pair = numbers(args, 2);
      return pair === null
        ? null
        : apply(current, pair[0] as number, pair[1] as number);
    })();
    const canvas = method === "drawImage" ? (imageRef(args[0])?.width ?? 0) : 0;
    index += 1;
    if (at !== null) landed.push({ index, at, canvas });
  });

  const apertures = landed.filter(
    (op) =>
      op.canvas === APERTURE_SPRITE_SIZE && distance(op.at, centre) <= ON_POINT,
  );
  assertLength(
    apertures,
    1,
    "the rise draws one aperture frame, centered on its anchor hex",
  );
  const aperture = apertures[0]?.index ?? -1;

  const over = landed.filter(
    (op) => op.index > aperture && distance(op.at, centre) <= MOTE_R,
  );
  assertGreaterThan(
    over.length,
    0,
    "the reagent pattern is composited OVER the aperture frame, so the hex is " +
      "drawn into again after the aperture goes down — an aperture drawn last " +
      "would hide the pattern the hex is asking for",
  );
});
