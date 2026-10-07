// Shatter — posing a torpedo, for the three `warhead` scripts in this group.
//
// GROUP-LOCAL and `warhead`-ONLY. `clearTorpedoes`, `removeTorpedo` and
// `setTorpedoHoming` are the three debug operations only a `warhead` checklist
// names (`variants/warhead.toml`), and their scripts live in this common
// directory beside the operations they belong with. Nothing a `base` build loads
// reaches this module.
//
// WHY IT GOES THROUGH `requireOp`. Every torpedo member of the surface is
// declared OPTIONAL in `surface.ts`, so one harness serves both workspaces —
// which leaves a check free to call one that is not there and crash on a
// `TypeError`. A crashed suite is reported as a build with no debug surface at
// all, which is a different and much worse verdict than the true one, so the
// operation is hard-asserted before it is driven and the failure names the
// operation and `specs/instrumentation.md`.

import { fail } from "../assert";
import { torpedoesOf, type Harness } from "../harness";
import { requireOp } from "../surface";

/**
 * One torpedo in flight at a logical field position on a heading, and its id.
 *
 * The id comes off the snapshot's last torpedo, which is where an added one
 * lands: `specs/instrumentation.md` has `addTorpedo` "Appended to `torpedoes`,
 * fresh id", on the same terms as every other entity the surface adds. A build
 * whose `addTorpedo` added nothing fails here, naming the operation.
 */
export function poseTorpedo(
  h: Harness,
  x: number,
  y: number,
  heading: number,
): number {
  requireOp(h.debug, "addTorpedo")(x, y, heading);
  const torpedoes = torpedoesOf(h.snapshot());
  if (torpedoes.length === 0) {
    fail(
      `addTorpedo(${x}, ${y}, ${heading}) to append a torpedo to the roster ` +
        "(specs/instrumentation.md)",
      "the torpedo roster is empty",
    );
  }
  return torpedoes[torpedoes.length - 1].id;
}
