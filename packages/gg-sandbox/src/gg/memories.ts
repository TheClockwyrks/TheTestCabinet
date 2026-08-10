/**
 * Durable notes that survive a compaction of the context window.
 *
 * A run picks one of three memory strategies and binds only that strategy's functions. The scratchpad
 * keeps every memory in the window with `writeMemory` and `updateMemory`; the two file-shaped
 * strategies keep the contents outside it with `createMemory`, `readMemory` and `editMemory`, one
 * behind an index that is always in context and one behind `searchMemories`. `deleteMemory` is bound
 * under all three.
 *
 * Every mutation hands back the budget after it, so a program decides whether to write another memory
 * by reading numbers rather than by parsing a sentence about them.
 */

import * as raw from "test-cabinet:gg/memories";
import { call } from "../internal/errors.js";

/**
 * How much of the run's memory budget is used, after the call that returned it.
 *
 * Every maximum is optional, because each limit can be turned off and a run's memory strategy applies
 * only some of them. `undefined` means nothing bounds that axis, so it is worth checking before
 * subtracting.
 */
export interface MemoryUsage {
  /** Memories currently held. */
  count: number;

  /** The most memories this run allows, where it limits the count. */
  maxCount: number | undefined;

  /** Characters of body currently held, across every memory. */
  totalChars: number;

  /** The most characters of body this run allows in total, where it limits the aggregate. */
  maxTotalChars: number | undefined;

  /** Characters the memory index occupies, under a run that keeps one. */
  indexChars: number | undefined;

  /** The most characters the index may occupy, where it is limited. */
  maxIndexChars: number | undefined;
}

/** One memory `searchMemories` matched, and the numbers it was ranked by. */
export interface MemoryHit {
  /** The memory's slug, which is what `readMemory` takes. */
  name: string;

  /** Its description, or the empty string when it was created without one. */
  description: string;

  /** How many distinct keywords it matched, which is the primary ranking. */
  matched: number;

  /** How many times those keywords occur in it, which is the tiebreak. */
  occurrences: number;

  /** A short window of the memory around its first match. */
  excerpt: string;
}

/** One memory as a program writes it, with the two optional code halves every write accepts. */
export interface MemoryWrite {
  /**
   * The memory's slug: letters, digits, `-`, `_` and `.`.
   *
   * It is what every other memory call takes, and no two memories may share one.
   */
  name: string;

  /**
   * A one-line description of what the memory holds.
   *
   * Where the run keeps a memory index this is the memory's line in it, and so all that is visible of
   * the memory until it is read.
   */
  description: string;

  /** The memory's contents. */
  body: string;

  /**
   * A module whose exports are bound at `lib.<name>` for the rest of the session.
   *
   * It is written in the same language a program is. A helper got right once is then never written
   * again. Omit it, or pass an empty string, for a memory that is only prose. It occupies no context
   * window and counts against no body limit.
   */
  code?: string;

  /**
   * A script gg runs the first time the memory comes into use.
   *
   * Whatever it shows arrives on the next turn. Omit it, or pass an empty string, for a memory that
   * runs nothing.
   */
  onUse?: string;
}

/**
 * Normalise a written memory into the record the membrane declares.
 *
 * The two code fields are `option<string>` on the WIT, which crosses as a field that must be
 * *present* and may be `undefined` — so they are spelled explicitly here rather than left off the
 * object a program handed in. A blank string is normalised to absent: a model that clears its code by
 * writing `""` means "no code", and storing an empty module would bind an empty `lib` entry saying
 * nothing.
 *
 * @internal
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
 * Record a durable memory that survives a compaction, and hand back the budget it now occupies.
 *
 * A memory may carry **code** as well as prose. `code` is a module in the same language a program is,
 * whose exports are bound at `lib.<name>` in every later program, so a helper got right once is never
 * written again; `onUse` is a script gg runs the first time the memory comes into use, whose views
 * arrive on the next turn. Neither is context: they occupy no window, are never shown back, and count
 * against no body limit.
 *
 * Throws `ToolError` with `conflict` on a duplicate name, and `limit-exceeded` when the body would
 * breach the run's caps — revising or deleting a memory beats accruing more.
 *
 * @ggop memories.write_memory
 * @param memory The memory to record. Its name must not already be taken.
 */
export function writeMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.writeMemory(written(memory)));
}

/**
 * Replace an existing memory's description and body, keyed on its name.
 *
 * Its `code` and `onUse` are replaced too, so omitting them clears them.
 *
 * Throws `ToolError` with `not-found` when no memory has that name.
 *
 * @ggop memories.update_memory
 * @param memory The replacement, keyed on its `name`. Every other field replaces what the existing
 * memory held, and an omitted one clears it.
 */
export function updateMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.updateMemory(written(memory)));
}

/**
 * Record a memory whose contents stay out of the context window until they are read.
 *
 * The description is required where the run keeps an index, since that is the memory's line in it. A
 * memory created here may carry `code` and `onUse` exactly as one written to the scratchpad may.
 *
 * Throws `ToolError` with `conflict` on a duplicate slug, and `limit-exceeded` when the contents, or
 * the index entry, would breach a limit.
 *
 * @ggop memories.create_memory
 * @param memory The memory to record. Its body stays out of the context window until it is read, and
 * its name must not already be taken.
 */
export function createMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.createMemory(written(memory)));
}

/**
 * Read one memory's full contents by slug, which is the only thing that brings them into context.
 *
 * A memory carrying code loads that code as it is read: the reply names the `lib.<key>` it is bound
 * at, and it stays bound for the rest of the session.
 *
 * Throws `ToolError` with `not-found` when no memory has that slug.
 *
 * @ggop memories.read_memory
 * @param name The memory's slug.
 */
export function readMemory(name: string): string {
  return call(() => raw.readMemory(name));
}

/**
 * Revise a memory in place, replacing the one exact occurrence of some text with something else.
 *
 * Appending is done by quoting the last line and replacing it with itself plus what is being added.
 *
 * Throws `ToolError` with `not-found` when the text does not appear, `conflict` when it appears more
 * than once, `limit-exceeded` when the result would be too long, and `invalid-argument` when the edit
 * would leave the memory empty — deleting it is the way to empty it.
 *
 * @ggop memories.edit_memory
 * @param edit The revision to make.
 * @param edit.name The slug of the memory to revise.
 * @param edit.search The exact text to find in its contents. It must appear exactly once.
 * @param edit.replace The text to put in its place.
 */
export function editMemory(edit: { name: string; search: string; replace: string }): MemoryUsage {
  return call(() => raw.editMemory(edit));
}

/**
 * Find the memories mentioning any of some keywords, best first.
 *
 * Matching is plain case-insensitive substring matching over each memory's slug, description and
 * contents, ranked by how many distinct keywords a memory mentions and then by how often. Several
 * specific words rank better than one sentence; `readMemory` then reads the hits worth having whole.
 *
 * Throws `ToolError` with `invalid-argument` when every keyword is empty. A search that matches
 * nothing is an empty array.
 *
 * @ggop memories.search_memories
 * @param keywords The words to look for. Several specific words rank better than one sentence,
 * because a memory is ranked by how many of them it mentions.
 */
export function searchMemories(keywords: string[]): MemoryHit[] {
  return call(() => raw.searchMemories(keywords));
}

/**
 * Evict a memory by name, freeing room in the budget, and hand back what is left in use.
 *
 * Throws `ToolError` with `not-found` when no memory has that name.
 *
 * @ggop memories.delete_memory
 * @param name The memory's slug.
 */
export function deleteMemory(name: string): MemoryUsage {
  return call(() => raw.deleteMemory(name));
}
