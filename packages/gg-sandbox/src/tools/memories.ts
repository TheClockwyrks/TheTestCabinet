/**
 * The `memories` family: durable notes that survive context compaction.
 *
 * Every call returns the budget after it, so a program can decide whether to write another memory by
 * reading numbers rather than by parsing a sentence about them.
 */

import * as raw from "test-cabinet:gg/memories";
import { call } from "../errors.js";
import type { MemoryUsage } from "../types.js";

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
 * Evict a memory by name, freeing room in the budget, and return what is left in use. Throws
 * `not-found` when no memory has that name.
 */
export function deleteMemory(name: string): MemoryUsage {
  return call(() => raw.deleteMemory(name));
}
