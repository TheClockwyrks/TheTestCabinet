package gg.internal

import gg.core.Patch
import gg.delegation.Brief
import org.teavm.jso.JSObject

/**
 * Write a three-way patch onto the record the guest's own function takes.
 *
 * It lives beside the bridge rather than beside [Patch] because it is the one thing about that type
 * that knows there is a wire: `Replace` sets the field and `Clear` sets it to `null`, which is how the
 * guest's own lowering distinguishes "empty this" from "leave it alone".
 */
internal fun Patch<String>.lower(record: JSObject, field: String) {
    when (this) {
        is Patch.Replace -> ggSet(record, field, ggText(value))
        Patch.Clear -> ggClear(record, field)
    }
}

/**
 * Which field of the spawn request a brief fills, and what it fills it with.
 *
 * An extension beside the bridge rather than a member of [Brief], because a Kotlin interface has no
 * `internal` members — and a public one would put gg's own wire spelling on a type a model reads.
 */
internal fun Brief.lowered(): Pair<String, String> =
    when (this) {
        is Brief.Prompt -> "prompt" to instructions
        is Brief.Issue -> "issueId" to issueId
    }
