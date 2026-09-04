// Orrery — the machine's own pieces (specs/assets.md "The sprites").
//
//   hub-arm.png       40 x 40  the arm hub, carried by arm/biarm/triarm/hexarm
//   hub-piston.png    40 x 40  the piston hub
//   gripper-open.png  32 x 32  a gripper with its jaws open
//   gripper-closed.png 32 x 32 the same gripper closed on what it holds
//   wheel-hub.png     48 x 48  the zodiac wheel's hub
//   fixture-mount.png 48 x 48  the cradle one fixture rides in
//
// Every one of these is drawn TURNED at run time — a hub to its first spoke, a
// gripper to that spoke's live angle, the wheel hub to the wheel's live
// rotation — so each is authored pointing EAST, along DIRS[0], and each
// carries a mark that says which way it is facing. The pairs are built to be
// told apart by silhouette rather than by detail: the arm hub is a round
// bearing plate and the piston hub a square sleeve with a barrel out its nose;
// the open gripper is a broken C and the closed one an unbroken O, a
// difference that survives all six spoke angles.

import { Raster, faded, polar, regular } from "./raster.mjs";
import { BRASS, NIGHT, STEEL } from "./palette.mjs";

/** HUB_SPRITE_SIZE. */
export const HUB_SIZE = 40;
/** GRIPPER_SPRITE_SIZE. */
export const GRIPPER_SIZE = 32;
/** WHEEL_SPRITE_SIZE, shared by the wheel hub and the fixture mount. */
export const WHEEL_SIZE = 48;

/** A ring of bolt heads at `r`, the brass fastening every piece shares. */
function bolts(g, cx, cy, r, count, size, first = -90) {
  for (let i = 0; i < count; i += 1) {
    const [x, y] = polar(cx, cy, r, first + (i * 360) / count);
    g.disc(x, y, size + 0.8, BRASS.shadow);
    g.disc(x, y, size, BRASS.pale);
    g.disc(x - size * 0.3, y - size * 0.3, size * 0.4, BRASS.high);
  }
}

/** The arm hub: a round bearing plate with a keyed nose along DIRS[0]. */
export function hubArm() {
  const g = new Raster(HUB_SIZE, HUB_SIZE);
  const c = HUB_SIZE / 2;
  // The nose, drawn first so the plate sits over its root.
  g.poly(
    [
      [c + 8, c - 6],
      [HUB_SIZE - 1, c - 3.4],
      [HUB_SIZE - 1, c + 3.4],
      [c + 8, c + 6],
    ],
    BRASS.dark,
  );
  g.poly(
    [
      [c + 9, c - 4.4],
      [HUB_SIZE - 2, c - 2.4],
      [HUB_SIZE - 2, c + 1],
      [c + 9, c + 3],
    ],
    BRASS.pale,
  );
  g.disc(c, c, 16, BRASS.shadow);
  g.poly(regular(c, c, 15.4, 8, -90 + 22.5), BRASS.mid);
  g.poly(regular(c, c, 13.6, 8, -90 + 22.5), BRASS.body);
  g.sector(c, c, 15.4, 13.6, 190, 350, BRASS.pale);
  bolts(g, c, c, 11.4, 8, 1.6);
  g.disc(c, c, 8.4, BRASS.dark);
  g.disc(c, c, 7, BRASS.lit);
  g.sector(c, c, 7, 5.2, 10, 160, BRASS.mid);
  g.disc(c, c, 3.4, BRASS.shadow);
  g.disc(c, c, 2.2, NIGHT.well);
  return g;
}

