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

/** One memory as a program writes it, with the two optional code halves every write accepts. */
interface MemoryWrite {
  /**
   * The memory's slug: letters, digits, `-`, `_` and `.`. It is what every other memory call takes,
   * and no two memories may share one.
   */
  name: string;
  /**
   * A one-line description of what the memory holds. Where the run keeps a memory index this is the
   * memory's line in it, and so all you see of the memory until you read it.
   */
  description: string;
  /** The memory's contents. */
  body: string;
  /**
   * A TypeScript module whose exports are bound at `lib.<name>` for the rest of your session, so a
   * helper you get right once you never write again. Omit it, or pass an empty string, for a memory
   * that is only prose. It costs you no context window and counts against no body limit.
   */
  code?: string;
  /**
   * A script gg runs the first time the memory comes into use; whatever it shows you arrives on
   * your next turn. Omit it, or pass an empty string, for a memory that runs nothing.
   */
  onUse?: string;
}

/**
 * Normalise a written memory into the record the membrane declares.
 *
 * The two code fields are `option<string>` on the WIT, which crosses as a field that must be
 * *present* and may be `undefined` — so they are spelled explicitly here rather than left off the
 * object a program handed in. A blank string is normalised to absent: a model that clears its code
 * by writing `""` means "no code", and storing an empty module would bind an empty `lib` entry
 * saying nothing.
 */
function written(memory: MemoryWrite): raw.MemoryInput {
  const some = (value: string | undefined): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value : undefined;
  return {
    name: memory.name,
    description: memory.description,
    body: memory.body,
    code: some(memory.code),
    onUse: some(memory.onUse),
  };
}

/**
 * Record a durable memory that survives context compaction, and return how much of the memory
 * budget is now used. Throws `conflict` on a duplicate name and `limit-exceeded` when the body would
 * breach the run's caps — revise or delete a memory rather than accruing more.
 *
 * A memory may also carry **code**. `code` is a TypeScript module whose exports are bound at
 * `lib.<name>` in every later program you write, so a helper you get right once you never write
 * again; `onUse` is a script gg runs the first time the memory comes into use, whose views reach you
 * on your next turn. Neither is context — they cost you no window, are never shown back to you, and
 * count against no body limit — and both are bounded on their own.
 *
 * @param memory The memory to record. Its name must not already be taken.
 */
export function writeMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.writeMemory(written(memory)));
}

/**
 * Replace an existing memory's description and body, keyed on its `name`, and return the memory
 * budget. Its `code` and `onUse` are replaced too — omitting them clears them. Throws `not-found`
 * when no memory has that name.
 *
 * @param memory The replacement, keyed on its `name`. Every other field replaces what the existing
 * memory held, and an omitted one clears it.
 */
export function updateMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.updateMemory(written(memory)));
}

/**
 * Record a new memory whose contents are kept OUT of your context window until you read them, and
 * return the memory budget. Give it a slug (letters, digits, `-`, `_`, `.`), a one-line description
 * — required where the run keeps an index, since that is the memory's line in it — and the initial
 * contents. It may also carry `code` (a module bound at `lib.<name>` once you read the memory) and
 * `onUse` (a script run on that first read). Throws `conflict` on a duplicate slug and
 * `limit-exceeded` when the contents, or the index entry, would breach a limit.
 *
 * @param memory The memory to record. Its `body` stays out of your context window until you read
 * it, and its name must not already be taken.
 */
export function createMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.createMemory(written(memory)));
}

/**
 * Read one memory's full contents, by slug — the only thing that brings them into your context. If
 * the memory carries code, reading it also loads that code: the reply names the `lib.<key>` it is
 * bound at, and it stays bound for the rest of your session. Throws `not-found` when no memory has
 * that slug.
 *
 * @param name The memory's slug.
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
 *
 * @param edit The revision to make.
 * @param edit.name The slug of the memory to revise.
 * @param edit.search The exact text to find in its contents. It must appear exactly once.
 * @param edit.replace The text to put in its place.
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
 *
 * @param keywords The words to look for. Several specific words rank better than one sentence,
 * because a memory is ranked by how many of them it mentions.
 */
export function searchMemories(keywords: string[]): MemoryHit[] {
  return call(() => raw.searchMemories(keywords));
}

/**
 * Evict a memory by name, freeing room in the budget, and return what is left in use. Throws
 * `not-found` when no memory has that name.
 *
 * @param name The memory's slug.
 */
export function deleteMemory(name: string): MemoryUsage {
  return call(() => raw.deleteMemory(name));
}
