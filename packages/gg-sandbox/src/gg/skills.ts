/**
 * Read the skills available to this session.
 *
 * A skill name is a plain string. The names on offer are listed in the system prompt, and an unknown
 * one comes back as `not-found` carrying the list of the ones that exist.
 */

import * as raw from "test-cabinet:gg/skills";
import { call } from "../internal/errors.js";

/**
 * Read a skill by name, returning its body with the front matter stripped.
 *
 * The body is pinned permanently into the context window.
 *
 * A skill may carry code as well as, or instead of, prose. Reading one makes its module importable
 * by every later program and opens a documentation view of each function the module declares, which
 * states the line that imports it. Nothing about the module is added to this reply. An on-use script
 * runs after the program has ended, on every read, and whatever it shows arrives on the next turn.
 *
 * @ggop skills.read_skill
 * @param name The skill's name, as the system prompt lists it.
 * @returns the skill's body, with its front matter stripped.
 * @throws `ApiError` with `not-found` — listing the skills that do exist — when the name is
 * unknown.
 */
export function readSkill(name: string): string {
  return call(() => raw.readSkill(name));
}
