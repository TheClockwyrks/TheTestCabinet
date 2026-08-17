package gg.skills;

import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Coding;
import gg.internal.Value;

/**
 * Read the authored skills this run offers.
 *
 * <p>A skill is a procedure somebody wrote down. The ones a run offers are named in the system
 * prompt, and reading one pins it into the session permanently.
 *
 * @ggmodule skills
 */
public final class Skills {
    private Skills() {
    }

    /**
     * Read an authored skill by name, its front matter stripped.
     *
     * <p>The skill is also pinned permanently into the session's context, so it survives a
     * compaction and never has to be read twice. A skill that carries code binds that code at
     * {@code lib.<name>} for every later program, and a skill that carries an on-use script has it
     * run once the program ends, with whatever it shows arriving on the next turn.
     *
     * @param name The skill's name, exactly as the system prompt lists it.
     * @return the skill's body, with its front matter stripped
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND}, listing the skills this run does have, for
     *     a name none of them has.
     * @ggop skills.read_skill
     */
    public static String readSkill(String name) {
        return Coding.call("skills.read_skill", Value.of(name)).text();
    }
}
