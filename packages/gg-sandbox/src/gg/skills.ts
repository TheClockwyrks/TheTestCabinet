/**
 * Read the skills this agent was given.
 *
 * A skill name is a plain string rather than a union of the run's skills, because the catalogue is
 * per run while this component is baked once. The names on offer are listed in the system prompt, and
 * an unknown one comes back as `not-found` carrying the list of the ones that exist.
 */

import * as raw from "test-cabinet:gg/skills";
import { call } from "../internal/errors.js";

/**
 * Read a skill by name, returning its body with the front matter stripped.
 *
 * Reading pins that body permanently into the agent's context, so a skill once read stays read.
 *
 * A skill may be **code** rather than prose, or as well as it. Code is bound at `lib.<key>` for the
 * rest of the session and the reply names the key and what it exports. An on-use script runs once the
 * program has ended, and whatever it shows arrives on the next turn.
 *
 * @ggop skills.read_skill
 * @param name The skill's name, as the system prompt lists it.
 * @returns the skill's body, with its front matter stripped.
 * @throws `ToolError` with `not-found` — listing the skills that do exist — when the name is
 * unknown.
 */
export function readSkill(name: string): string {
  return call(() => raw.readSkill(name));
}
