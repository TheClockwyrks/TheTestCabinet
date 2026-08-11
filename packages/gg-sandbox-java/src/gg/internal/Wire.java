package gg.internal;

import gg.ToolError;
import gg.ToolErrorCode;
import org.teavm.jso.JSBody;
import org.teavm.jso.JSObject;
import org.teavm.jso.JSProperty;
import org.teavm.jso.core.JSArray;
import org.teavm.jso.core.JSBoolean;
import org.teavm.jso.core.JSNumber;
import org.teavm.jso.core.JSObjects;
import org.teavm.jso.core.JSString;

/**
 * <b>The bridge</b> — the one class in this SDK that knows there is a JavaScript side at all.
 *
 * <p>Nothing here is model-facing. A program never imports this package, no catalogue entry
 * describes it, and no prompt names it; what a model reads is the typed, namespaced surface the
 * {@code gg} classes build on top of it. That split is the seam's rule about a hand-written SDK:
 * the SDK bridges its own idiom onto the wire, and the model never sees the bridge.
 *
 * <h2>What the far side of the bridge is</h2>
 *
 * <p>Not the WIT membrane. A compiled Java program is evaluated by the <b>shared ECMAScript
 * guest</b>, which builds a program's scope out of the run's enabled tools and evaluates the
 * program as the body of a function whose parameters are the API objects ({@code fs},
 * {@code system}, {@code view}, …). TeaVM is asked for {@code JSModuleType.NONE}, so the code it
 * emits — this class's {@link JSBody} scripts included — is evaluated inside that same function
 * body and a bare {@code fs} there resolves to the guest's own object. Every call therefore lands
 * in the same lowering a TypeScript program's does: the same argument validation, the same
 * {@code u64} conversions, the same {@code ToolError}. That is what makes two arms of a study
 * produce byte-identical arguments for one capability.
 *
 * <h2>Why the failure is caught here and not left to propagate</h2>
 *
 * <p>TeaVM wraps a JavaScript exception crossing into Java in a {@code RuntimeException} whose
 * message it prefixes with {@code (JavaScript) }, so a program that wrote
 * {@code catch (ToolError failure)} would catch nothing at all. {@link #apply} therefore catches
 * the throw <em>in JavaScript</em>, hands the three fields back as data, and lets the caller raise
 * a real Java {@link ToolError} — which is what a Java author expects a library to throw and what
 * a Java {@code catch} clause can name.
 *
 * <p>The uncaught half is answered by gg's generated entry class rather than here: it catches a
 * {@link ToolError} that escaped, records the same three fields in the bundle's prelude, and the
 * guest is handed those instead of a Java exception — so a failure the program did not handle is
 * still classified as a tool failure rather than as a program that threw something.
 *
 * <h2>Why a dispatcher is fine <em>here</em></h2>
 *
 * <p>{@link #apply} takes the function name as data, which is exactly the shape the seam forbids a
 * model-facing surface from having. The rule is about what the model writes: a dispatcher a
 * <em>model</em> calls moves the whole surface out of the type system and into a string it has to
 * remember. Below the typed methods, where nobody reads the output and the strings are written
 * once by hand beside the method that uses them, one bridge is one place for the crossing to be
 * right.
 */
public final class Wire {
    private Wire() {
    }

    /**
     * What one crossing answered: a value, or the three fields of a gg failure.
     *
     * <p>A record rather than an exception on the JavaScript side because the throw has to be
     * caught there — see this class's own documentation.
     */
    public interface Outcome extends JSObject {
        /** Whether the call returned rather than threw. */
        @JSProperty
        boolean isOk();

        /** What it returned. */
        @JSProperty
        JSObject getValue();

        /** The gg tool that failed, under gg's own name for it. */
        @JSProperty
        String getTool();

        /** The wire spelling of the failure class. */
        @JSProperty
        String getCode();

        /** What went wrong, in gg's words. */
        @JSProperty
        String getMessage();
    }

    // -------------------------------------------------------------------------------------------
    // The API objects
    // -------------------------------------------------------------------------------------------

