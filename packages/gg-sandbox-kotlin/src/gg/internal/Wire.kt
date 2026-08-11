package gg.internal

import gg.core.ToolError
import gg.core.ToolErrorCode
import org.teavm.jso.JSBody
import org.teavm.jso.JSObject
import org.teavm.jso.core.JSArray
import org.teavm.jso.core.JSBoolean
import org.teavm.jso.core.JSNumber
import org.teavm.jso.core.JSObjects
import org.teavm.jso.core.JSString

/**
 * **The bridge** — the one file in this SDK that knows there is a JavaScript side at all.
 *
 * Nothing here is model-facing. A program cannot even name it: everything below is `internal`, which
 * in Kotlin means *visible inside this module and nowhere else*, and a model's program is compiled as
 * its own module against this one's jar. That is a stronger fence than the Java arm's package-private
 * one and it costs nothing — the compiler enforces it, and the reflector that writes the catalogue
 * never reads this package.
 *
 * The package is `gg.internal` rather than a capability module's, and the reflector skips it by
 * that name: a module a model can search is a module whose every public declaration is
 * documented, and the crossing is neither public nor documentable as a capability.
 *
 * ## What the far side of the bridge is
 *
 * Not the WIT membrane. A compiled Kotlin program is evaluated by the **shared ECMAScript guest**,
 * which builds a program's scope out of the run's enabled tools and evaluates the program as the body
 * of a function whose parameters are the API objects (`fs`, `system`, `view`, …). TeaVM is asked for
 * `JSModuleType.NONE`, so the code it emits — the [JSBody] scripts below included — is evaluated
 * inside that same function body, and a bare `fs` there resolves to the guest's own object. Every
 * call therefore lands in the same lowering a TypeScript program's does: the same argument
 * validation, the same `u64` conversions, the same `ToolError`. That is what makes two arms of a
 * study produce byte-identical arguments for one capability.
 *
 * ## Why these are top-level functions rather than members of an object
 *
 * Because `@JSBody` is only legal on a **static** method, and Kotlin's `object` compiles its members
 * to instance methods — TeaVM refuses those by name (*Non-static JSBody method is owned by non-JS
 * class*), which is a compile error on every program rather than a run-time surprise. A top-level
 * function compiles to a static method of the file's facade class, which is exactly what TeaVM asks
 * for. The names are therefore chosen to be unmistakable inside this module rather than short.
 *
 * ## Why the failure is caught here and not left to propagate
 *
 * TeaVM wraps a JavaScript exception crossing into the JVM world in a `RuntimeException` whose
 * message it prefixes with `(JavaScript) `, so a program that wrote `catch (failure: ToolError)`
 * would catch nothing at all. [apply] therefore catches the throw *in JavaScript*, hands the three
 * fields back as an ordinary object, and lets [ggCall] raise a real Kotlin [ToolError] — which is
 * what a Kotlin author expects a library to throw and what a `catch` clause can name.
 *
 * The uncaught half is answered by gg's generated entry class rather than here: it catches a
 * `ToolError` that escaped, records the same three fields in the bundle's prelude, and the guest is
 * handed those instead of a JVM exception — so a failure the program did not handle is still
 * classified as a tool failure rather than as a program that threw something.
 *
 * ## Why a dispatcher is fine *here*
 *
 * [apply] takes the function name as data, which is exactly the shape the seam forbids a model-facing
 * surface from having. The rule is about what the model writes: a dispatcher a *model* calls moves the
 * whole surface out of the type system and into a string it has to remember. Below the typed
 * functions, where nobody reads the output and the strings are written once by hand beside the
 * function that uses them, one bridge is one place for the crossing to be right.
 */

// -------------------------------------------------------------------------------------------
// The API objects
// -------------------------------------------------------------------------------------------

// Each object is reached through `typeof` rather than by name, because reading an undeclared
// identifier throws. Nothing can reach these by string: they are the enclosing function's own
// parameters.
//
// THE GUEST BINDS EVERY MODULE, WHATEVER THE RUN ENABLED, so none of these answers `null` in a run
// whose artifacts agree. It did not always: the guest's scope used to be built from the run's
// enabled tools, and a capability the run withheld was simply not a binding — which is the case
// these `typeof` guards were written for and the case that no longer exists. What a `null` means
// now is that this SDK and the guest component disagree about what is exported, which is drift
// between two artifacts rather than anything a run decided.

