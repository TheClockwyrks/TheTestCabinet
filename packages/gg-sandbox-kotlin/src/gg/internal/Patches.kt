package gg.internal

import gg.core.Patch
import gg.delegation.Brief

/**
 * A three-way patch, as the `text-edit` variant gg's own WIT declares.
 *
 * It lives beside the bridge rather than beside [Patch] because it is the one thing about that type
 * that knows there is a wire. All three states are cases of one variant rather than a field that may
 * be absent, present or null: never naming the field is `keep`, [Patch.Replace] is `set` and
 * [Patch.Clear] is `clear`.
 */
internal fun Patch<String>?.lowered(): Value =
    when (this) {
        null -> ggVariant("keep", null)
        is Patch.Replace -> ggVariant("set", ggText(value))
        Patch.Clear -> ggVariant("clear", null)
    }

/**
 * An issue's epic, as the `epic-edit` variant: the same three states, with `ungroup` where a
 * description has `clear`.
 */
internal fun Patch<String>?.loweredEpic(): Value =
    when (this) {
        null -> ggVariant("keep", null)
        is Patch.Replace -> ggVariant("set", ggText(value))
        Patch.Clear -> ggVariant("ungroup", null)
    }

/**
 * Which case of the spawn request's `task` variant a brief is, and what it carries.
 *
 * An extension beside the bridge rather than a member of [Brief], because a Kotlin interface has no
 * `internal` members — and a public one would put gg's own wire spelling on a type a model reads.
 */
internal fun Brief.lowered(): Value =
    when (this) {
        is Brief.Prompt -> ggVariant("prompt", ggText(instructions))
        is Brief.Issue -> ggVariant("issue", ggText(issueId))
    }
