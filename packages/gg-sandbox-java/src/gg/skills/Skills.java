package gg.skills;

import gg.FunctionSummary;
import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;

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
     * List the functions this module offers, each with a one-line summary.
     *
     * <p>Only the functions this run actually bound are returned, so the directory never names a
     * call a program cannot make. One function's full signature, argument descriptions and types
     * are opened as a view with {@code Views.openDocsView}.
     *
     * @return the functions this module really bound, each with its one-line summary
     * @ggmeta list
     */
    public static List<FunctionSummary> list() {
        return Read.functionSummaries(
                Wire.call("list", Wire.skills(), "skills", "list", Wire.args()));
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
        return Wire.asString(Wire.call("read_skill", Wire.skills(), "skills", "readSkill",
                Wire.args(Wire.text(name))));
    }
}
