/**
 * The `files` family: reading, writing, editing and listing workspace files.
 *
 * Two lowering decisions live here. {@link asFileRead} flattens the membrane's `{ tag, val }` variant
 * into a `kind`-discriminated object a model can destructure directly — shared with `view.openFile`,
 * which performs the same read — and every `u64` — the byte count
 * `writeFile` returns, the size of a picture — is converted with `Number()` before it can reach a
 * program. A `bigint` that escapes is not a local nuisance: `JSON.stringify` throws on it, so one
 * stray `bigint` anywhere in a returned structure turns the program's entire result into `null`.
 */

import type { FileReadRaw } from "test-cabinet:gg/files";
import * as raw from "test-cabinet:gg/files";
import { U32_MAX, call, opts, uint } from "../errors.js";
import type { DirEntry, FileRead } from "../types.js";

/**
 * The membrane's `{ tag, val }` read variant, lowered to the model-facing `FileRead`.
 *
 * Exported so `view.openFile` — which performs the very same host read and returns the very same
 * shape — shares this one lowering rather than keeping a second copy of it. It is **not** a
 * catalogued export: nothing binds it into a program's scope and no prompt line describes it.
 */
export function asFileRead(read: FileReadRaw): FileRead {
  return read.tag === "text"
    ? { kind: "text", ...read.val }
    : { kind: "image", ...read.val, bytes: Number(read.val.bytes) };
}

/**
 * Read a workspace file, returning either `{ kind: "text", ... }` or `{ kind: "image", ... }` — the
 * format is detected from the file's bytes, never its extension, and an image's pixels are shown to
 * you rather than handed to your program. `offset` and `limit` select a window of lines and are
 * honoured only under a capped read policy. This gets bytes for your program and puts nothing in
 * your context window; `view.openFile` is the call that shows the file to you. Throws `not-found`
 * for a missing path and `invalid-argument` for one that escapes the workspace.
 */
export function readFile(
  path: string,
  options?: { offset?: number; limit?: number },
): FileRead {
  const o = opts<{ offset?: number; limit?: number }>("readFile", options);
  const offset = uint("readFile", "offset", o?.offset, U32_MAX);
  const limit = uint("readFile", "limit", o?.limit, U32_MAX);
  return asFileRead(call(() => raw.readFile(path, offset, limit)));
}

/**
 * Write UTF-8 text to a workspace file, creating parent directories and replacing any existing
 * file, and return the number of bytes written. Writing is the expensive direction of the sandbox —
 * rewriting more than a few dozen large files in one program exhausts its fuel budget, so split a
 * large rewrite across several turns.
 */
export function writeFile(path: string, contents: string): number {
  return Number(call(() => raw.writeFile(path, contents)));
}

/**
 * Replace the one exact occurrence of `oldString` in a workspace file with `newString`. Throws
 * `not-found` when the text does not appear and `conflict` — with the number of matches — when it
 * appears more than once; widen the surrounding context until the match is unique.
 */
export function editFile(path: string, oldString: string, newString: string): void {
  call(() => raw.editFile(path, oldString, newString));
}

/**
 * List a workspace directory, sorted by name; defaults to the workspace root. Each entry carries a
 * bare `name` — join it with the directory you listed — and its `kind`. An empty directory is an
 * empty array, not a failure.
 */
export function listDir(path?: string): DirEntry[] {
  return call(() => raw.listDir(path));
}
