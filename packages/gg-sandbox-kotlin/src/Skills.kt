import org.teavm.jso.JSObject

/**
 * The `skills` object: the authored skill library.
 *
 * A skill name is a plain [String] rather than an enum entry, because the catalogue is per run while
 * this SDK is compiled once. The names available are listed in the system prompt, and an unknown one
 * comes back as `NOT_FOUND` carrying the full list.
 */
public class Skills internal constructor() : ApiObject("skills") {
    override fun target(): JSObject? = skillsObject()

    /**
     * Read a skill by name and hand back its body with the front matter stripped; reading it also pins
     * that body permanently into your context, so a skill you have read stays read.
     *
     * A skill may be **code** rather than prose, or as well as it. If it carries code, reading it binds
     * that code at `lib.<key>` for the rest of your session and the reply names the key and what it
     * exports — reach it with [Lib]. If it carries an on-use script, gg runs it once your program has
     * ended, and whatever it shows you arrives on your next turn.
     *
     * @param name The skill's name, as the system prompt lists it.
     * @return the skill's body, with its front matter stripped
     * @throws ToolError `NOT_FOUND` — listing the skills that do exist — when the name is unknown.
     */
    public fun readSkill(name: String): String =
        ggAsString(
            ggCall("read_skill", target(), owner, "readSkill", ggArgs(ggText(name))),
        )
}