/** The piston hub: a square sleeve, banded, with a barrel out its nose. */
export function hubPiston() {
  const g = new Raster(HUB_SIZE, HUB_SIZE);
  const c = HUB_SIZE / 2;
  // The barrel the shaft telescopes out of, along DIRS[0].
  g.rect(c + 6, c - 6, 14, 12, BRASS.shadow);
  g.rect(c + 6, c - 5, 13, 10, BRASS.mid);
  g.rect(c + 6, c - 5, 13, 2, BRASS.pale);
  g.rect(HUB_SIZE - 4, c - 6.5, 3, 13, BRASS.dark);
  g.rect(HUB_SIZE - 4, c - 6.5, 3, 2, BRASS.high);
  // The sleeve body: a cut-cornered square, so the silhouette is not a disc.
  const body = [
    [c - 14, c - 9],
    [c - 9, c - 14],
    [c + 9, c - 14],
    [c + 14, c - 9],
    [c + 14, c + 9],
    [c + 9, c + 14],
    [c - 9, c + 14],
    [c - 14, c + 9],
  ];
  g.poly(body, BRASS.shadow);
  g.poly(
    body.map(([x, y]) => [c + (x - c) * 0.9, c + (y - c) * 0.9]),
    BRASS.mid,
  );
  // Three sleeve bands across the barrel's axis: the telescoping tell.
  for (const dy of [-7, -1, 5]) {
    g.rect(c - 13, c + dy, 26, 4, BRASS.body);
    g.rect(c - 13, c + dy, 26, 1, BRASS.pale);
    g.rect(c - 13, c + dy + 3, 26, 1, BRASS.shadow);
  }
  bolts(g, c, c, 11.6, 4, 1.5, -45);
  g.disc(c, c, 5.6, BRASS.dark);
  g.disc(c, c, 4.2, BRASS.lit);
  g.disc(c, c, 2.2, NIGHT.well);
  return g;
}

/**
 * A gripper. `closed` shuts the jaws into an unbroken ring around what the
 * gripper holds; open leaves a wide mouth toward DIRS[0] with the two jaw tips
 * splayed away from each other. The ring reads the same at every spoke angle,
 * which is what the bar asks for.
 */
function gripper(closed) {
  const g = new Raster(GRIPPER_SIZE, GRIPPER_SIZE);
  const c = GRIPPER_SIZE / 2;
  const mouth = closed ? 0 : 76;
  const from = mouth / 2;
  const span = 360 - mouth;
  // The shaft collar the arm meets the gripper at, opposite the mouth.
  g.sector(c, c, 15, 8, 148, 212, BRASS.shadow);
  g.sector(c, c, 14, 8.6, 152, 208, BRASS.mid);
  g.sector(c, c, 14, 12, 152, 208, BRASS.pale);
  // The jaw ring.
  const outer = closed ? 13.4 : 12.6;
  g.sector(c, c, outer, 8.6, from, from + span, BRASS.shadow);
  g.sector(
    c,
    c,
    outer - 1,
    9.4,
    from,
    from + span,
    closed ? BRASS.lit : BRASS.mid,
  );
  g.sector(
    c,
    c,
    outer - 1,
    outer - 2.6,
    from + 150,
    from + span - 20,
    BRASS.pale,
  );
  if (closed) {
    // The knuckle where the two tips have met: the "shut" tell.
    g.disc(c + 11.4, c, 4, BRASS.shadow);
    g.disc(c + 11.4, c, 2.8, BRASS.high);
    g.sector(c, c, 10.4, 8.8, -180, 180, faded(BRASS.dark, 0.85));
    for (const angle of [50, 130, 230, 310]) {
      const [x, y] = polar(c, c, 11.4, angle);
      g.disc(x, y, 1.5, BRASS.pale);
    }
  } else {
    // The tips, splayed outward past the mouth so the jaws read as thrown open.
    for (const side of [-1, 1]) {
      const at = side * from;
      const [x0, y0] = polar(c, c, 11, at);
      const [x1, y1] = polar(c, c, 15.2, at + side * 26);
      g.line(x0, y0, x1, y1, BRASS.shadow, 5);
      g.line(x0, y0, x1, y1, BRASS.mid, 3);
      g.disc(x1, y1, 1.8, BRASS.pale);
    }
    g.sector(c, c, 9.4, 8.4, from, from + span, faded(STEEL.mid, 0.5));
  }
  return g;
}