/** The guest's `fs` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof fs === 'undefined' ? null : fs;")
internal external fun fsObject(): JSObject?

/** The guest's `system` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof system === 'undefined' ? null : system;")
internal external fun systemObject(): JSObject?

/** The guest's `project` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof project === 'undefined' ? null : project;")
internal external fun projectObject(): JSObject?

/** The guest's `tasks` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof tasks === 'undefined' ? null : tasks;")
internal external fun tasksObject(): JSObject?

/** The guest's `memory` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof memory === 'undefined' ? null : memory;")
internal external fun memoryObject(): JSObject?

/** The guest's `view` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof view === 'undefined' ? null : view;")
internal external fun viewObject(): JSObject?

/** The guest's `context` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof context === 'undefined' ? null : context;")
internal external fun contextObject(): JSObject?

/** The guest's `agents` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof agents === 'undefined' ? null : agents;")
internal external fun agentsObject(): JSObject?

/** The guest's `skills` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof skills === 'undefined' ? null : skills;")
internal external fun skillsObject(): JSObject?

/** The guest's `programs` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof programs === 'undefined' ? null : programs;")
internal external fun programsObject(): JSObject?

/** The guest's `harness` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof harness === 'undefined' ? null : harness;")
internal external fun harnessObject(): JSObject?

/** The guest's `review` object, or `null` when the guest does not export it. */
@JSBody(script = "return typeof review === 'undefined' ? null : review;")
internal external fun reviewObject(): JSObject?

/** The guest's `lib` namespace, or `null` when this session has loaded no code. */
@JSBody(script = "return typeof lib === 'undefined' ? null : lib;")
internal external fun libObject(): JSObject?

// -------------------------------------------------------------------------------------------
// The crossing
// -------------------------------------------------------------------------------------------

/**
 * Call `name` on `target` with `args`, catching a gg failure rather than letting it cross into the
 * JVM world as a wrapped JavaScript exception.
 *
 * Anything that is *not* a gg failure — a fault raised inside the generated component bindings, a
 * `TypeError` — is rethrown untouched, so it reaches the guest as itself and is described on its own
 * terms.
 *
 * The answer is a plain JavaScript object rather than a typed `JSObject` interface, so the whole
 * crossing rests on `@JSBody` and on nothing else.
 */
@JSBody(
    params = ["target", "name", "args"],
    script =
        "if (target === null || typeof target[name] !== 'function') { return null; }" +
            "try { return { ok: true, value: target[name].apply(target, args) }; }" +
            "catch (thrown) {" +
            "  var tool = thrown && thrown.tool;" +
            "  var code = thrown && thrown.code;" +
            "  var message = thrown && thrown.message;" +
            "  if (typeof tool === 'string' && typeof code === 'string'" +
            "      && typeof message === 'string') {" +
            "    return { ok: false, tool: tool, code: code, message: message };" +
            "  }" +
            "  throw thrown;" +
            "}",
)
private external fun apply(target: JSObject?, name: String, args: JSArray<JSObject>): JSObject?

/**
 * One call on one API object: the value it returned, or a raised [ToolError].
 *
 * The `null` branch is **not** a withheld capability and does not say it is. Every module is bound
 * in every program and every call on one is the host's to permit or refuse, so the only way [apply]
 * finds nothing is that this SDK names a function the run's guest component does not export — the
 * two artifacts disagreeing, which a model can do nothing about and must not be told to look for a
 * capability over.
 *
 * @param tool the gg name the failure is reported under
 * @param target the API object, as one of this file's accessors answered
 * @param owner the object's own name, for the failure's sentence
 * @param name the function to call on it
 * @param args the arguments, already lowered
 */
internal fun ggCall(
    tool: String,
    target: JSObject?,
    owner: String,
    name: String,
    args: JSArray<JSObject>,
): JSObject {
    val outcome =
        apply(target, name, args)
            ?: throw ToolError(
                tool,
                ToolErrorCode.OTHER,
                "`$owner.$name` did not reach the guest: gg's SDK declares it and this run's " +
                    "guest does not export it, which is a mismatch between the two rather than " +
                    "anything this program did",
            )
    if (ggBool(outcome, "ok")) {
        return ggGet(outcome, "value") ?: JSObjects.create()
    }
    throw ToolError(
        ggString(outcome, "tool"),
        ToolErrorCode.of(ggString(outcome, "code")),
        ggString(outcome, "message"),
    )
}

