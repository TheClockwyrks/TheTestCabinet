/**
 * The `skills` family: the authored skill library.
 *
 * A skill name is a plain string rather than a union of the run's skills, because the catalogue is
 * per-run while this component is baked once. The names available are listed in the system prompt,
 * and an unknown one comes back as `not-found` carrying the full list.
 */

import * as raw from "test-cabinet:gg/skills";
import { call } from "../errors.js";

/**
 * Read an authored skill by name and return its body with the front matter stripped; reading it
 * also pins it permanently into your context, exactly as the native `read_skill` does. Throws
 * `not-found` — listing the skills that do exist — when the name is unknown.
 */
export function readSkill(name: string): string {
  return call(() => raw.readSkill(name));
}
