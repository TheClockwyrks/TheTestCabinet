/**
 * Durable notes that survive a compaction of the context window.
 *
 * Every mutation returns how much of the run's memory budget is used after it.
 */

import * as raw from "test-cabinet:gg/memories";
import { call } from "../internal/errors.js";

/**
 * How much of the run's memory budget is used, after the call that returned it.
 *
 * Every maximum is optional; `undefined` means nothing bounds that axis.
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

  /**
   * Read this hit's memory in full, with its slug already supplied.
   *
   * `gg.memories.readMemory` for the common case where the search result is in hand.
   *
   * @ggop memories.read_memory
   * @returns the memory's contents.
   * @throws `ApiError` with `not-found` when the memory has gone since the search ran.
   */
  read(): string;
}

/**
 * Dress a search hit in the method its own slug makes possible.
 *
 * The record crosses the membrane as data, so the method is attached here rather than declared on a
 * class: nothing in a program ever constructs a hit, and a constructible declaration would be one
 * inviting it to.
 *
 * @internal
 */
function hit(matched: raw.MemoryHit): MemoryHit {
  return {
    name: matched.name,
    description: matched.description,
    matched: matched.matched,
    occurrences: matched.occurrences,
    excerpt: matched.excerpt,
    read(): string {
      return readMemory(matched.name);
    },
  };
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
   * A module every later program may import, written in the same language a program is.
   *
   * Omit it, or pass an empty string, for a memory that is only prose. It occupies no context window
   * and counts against no body limit.
   */
  code?: string;

  /**
   * A script gg runs every time the memory comes into use.
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
 * writing `""` means "no code", and storing an empty module would offer one with nothing in it.
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
 * Record a durable memory that survives a compaction.
 *
 * A memory may carry code as well as prose. `code` is a module in the same language a program is,
 * importable by every later program; `onUse` is a script gg runs every time the memory comes into
 * use, whose views arrive on the next turn. Neither occupies the context window, neither is shown
 * back, and neither counts against a body limit.
 *
 * @ggop memories.write_memory
 * @param memory The memory to record. Its name must not already be taken.
 * @returns how much of the run's memory budget is used now that the memory is held.
 * @throws `ApiError` with `conflict` on a duplicate name, and `limit-exceeded` when the body would
 * breach the run's caps.
 */
export function writeMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.writeMemory(written(memory)));
}

/**
 * Replace an existing memory's description and body, keyed on its name.
 *
 * Its `code` and `onUse` are replaced too, so omitting them clears them.
 *
 * @ggop memories.update_memory
 * @param memory The replacement, keyed on its `name`. Every other field replaces what the existing
 * memory held, and an omitted one clears it.
 * @returns how much of the run's memory budget is used after the replacement.
 * @throws `ApiError` with `not-found` when no memory has that name, and `limit-exceeded` when the
 * replacement would breach the run's caps.
 */
export function updateMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.updateMemory(written(memory)));
}

/**
 * Record a memory whose contents stay out of the context window until they are read.
 *
 * The description is required where the run keeps a memory index, since that is the memory's line
 * in it. The memory may carry `code` and `onUse`.
 *
 * @ggop memories.create_memory
 * @param memory The memory to record. Its body stays out of the context window until it is read, and
 * its name must not already be taken.
 * @returns how much of the run's memory budget is used now that the memory is held.
 * @throws `ApiError` with `conflict` on a duplicate slug, and `limit-exceeded` when the contents,
 * or the index entry, would breach a limit.
 */
export function createMemory(memory: MemoryWrite): MemoryUsage {
  return call(() => raw.createMemory(written(memory)));
}

/**
 * Read one memory's full contents by slug, which is the only thing that brings them into context.
 *
 * A memory carrying code loads that code as it is read: its module is importable by every later
 * program, and a documentation view opens for each function the module declares.
 *
 * @ggop memories.read_memory
 * @param name The memory's slug.
 * @returns the memory's contents.
 * @throws `ApiError` with `not-found` when no memory has that slug.
 */
export function readMemory(name: string): string {
  return call(() => raw.readMemory(name));
}

/**
 * Revise a memory in place, replacing the one exact occurrence of some text with something else.
 *
 * @ggop memories.edit_memory
 * @param edit The revision to make.
 * @param edit.name The slug of the memory to revise.
 * @param edit.search The exact text to find in its contents. It must appear exactly once.
 * @param edit.replace The text to put in its place.
 * @returns how much of the run's memory budget is used after the revision.
 * @throws `ApiError` with `not-found` when the text does not appear, `conflict` when it appears
 * more than once, `limit-exceeded` when the result would be too long, and `invalid-argument` when
 * the edit would leave the memory empty.
 */
export function editMemory(edit: { name: string; search: string; replace: string }): MemoryUsage {
  return call(() => raw.editMemory(edit));
}

/**
 * Find the memories mentioning any of some keywords, best first.
 *
 * Matching is plain case-insensitive substring matching over each memory's slug, description and
 * contents, ranked by how many distinct keywords a memory mentions and then by how often.
 *
 * @ggop memories.search_memories
 * @param keywords The words to look for. A memory is ranked by how many of them it mentions.
 * @returns the memories that matched, best first, each with the numbers it was ranked by; empty
 * where nothing matched.
 * @throws `ApiError` with `invalid-argument` when every keyword is empty.
 */
export function searchMemories(keywords: string[]): MemoryHit[] {
  return call(() => raw.searchMemories(keywords).map(hit));
}

/**
 * Evict a memory by name, freeing the room it held in the budget.
 *
 * @ggop memories.delete_memory
 * @param name The memory's slug.
 * @returns how much of the run's memory budget is left in use once it has gone.
 * @throws `ApiError` with `not-found` when no memory has that name.
 */
export function deleteMemory(name: string): MemoryUsage {
  return call(() => raw.deleteMemory(name));
}
