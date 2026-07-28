/**
 * The `memories` family: durable notes that survive context compaction.
 *
 * A run picks one of three memory strategies, and only that strategy's functions are bound — so
 * `memory.list()` is the honest answer to "what can I do with memory here?". The scratchpad keeps
 * every memory in the context window (`writeMemory`/`updateMemory`); the two file-shaped strategies
 * keep the contents *outside* it (`createMemory`/`readMemory`/`editMemory`), one behind an index
 * that is always in context and one behind `searchMemories`. `deleteMemory` is bound under all
 * three.
 *
 * Every mutation returns the budget after it, so a program can decide whether to write another
 * memory by reading numbers rather than by parsing a sentence about them.
 */

import * as raw from "test-cabinet:gg/memories";
import { call } from "../errors.js";
import type { MemoryHit, MemoryUsage } from "../types.js";

/**
 * Record a durable memory that survives context compaction, and return how much of the memory
 * budget is now used. Throws `conflict` on a duplicate name and `limit-exceeded` when the body would
 * breach the run's caps — revise or delete a memory rather than accruing more.
 */
export function writeMemory(memory: {
  name: string;
  description: string;
  body: string;
}): MemoryUsage {
  return call(() => raw.writeMemory(memory));
}

/**
 * Replace an existing memory's description and body, keyed on its `name`, and return the memory
 * budget. Throws `not-found` when no memory has that name.
 */
export function updateMemory(memory: {
  name: string;
  description: string;
  body: string;
}): MemoryUsage {
  return call(() => raw.updateMemory(memory));
}

/**
 * Record a new memory whose contents are kept OUT of your context window until you read them, and
 * return the memory budget. Give it a slug (letters, digits, `-`, `_`, `.`), a one-line description
 * — required where the run keeps an index, since that is the memory's line in it — and the initial
 * contents. Throws `conflict` on a duplicate slug and `limit-exceeded` when the contents, or the
 * index entry, would breach a limit.
 */
export function createMemory(memory: {
  name: string;
  description: string;
  body: string;
}): MemoryUsage {
  return call(() => raw.createMemory(memory));
}

/**
 * Read one memory's full contents, by slug — the only thing that brings them into your context.
 * Throws `not-found` when no memory has that slug.
 */
export function readMemory(name: string): string {
  return call(() => raw.readMemory(name));
}

/**
 * Revise a memory in place by replacing the one exact occurrence of `search` with `replace`, and
 * return the memory budget. Append by quoting the last line and replacing it with itself plus what
 * you are adding. Throws `not-found` when the text does not appear, `conflict` when it appears more
 * than once, `limit-exceeded` when the result would be too long, and `invalid-argument` when the
 * edit would leave the memory empty — delete it instead.
 */
export function editMemory(edit: {
  name: string;
  search: string;
  replace: string;
}): MemoryUsage {
  return call(() => raw.editMemory(edit));
}

/**
 * Find the memories mentioning any of `keywords`, best first: plain case-insensitive substring
 * matching over each memory's slug, description and contents, ranked by how many of your keywords a
 * memory mentions and then by how often. Pass several specific words rather than one sentence, then
 * `readMemory` the hits worth having in full. Throws `invalid-argument` when every keyword is empty;
 * a search that matches nothing is an empty array.
 */
export function searchMemories(keywords: string[]): MemoryHit[] {
  return call(() => raw.searchMemories(keywords));
}

/**
 * Evict a memory by name, freeing room in the budget, and return what is left in use. Throws
 * `not-found` when no memory has that name.
 */
export function deleteMemory(name: string): MemoryUsage {
  return call(() => raw.deleteMemory(name));
}