    // Each object is reached through `typeof` rather than by name, because reading an undeclared
    // identifier throws and these names are the enclosing function's parameters, so nothing can
    // reach them by string and no `switch` could stand in.
    //
    // THE GUEST BINDS EVERY MODULE, WHATEVER THE RUN ENABLED, so none of these answers `null` in a
    // run whose artifacts agree. It did not always: the guest's scope used to be built from the
    // run's enabled tools, and a capability the run withheld was simply not a binding — which is
    // the case these `typeof` guards were written for and the case that no longer exists. What a
    // `null` means now is that this SDK and the guest component disagree about what is exported,
    // which is drift between two artifacts rather than anything a run decided.

    /** The guest's {@code fs} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof fs === 'undefined' ? null : fs;")
    public static native JSObject fs();

    /** The guest's {@code system} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof system === 'undefined' ? null : system;")
    public static native JSObject system();

    /** The guest's {@code project} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof project === 'undefined' ? null : project;")
    public static native JSObject project();

    /** The guest's {@code tasks} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof tasks === 'undefined' ? null : tasks;")
    public static native JSObject tasks();

    /** The guest's {@code memory} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof memory === 'undefined' ? null : memory;")
    public static native JSObject memory();

    /** The guest's {@code docs} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof docs === 'undefined' ? null : docs;")
    public static native JSObject docs();

    /** The guest's {@code view} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof view === 'undefined' ? null : view;")
    public static native JSObject view();

    /** The guest's {@code context} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof context === 'undefined' ? null : context;")
    public static native JSObject context();

    /** The guest's {@code agents} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof agents === 'undefined' ? null : agents;")
    public static native JSObject agents();

    /** The guest's {@code skills} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof skills === 'undefined' ? null : skills;")
    public static native JSObject skills();

    /** The guest's {@code programs} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof programs === 'undefined' ? null : programs;")
    public static native JSObject programs();

    /** The guest's {@code harness} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof harness === 'undefined' ? null : harness;")
    public static native JSObject harness();

    /** The guest's {@code review} object, or {@code null} when the guest does not export it. */
    @JSBody(script = "return typeof review === 'undefined' ? null : review;")
    public static native JSObject review();

    /** The guest's {@code lib} namespace, or {@code null} when this session has loaded no code. */
    @JSBody(script = "return typeof lib === 'undefined' ? null : lib;")
    public static native JSObject lib();

    // -------------------------------------------------------------------------------------------
    // The crossing
    // -------------------------------------------------------------------------------------------

    /**
     * Call {@code name} on {@code target} with {@code args}, catching a gg failure rather than
     * letting it cross into Java as a wrapped JavaScript exception.
     *
     * <p>Anything that is <em>not</em> a gg failure — a fault raised inside the generated
     * component bindings, a {@code TypeError} — is rethrown untouched, so it reaches the guest as
     * itself and is described on its own terms.
     */
    @JSBody(params = {"target", "name", "args"}, script =
        "if (target === null || typeof target[name] !== 'function') { return null; }"
        + "try { return { ok: true, value: target[name].apply(target, args) }; }"
        + "catch (thrown) {"
        + "  var tool = thrown && thrown.tool;"
        + "  var code = thrown && thrown.code;"
        + "  var message = thrown && thrown.message;"
        + "  if (typeof tool === 'string' && typeof code === 'string'"
        + "      && typeof message === 'string') {"
        + "    return { ok: false, tool: tool, code: code, message: message };"
        + "  }"
        + "  throw thrown;"
        + "}")
    private static native Outcome apply(JSObject target, String name, JSArray<JSObject> args);

    /**
     * One call on one API object: the value it returned, or a raised {@link ToolError}.
     *
     * <p>The {@code null} branch is <b>not</b> a withheld capability and does not say it is. Every
     * module is bound in every program and every call on one is the host's to permit or refuse, so
     * the only way {@link #apply} finds nothing is that this SDK names a function the run's guest
     * component does not export — the two artifacts disagreeing, which a model can do nothing
     * about and must not be told to look for a capability over.
     *
     * @param tool the gg name the failure is reported under
     * @param target the API object, as one of this class's accessors answered
     * @param object the object's own name, for the failure's sentence
     * @param name the function to call on it
     * @param args the arguments, already lowered
     */
    public static JSObject call(String tool, JSObject target, String object, String name,
            JSArray<JSObject> args) {
        Outcome outcome = apply(target, name, args);
        if (outcome == null) {
            throw new ToolError(tool, ToolErrorCode.OTHER,
                    "`" + object + "." + name + "` did not reach the guest: gg's SDK declares it "
                    + "and this run's guest does not export it, which is a mismatch between the "
                    + "two rather than anything this program did");
        }
        if (outcome.isOk()) {
            return outcome.getValue();
        }
        throw new ToolError(outcome.getTool(), ToolErrorCode.of(outcome.getCode()),
                outcome.getMessage());
    }

