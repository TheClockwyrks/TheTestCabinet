package gg.internal

import gg.core.ToolError
import gg.core.ToolErrorCode

/**
 * **The bridge** — the one file in this SDK that knows there is a host at all, and the lowering
 * helpers every model-facing module writes its arguments with.
 *
 * Nothing here is model-facing. A program cannot even name it: everything below is `internal`, which
 * in Kotlin means *visible inside this module and nowhere else*, and a model's program is compiled as
 * its own module against this one's jar. That is a stronger fence than the [Java arm's]
 * (https://docs.testcabinet.ai/gg/languages/java/) package-private one and it costs nothing — the
 * compiler enforces it, and the reflector that writes the catalogue never reads this package.
 *
 * ## What the far side of the bridge is
 *
 * gg's own Rust host, through **one imported function**. A Kotlin program is compiled to bytecode by
 * `kotlinc` and then by TeaVM's `WEBASSEMBLY_WASI` backend into a WebAssembly component of its own,
 * and that component imports `test-cabinet:gg/wire` and nothing else. [Abi] implements the canonical
 * ABI for that one function; [Frames] is the encoding that travels inside it. Both are Java, both are
 * in `packages/gg-sandbox-jvm`, and both are compiled into the Java arm's jar as well — because a
 * second canonical-ABI implementation to keep in step with one WIT is exactly what a single door
 * exists to avoid.
 *
 * Every call therefore lands in the same typed host function a TypeScript program's does: the same
 * capability gate, the same recorded call, the same deadline, the same `tool-error`. That is what
 * makes two arms of a study produce byte-identical arguments for one capability.
 *
 * ## Why a dispatcher is fine *here*
 *
 * [ggCall] takes the operation id as data, which is exactly the shape the seam forbids a
 * model-facing surface from having. The rule is about what the model writes: a dispatcher a *model*
 * calls moves the whole surface out of the type system and into a string it has to remember. Below
 * the typed functions, where nobody reads the output and the ids are written once by hand beside the
 * function that uses them, one bridge is one place for the crossing to be right.
 */

// -------------------------------------------------------------------------------------------
// The crossing
// -------------------------------------------------------------------------------------------

/**
 * One gg call: the value it returned, or a raised [ToolError].
 *
 * @param op the rendered operation id — `files.read_file`
 * @param arguments the call's arguments, already lowered, positionally in the order the WIT declares
 *   them
 */
internal fun ggCall(
    op: String,
    vararg arguments: Value,
): Value {
    val answered = Frames.response(Abi.call(op, Frames.request(*arguments)))
    if (answered.failed()) {
        throw ToolError(answered.tool(), ToolErrorCode.of(answered.code()), answered.message())
    }
    return answered.value()
}

/** One call whose answer is nothing worth having. */
internal fun ggRun(
    op: String,
    vararg arguments: Value,
) {
    ggCall(op, *arguments)
}

// -------------------------------------------------------------------------------------------
// Lowering
// -------------------------------------------------------------------------------------------

/**
 * Text on its way out, or the absent `option` a `null` is.
 *
 * Every one of these takes a nullable, because this SDK spells an optional argument as a parameter
 * defaulting to `null` — so one function serves both the argument that was given and the one that
 * was not, and no call site has to write the branch.
 */
internal fun ggText(value: String?): Value = if (value == null) Value.none() else Value.of(value)

/** A whole number on its way out, widened to the 64 bits every WIT integer is written as. */
internal fun ggNumber(value: Int?): Value = if (value == null) Value.none() else Value.of(value.toLong())

/** A flag on its way out. */
internal fun ggFlag(value: Boolean?): Value = if (value == null) Value.none() else Value.of(value)

/** A fractional number on its way out. */
internal fun ggDecimal(value: Double?): Value = if (value == null) Value.none() else Value.of(value)

/** A list of text on its way out. */
internal fun ggTexts(values: Iterable<String>): Value {
    val lowered = values.toList()
    val items = arrayOfNulls<Value>(lowered.size)
    for (index in lowered.indices) {
        items[index] = Value.of(lowered[index])
    }
    @Suppress("UNCHECKED_CAST")
    return Value.list(*(items as Array<Value>))
}

/** A list of whatever was passed, in order. */
internal fun ggList(vararg items: Value): Value = Value.list(*items)

/** An empty record, to hang fields off with `put`. */
internal fun ggRecord(): Value = Value.record()

/** A `variant` case: the case name, and the payload it carries — or nothing, for a case with none. */
internal fun ggVariant(case: String, payload: Value?): Value = Value.variant(case, payload)

// -------------------------------------------------------------------------------------------
// Reading
// -------------------------------------------------------------------------------------------

/** One field of a record the wire may have left out, as a nullable whole number. */
internal fun ggOptionalInt(value: Value): Int? = if (value.absent()) null else value.integer()

/** One field of a record the wire may have left out, as a nullable string. */
internal fun ggOptionalText(value: Value): String? = if (value.absent()) null else value.text()

/** Every item of a list, mapped. */
internal fun <T> ggEach(value: Value, read: (Value) -> T): List<T> {
    val out = ArrayList<T>(value.size())
    for (index in 0 until value.size()) {
        out.add(read(value.at(index)))
    }
    return out
}

/** A list of text, as a read-only list. */
internal fun ggTextList(value: Value): List<String> = ggEach(value) { it.text() }
