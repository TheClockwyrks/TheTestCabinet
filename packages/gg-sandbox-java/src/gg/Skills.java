package gg;

import gg.internal.Wire;
import org.teavm.jso.JSObject;

/**
 * The {@code skills} object: the authored skill library.
 *
 * <p>A skill name is a plain {@link String} rather than an enum constant, because the catalogue is
 * per run while this SDK is compiled once. The names available are listed in the system prompt,
 * and an unknown one comes back as {@code NOT_FOUND} carrying the full list.
 */
public final class Skills extends ApiObject {
    Skills() {
        super("skills");
    }

    @Override
    JSObject target() {
        return Wire.skills();
    }

    /**
     * Read a skill by name and hand back its body with the front matter stripped; reading it also
     * pins that body permanently into your context, so a skill you have read stays read.
     *
     * <p>A skill may be <b>code</b> rather than prose, or as well as it. If it carries code,
     * reading it binds that code at {@code lib.<key>} for the rest of your session and the reply
     * names the key and what it exports — reach it with {@link Lib}. If it carries an on-use
     * script, gg runs it once your program has ended, and whatever it shows you arrives on your
     * next turn.
     *
     * @param name The skill's name, as the system prompt lists it.
     * @return the skill's body, with its front matter stripped
     * @throws ToolError {@code NOT_FOUND} — listing the skills that do exist — when the name is
     *     unknown.
     */
    public String readSkill(String name) {
        return Wire.asString(Wire.call("read_skill", target(), object(), "readSkill",
                Wire.args(Wire.text(name))));
    }
}
