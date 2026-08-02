/**
 * The `view` object: the only way material enters an agent's own context window.
 *
 * These are not gg tools. No capability offers one, nothing dispatches one by name, and three of the
 * four are bound into **every** program's scope — the same carve-out `session` has, and for the same
 * reason: a run that enables no tools at all must still be able to show its model something.
 * Cataloguing them among the tools would break the `boundTools() == ALL_TOOL_NAMES` bijection the
 * committed component is checked against, so they have their own membrane interface, their own
 * {@link "../catalogue.js".VIEW_ENTRIES} array, and their own `view` object.
 *
 * **Why the object exists at all.** Under responses-as-code a whole program's output used to collapse
 * into one anonymous blob of logs, charged to one band, attributable to nothing and evictable by
 * nothing. A view restores what tool calling gave for free: one message per view, carrying the band
 * it is charged to and the selector it can be closed by. So `console.log` reaches the run's operator,
 * and a **view** reaches the model.
 *
 * **The `u64` rule this module obeys twice over.** A view's token cost crosses as a `bigint`, and a
 * `bigint` that escapes into a program poisons whatever it is folded into — `JSON.stringify` throws
 * on it, and logging is how a program shows anything to an operator. {@link current} converts at the
 * boundary, so nothing a program touches is ever a `bigint`.
 *
 * Every JSDoc block below is **model-facing**: `tools/signatures.mjs` reflects it into the signature
 * catalogue, and it is what `view.openText.docs()` answers with.
 */

import * as raw from "test-cabinet:gg/views";
import { U32_MAX, call, opts, uint } from "../errors.js";
import type { FileRead, OpenView } from "../types.js";
import { asFileRead } from "./files.js";

/**
 * Read a workspace file AND show it to yourself: you get back exactly what `fs.readFile` returns,
 * and the file also becomes its own item in your context window, attributed to its path and closable
 * by it.
 *
 * The split from `fs.readFile` is the point — `fs.readFile` gets bytes for your PROGRAM,
 * `view.openFile` shows a file to YOU — so a program that reads forty files to grep them still puts
 * nothing in your window. `offset` and `limit` select a window of lines, and two pages of one file
 * are two views that coexist; re-opening the SAME page replaces what it showed rather than piling up
 * a duplicate. An image file is shown to you as a picture.
 */
export function openFile(path: string, options?: { offset?: number; limit?: number }): FileRead {
  const o = opts<{ offset?: number; limit?: number }>("openFile", options);
  const offset = uint("openFile", "offset", o?.offset, U32_MAX);
  const limit = uint("openFile", "limit", o?.limit, U32_MAX);
  return asFileRead(call(() => raw.openFileView(path, offset, limit)));
}

/**
 * Show yourself a value your program computed, under `label` — a directory listing, a command's
 * output, a child agent's answer, a table you assembled. This is what replaced `console.log` as the
 * channel into your context: logs go to the run's operator, views come back to you on your next turn.
 *
 * Opening the same `label` again replaces what it showed, so a program may refine a view in a loop
 * without piling up a copy per iteration. An empty label is `invalid-argument` — a view with no
 * selector could never be closed or attributed — while an empty BODY is allowed, since it is how you
 * say that something you were showing is now empty. A body or label over gg's caps throws
 * `limit-exceeded` naming the cap; nothing is ever silently truncated.
 */
export function openText(label: string, body: string): void {
  call(() => raw.openTextView(label, body));
}

/**
 * Close every view carrying `selector` — for a file that is every page of that path, for a text view
 * the one with that label — and return how many were closed, freeing the tokens they occupied.
 *
 * Closing a selector that is not open returns `0` rather than failing, so a program that tidies up
 * unconditionally does not have to guard every call. Closing a file view forgets what you read, not
 * what exists; closing a text view discards the only copy of what it held, so write anything you
 * will need later to a file or a memory first.
 */
export function close(selector: string): number {
  // A `u32`, so already a `number` — the `bigint` conversion this module makes in `current` is not
  // needed here.
  return call(() => raw.closeView(selector));
}

/**
 * List what is open in your context window right now: each view's `kind`, the `selector` that closes
 * it, roughly what it costs you in `tokens`, and — for a paged file view — the `region` it covers.
 *
 * It is called `current` rather than `list` because every API object already carries a `list()` that
 * lists that object's own functions. Read it before deciding what to close when your window is
 * filling up.
 */
export function current(): OpenView[] {
  return call(() => raw.currentViews()).map((view) => ({
    kind: view.kind,
    selector: view.selector,
    tokens: Number(view.tokens),
    region: view.region,
  }));
}
