/**
 * The lowerings shared by two capability modules, and nothing a model reads.
 *
 * There is one: the membrane's `{ tag, val }` read variant, flattened into the discriminated
 * `FileRead` a program destructures. `gg.files.readFile` and `gg.views.openFile` perform the very
 * same host read and hand back the very same shape, so the flattening lives here rather than in
 * either of them — and here is outside `src/gg/`, which is what keeps it from being reflected into
 * the catalogue as a call nobody is offered.
 */

import type { FileReadRaw } from "test-cabinet:gg/files";
import type { FileRead } from "../gg/files.js";

/**
 * The membrane's tagged read, lowered onto the model-facing `FileRead`.
 *
 * The `u64` byte count is converted with `Number()` before it can reach a program. A `bigint` that
 * escapes is not a local nuisance: `JSON.stringify` throws on it, so one stray `bigint` anywhere in a
 * returned structure turns whatever it was folded into to nothing.
 */
export function asFileRead(read: FileReadRaw): FileRead {
  return read.tag === "text"
    ? { kind: "text", ...read.val }
    : { kind: "image", ...read.val, bytes: Number(read.val.bytes) };
}
