// presentation — reading the head's sprite frame by frame, for the two points
// about the bite. CASE-PROVIDED.
//
// NOT a `.test.ts`, so vitest never collects it. `presentation/bite-starts-on-eat`
// and `presentation/bite-returns-to-rest` both watch one thing over a stretch of
// frames — WHICH image the head's cell is being painted with — and they watch it
// from opposite ends, so the reading itself is written once here and each point
// asserts its own half.
//
// WHY THE HEAD CELL IS RE-READ EVERY FRAME. `specs/movement.md` keeps the snake
// moving through the bite: the bite "is drawn only; it changes no rule of the
// simulation and no timing", so the head is on a new cell every tick while the
// three frames play. The cell to read is therefore whatever cell the snapshot
// reports the head on at that frame, never the cell it started on.

import { spriteOnCell, type Harness } from "../harness";

/**
 * Run one frame and hand back the identity of the sprite painted on the head's
 * cell in it, or `null` if nothing blitted there.
 *
 * The snapshot is taken after the frame, so the cell read is the one the frame
 * drew: an update runs before the render inside a frame, and the state only
 * changes on a tick boundary.
 */
export async function headSprite(h: Harness): Promise<string | null> {
  const blits = await h.frameBlits();
  const head = h.snapshot().snake[0];
  return spriteOnCell(h, blits, head.col, head.row);
}
