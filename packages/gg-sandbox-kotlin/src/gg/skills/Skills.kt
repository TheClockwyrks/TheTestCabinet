/**
 * The authored skill library, read by name.
 *
 * A skill name is a plain [String] rather than an enum entry, because the catalogue is per run while
 * this SDK is compiled once. The system prompt lists the names available, and an unknown one comes
 * back as a failure carrying the full list.
 *
 * @ggmodule skills
 */
package gg.skills

import gg.core.ApiError
import gg.internal.ggCall
import gg.internal.ggText


/**
 * Read a skill by name, which also pins its body permanently into the context window.
 *
 * The body comes back with its front matter stripped, and a skill that has been read stays read.
 *
 * A skill may be code rather than prose, or as well as it. Code is bound at `lib.<key>` for every
 * later program this session writes, and the read opens a documentation view of each function the
 * module declares, which is where its names, its signatures and the line a program writes to reach it
 * are read. An on-use script runs on every read, once the turn's own program has ended, and whatever
 * it shows arrives on the next turn.
 *
 * @ggop skills.read_skill
 * @param name The skill's name, as the system prompt lists it.
 * @return the skill's body, with its front matter stripped
 * @throws ApiError `NOT_FOUND`, listing the skills that do exist, when the name is unknown.
 */
public fun readSkill(name: String): String =
    ggCall("skills.read_skill", ggText(name)).text()