/** One call whose answer is nothing worth having. */
internal fun ggRun(
    tool: String,
    target: JSObject?,
    owner: String,
    name: String,
    args: JSArray<JSObject>,
) {
    ggCall(tool, target, owner, name, args)
}

// -------------------------------------------------------------------------------------------
// Lowering
// -------------------------------------------------------------------------------------------

/** An argument list holding whatever was passed, in order. */
internal fun ggArgs(vararg values: JSObject): JSArray<JSObject> {
    val array = JSArray<JSObject>()
    for (value in values) {
        array.push(value)
    }
    return array
}

/** Text, on its way out. */
internal fun ggText(value: String): JSString = JSString.valueOf(value)

/** A number, on its way out. */
internal fun ggNumber(value: Int): JSNumber = JSNumber.valueOf(value)

/** A flag, on its way out. */
internal fun ggFlag(value: Boolean): JSBoolean = JSBoolean.valueOf(value)

/** A fresh, empty JavaScript object to hang fields off. */
internal fun ggRecord(): JSObject = JSObjects.create()

/** Set one property, which is how a record is assembled a field at a time. */
@JSBody(params = ["target", "name", "value"], script = "target[name] = value;")
internal external fun ggSet(target: JSObject, name: String, value: JSObject)

/** Set one property to `null`, which is how a clearable field is cleared. */
@JSBody(params = ["target", "name"], script = "target[name] = null;")
internal external fun ggClear(target: JSObject, name: String)

/** Every string in a sequence, on its way out. */
internal fun ggTexts(values: Iterable<String>): JSArray<JSObject> {
    val array = JSArray<JSObject>()
    for (value in values) {
        array.push(JSString.valueOf(value))
    }
    return array
}

/** A fractional number, on its way out — what an untyped `lib` argument may carry. */
@JSBody(params = ["value"], script = "return value;")
internal external fun ggDecimal(value: Double): JSObject

// -------------------------------------------------------------------------------------------
// Reading
// -------------------------------------------------------------------------------------------

/** Whether a value the wire may leave out was in fact left out. */
internal fun ggAbsent(value: JSObject?): Boolean = value == null || JSObjects.isUndefined(value)

/** One property of a JavaScript value, whatever it is. */
@JSBody(params = ["value", "name"], script = "return value[name];")
internal external fun ggGet(value: JSObject, name: String): JSObject?

/** One property read as text. */
@JSBody(params = ["value", "name"], script = "return value[name];")
internal external fun ggString(value: JSObject, name: String): String

/** One property read as a whole number. */
@JSBody(params = ["value", "name"], script = "return value[name] | 0;")
internal external fun ggInteger(value: JSObject, name: String): Int

/** One property read as a flag. */
@JSBody(params = ["value", "name"], script = "return !!value[name];")
internal external fun ggBool(value: JSObject, name: String): Boolean

/** A value read as text. */
@JSBody(params = ["value"], script = "return value;")
internal external fun ggAsString(value: JSObject): String

/** A value read as a whole number. */
@JSBody(params = ["value"], script = "return value | 0;")
internal external fun ggAsInteger(value: JSObject): Int

/** A value read as a flag. */
@JSBody(params = ["value"], script = "return !!value;")
internal external fun ggAsBoolean(value: JSObject): Boolean

/** A value read as an array. */
@JSBody(params = ["value"], script = "return value;")
internal external fun ggAsArray(value: JSObject): JSArray<JSObject>

/** One property read as an array. */
internal fun ggArray(value: JSObject, name: String): JSArray<JSObject> {
    val held = ggGet(value, name) ?: return JSArray()
    return ggAsArray(held)
}

/** The export bound at `lib.<key>.<name>`, or `null`. */
@JSBody(
    params = ["lib", "key", "name"],
    script =
        "if (lib === null) { return null; }" +
            "var module = lib[key];" +
            "if (module === undefined || module === null) { return null; }" +
            "var exported = module[name];" +
            "return typeof exported === 'function' ? exported : null;",
)
internal external fun ggExported(lib: JSObject?, key: String, name: String): JSObject?

/** Call it. */
@JSBody(params = ["exported", "args"], script = "return exported.apply(null, args);")
internal external fun ggInvoke(exported: JSObject, args: JSArray<JSObject>): JSObject