/** The gripper with its jaws open. */
export function gripperOpen() {
  return gripper(false);
}

/** The gripper closed on the constellation it holds. */
export function gripperClosed() {
  return gripper(true);
}

/** The zodiac wheel's hub: a toothed dial with six spokes out to its ring. */
export function wheelHub() {
  const g = new Raster(WHEEL_SIZE, WHEEL_SIZE);
  const c = WHEEL_SIZE / 2;
  // The toothed rim.
  for (let i = 0; i < 24; i += 1) {
    const angle = (i * 360) / 24;
    const [x, y] = polar(c, c, 21.2, angle);
    g.disc(x, y, 2, BRASS.shadow);
    g.disc(x, y, 1.3, BRASS.mid);
  }
  g.sector(c, c, 20.6, 16.8, -180, 180, BRASS.shadow);
  g.sector(c, c, 19.8, 17.4, -180, 180, BRASS.mid);
  g.sector(c, c, 19.8, 18.6, 190, 350, BRASS.pale);
  // Six spokes on the DIRS bearings, out to the fixture ring.
  for (let d = 0; d < 6; d += 1) {
    const angle = d * 60;
    const lead = d === 0;
    const [x, y] = polar(c, c, 18.4, angle);
    g.line(c, c, x, y, BRASS.shadow, lead ? 6.4 : 5);
    g.line(c, c, x, y, lead ? BRASS.pale : BRASS.body, lead ? 4 : 2.6);
    g.disc(x, y, 3, BRASS.shadow);
    g.disc(x, y, 2, lead ? BRASS.high : BRASS.lit);
  }
  // The engraved dial at the middle.
  g.disc(c, c, 8.4, BRASS.shadow);
  g.disc(c, c, 7.2, BRASS.mid);
  g.sector(c, c, 7.2, 6, 190, 350, BRASS.pale);
  const star = Array.from({ length: 12 }, (_, i) =>
    polar(c, c, i % 2 === 0 ? 6 : 2.6, -90 + i * 30),
  );
  g.poly(star, BRASS.dark);
  g.disc(c, c, 2.2, BRASS.high);
  return g;
}

/**
 * The fixture mount: the cradle a wheel's fixture rides in, drawn BENEATH the
 * mote sprite, so its middle stays clear and only the collar and the claws
 * that hold the mote show. That is what makes a fixture read as mounted on its
 * wheel rather than resting loose.
 */
export function fixtureMount() {
  const g = new Raster(WHEEL_SIZE, WHEEL_SIZE);
  const c = WHEEL_SIZE / 2;
  // Four claws reaching in over the mote's rim.
  for (const angle of [45, 135, 225, 315]) {
    const [x0, y0] = polar(c, c, 21, angle);
    const [x1, y1] = polar(c, c, 13.6, angle);
    g.line(x0, y0, x1, y1, BRASS.shadow, 7);
    g.line(x0, y0, x1, y1, BRASS.mid, 4.4);
    g.disc(x1, y1, 3, BRASS.shadow);
    g.disc(x1, y1, 2, BRASS.pale);
  }
  // The collar the claws are set into.
  g.sector(c, c, 22.6, 17.4, -180, 180, BRASS.shadow);
  g.sector(c, c, 21.8, 18.2, -180, 180, BRASS.mid);
  g.sector(c, c, 21.8, 20.2, 190, 350, BRASS.pale);
  g.sector(c, c, 18.6, 17.6, 10, 170, BRASS.dark);
  bolts(g, c, c, 20, 6, 1.5, -90);
  // A faint seat under the mote, so the cradle reads as holding something.
  g.sector(c, c, 17.4, 14.4, -180, 180, faded(BRASS.shadow, 0.55));
  return g;
}
