package gg;

import gg.internal.Wire;
import org.teavm.jso.JSBody;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSArray;

/**
 * The code a skill or a memory carried, bound at {@code lib.<key>} for the rest of the session.
 *
 * <p>A skill or a memory may carry a Java class body as well as prose. Reading it compiles that body
 * and binds its {@code public static} methods, and the reply that answered the read names the key
 * and what it exports.
 *
 * <p>This is deliberately the one place in this SDK where the caller says what type it expects. A
 * code module is compiled separately from the program that uses it, so there is no {@code import}
 * for javac to check the two against — the same position a Java author is in when reaching something
 * by reflection, and the same answer: name the shape wanted.
 *
 * <pre>{@code
 * if (Lib.has("helpers", "slugify")) {
 *     Views.openText("slug", Lib.text("helpers", "slugify", "Some Title"));
 * }
 * }</pre>
 *
 * <p>Arguments are ordinary Java values — {@link String}, {@link Integer}, {@link Double},
 * {@link Boolean} — and anything else is passed as its {@code toString()}.
 */
public final class Lib {
    private Lib() {
    }

    /**
     * Whether this session has a module bound at a key offering an export.
     *
     * @param key The module's key, as the read that loaded it named.
     * @param name The export to look for.
     * @return whether calling it would find anything
     */
    public static boolean has(String key, String name) {
        return exported(Wire.lib(), key, name) != null;
    }

    /**
     * Call one export and read its answer as text.
     *
     * @param key The module's key.
     * @param name The export to call.
     * @param arguments What to pass it.
     * @return whatever it returned, as text
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when this session has no such module or
     *     export.
     */
    public static String text(String key, String name, Object... arguments) {
        return Wire.asString(invoke(key, name, arguments));
    }

    /**
     * Call one export and read its answer as a whole number.
     *
     * @param key The module's key.
     * @param name The export to call.
     * @param arguments What to pass it.
     * @return whatever it returned, as a whole number
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when this session has no such module or
     *     export.
     */
    public static int number(String key, String name, Object... arguments) {
        return Wire.asInteger(invoke(key, name, arguments));
    }

    /**
     * Call one export and read its answer as a flag.
     *
     * @param key The module's key.
     * @param name The export to call.
     * @param arguments What to pass it.
     * @return whatever it returned, as a flag
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when this session has no such module or
     *     export.
     */
    public static boolean flag(String key, String name, Object... arguments) {
        return truthy(invoke(key, name, arguments));
    }

    /**
     * Call one export for its effect, discarding whatever it returned.
     *
     * @param key The module's key.
     * @param name The export to call.
     * @param arguments What to pass it.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when this session has no such module or
     *     export.
     */
    public static void run(String key, String name, Object... arguments) {
        invoke(key, name, arguments);
    }

    /** One export, called with the arguments lowered. */
    private static JSObject invoke(String key, String name, Object[] arguments) {
        JSObject exported = exported(Wire.lib(), key, name);
        if (exported == null) {
            throw new ToolError("read_skill", ToolErrorCode.NOT_FOUND,
                    "this session has no `lib." + key + "." + name + "`: read the skill or memory "
                    + "that carries it first, and the reply will name what it exports");
        }
        JSArray<JSObject> lowered = new JSArray<>();
        for (Object argument : arguments) {
            lowered.push(lower(argument));
        }
        return apply(exported, lowered);
    }

    /** One Java value, as the JavaScript one a compiled export takes. */
    private static JSObject lower(Object argument) {
        if (argument instanceof Integer value) {
            return Wire.number(value);
        }
        if (argument instanceof Boolean value) {
            return Wire.flag(value);
        }
        if (argument instanceof Double value) {
            return decimal(value);
        }
        return Wire.text(String.valueOf(argument));
    }

    /** The export bound at {@code lib.<key>.<name>}, or {@code null}. */
    @JSBody(params = {"lib", "key", "name"}, script =
        "if (lib === null) { return null; }"
        + "var module = lib[key];"
        + "if (module === undefined || module === null) { return null; }"
        + "var exported = module[name];"
        + "return typeof exported === 'function' ? exported : null;")
    private static native JSObject exported(JSObject lib, String key, String name);

    /** Call it. */
    @JSBody(params = {"exported", "args"}, script = "return exported.apply(null, args);")
    private static native JSObject apply(JSObject exported, JSArray<JSObject> args);

    /** A fractional number, on its way out. */
    @JSBody(params = {"value"}, script = "return value;")
    private static native JSObject decimal(double value);

    /** Whatever came back, read as a flag. */
    @JSBody(params = {"value"}, script = "return !!value;")
    private static native boolean truthy(JSObject value);
}