    /** One call whose answer is nothing worth having. */
    public static void run(String tool, JSObject target, String object, String name,
            JSArray<JSObject> args) {
        call(tool, target, object, name, args);
    }

    // -------------------------------------------------------------------------------------------
    // Lowering
    // -------------------------------------------------------------------------------------------

    /** An empty argument list. */
    public static JSArray<JSObject> args() {
        return new JSArray<>();
    }

    /** An argument list holding one value. */
    public static JSArray<JSObject> args(JSObject first) {
        JSArray<JSObject> args = new JSArray<>();
        args.push(first);
        return args;
    }

    /** An argument list holding two values. */
    public static JSArray<JSObject> args(JSObject first, JSObject second) {
        JSArray<JSObject> args = new JSArray<>();
        args.push(first);
        args.push(second);
        return args;
    }

    /** An argument list holding three values. */
    public static JSArray<JSObject> args(JSObject first, JSObject second, JSObject third) {
        JSArray<JSObject> args = new JSArray<>();
        args.push(first);
        args.push(second);
        args.push(third);
        return args;
    }

    /** Text, on its way out. */
    public static JSString text(String value) {
        return JSString.valueOf(value);
    }

    /** A number, on its way out. */
    public static JSNumber number(int value) {
        return JSNumber.valueOf(value);
    }

    /** A flag, on its way out. */
    public static JSBoolean flag(boolean value) {
        return JSBoolean.valueOf(value);
    }

    /** A fresh, empty JavaScript object to hang optional fields off. */
    public static JSObject object() {
        return JSObjects.create();
    }

    /** Set one property, which is how an options object is assembled a field at a time. */
    @JSBody(params = {"target", "name", "value"}, script = "target[name] = value;")
    public static native void set(JSObject target, String name, JSObject value);

    /** Set one property to {@code null}, which is how a clearable field is cleared. */
    @JSBody(params = {"target", "name"}, script = "target[name] = null;")
    public static native void clear(JSObject target, String name);

    /** An array of text, on its way out. */
    public static JSArray<JSObject> texts(String[] values) {
        JSArray<JSObject> array = new JSArray<>();
        for (String value : values) {
            array.push(JSString.valueOf(value));
        }
        return array;
    }

    /** An array of text held in a list, on its way out. */
    public static JSArray<JSObject> texts(java.util.List<String> values) {
        JSArray<JSObject> array = new JSArray<>();
        for (String value : values) {
            array.push(JSString.valueOf(value));
        }
        return array;
    }

    // -------------------------------------------------------------------------------------------
    // Reading
    // -------------------------------------------------------------------------------------------

    /** Whether a value the wire may leave out was in fact left out. */
    public static boolean absent(JSObject value) {
        return value == null || JSObjects.isUndefined(value);
    }

    /** One property of a JavaScript value, whatever it is. */
    @JSBody(params = {"value", "name"}, script = "return value[name];")
    public static native JSObject get(JSObject value, String name);

    /** One property read as text. */
    @JSBody(params = {"value", "name"}, script = "return value[name];")
    public static native String string(JSObject value, String name);

    /** One property read as a whole number. */
    @JSBody(params = {"value", "name"}, script = "return value[name] | 0;")
    public static native int integer(JSObject value, String name);

    /** One property read as a flag. */
    @JSBody(params = {"value", "name"}, script = "return !!value[name];")
    public static native boolean bool(JSObject value, String name);

    /** A value read as text. */
    @JSBody(params = {"value"}, script = "return value;")
    public static native String asString(JSObject value);

    /** A value read as a whole number. */
    @JSBody(params = {"value"}, script = "return value | 0;")
    public static native int asInteger(JSObject value);

    /** A value read as an array. */
    @JSBody(params = {"value"}, script = "return value;")
    public static native JSArray<JSObject> asArray(JSObject value);

    /** One property read as an array. */
    public static JSArray<JSObject> array(JSObject value, String name) {
        return asArray(get(value, name));
    }
}
