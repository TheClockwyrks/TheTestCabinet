import org.teavm.jso.JSObject
import org.teavm.jso.core.JSArray

/**
 * **Reaching the code a skill or a memory carried.**
 *
 * A skill or a memory may carry a Kotlin file as well as prose. Reading it compiles that file and binds
 * its public top-level functions at `lib.<key>` for the rest of your session, and the reply that
 * answered the read names the key and what it exports.
 *
 * `lib` is how a program reaches one, and it is deliberately the one place in this SDK where **you** say
 * what type you expect. A code module is compiled separately from your program, so there is no `import`
 * for the compiler to check the two against — the same position a Kotlin author is in when they reach
 * something at run time, and the same answer: name the shape you want.
 *
 * ```
 * if (lib.has("helpers", "slugify")) {
 *     view.openText("slug", lib.text("helpers", "slugify", "Some Title"))
 * }
 * ```
 *
 * Arguments are ordinary Kotlin values — [String], [Int], [Double], [Boolean] — and anything else is
 * passed as its `toString()`.
 */
public class Lib internal constructor() {
    /**
     * Whether this session has a module bound at `key` offering `name`.
     *
     * @param key The module's key, as the read that loaded it named.
     * @param name The export to look for.
     * @return whether calling it would find anything
     */
    public fun has(key: String, name: String): Boolean = ggExported(libObject(), key, name) != null

    /**
     * Call one export and read its answer as text.
     *
     * @param key The module's key.
     * @param name The export to call.
     * @param arguments What to pass it.
     * @return whatever it returned, as text
     * @throws ToolError `NOT_FOUND` when this session has no such module or export.
     */
    public fun text(key: String, name: String, vararg arguments: Any?): String =
        ggAsString(invoke(key, name, arguments))

    /**
     * Call one export and read its answer as a whole number.
     *
     * @param key The module's key.
     * @param name The export to call.
     * @param arguments What to pass it.
     * @return whatever it returned, as a whole number
     * @throws ToolError `NOT_FOUND` when this session has no such module or export.
     */
    public fun number(key: String, name: String, vararg arguments: Any?): Int =
        ggAsInteger(invoke(key, name, arguments))

    /**
     * Call one export and read its answer as a flag.
     *
     * @param key The module's key.
     * @param name The export to call.
     * @param arguments What to pass it.
     * @return whatever it returned, as a flag
     * @throws ToolError `NOT_FOUND` when this session has no such module or export.
     */
    public fun flag(key: String, name: String, vararg arguments: Any?): Boolean =
        ggAsBoolean(invoke(key, name, arguments))

    /**
     * Call one export for its effect, discarding whatever it returned.
     *
     * @param key The module's key.
     * @param name The export to call.
     * @param arguments What to pass it.
     * @throws ToolError `NOT_FOUND` when this session has no such module or export.
     */
    public fun run(key: String, name: String, vararg arguments: Any?) {
        invoke(key, name, arguments)
    }

    /** One export, called with the arguments lowered. */
    private fun invoke(key: String, name: String, arguments: Array<out Any?>): JSObject {
        val exported =
            ggExported(libObject(), key, name)
                ?: throw ToolError(
                    "read_skill",
                    ToolErrorCode.NOT_FOUND,
                    "this session has no `lib.$key.$name`: read the skill or memory that carries " +
                        "it first, and the reply will name what it exports",
                )
        val lowered = JSArray<JSObject>()
        for (argument in arguments) {
            lowered.push(lower(argument))
        }
        return ggInvoke(exported, lowered)
    }

    /** One Kotlin value, as the JavaScript one a compiled export takes. */
    private fun lower(argument: Any?): JSObject =
        when (argument) {
            is Int -> ggNumber(argument)
            is Boolean -> ggFlag(argument)
            is Double -> ggDecimal(argument)
            else -> ggText(argument.toString())
        }
}
