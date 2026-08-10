package gg.internal

import gg.board.BoardUsage
import gg.board.EpicCreated
import gg.board.IssueCreated
import gg.context.ArchiveHit
import gg.context.ArchiveSearch
import gg.context.MessageRole
import gg.context.ReclaimReport
import gg.core.FunctionSummary
import gg.delegation.AgentEnding
import gg.delegation.SubagentHandle
import gg.delegation.SubagentResult
import gg.files.DirEntry
import gg.files.EntryKind
import gg.files.FileRead
import gg.files.ImageFile
import gg.files.TextFile
import gg.memories.MemoryHit
import gg.memories.MemoryUsage
import gg.programs.ProgramSummary
import gg.shell.ShellOutput
import gg.tasks.TaskUsage
import gg.views.OpenView
import gg.views.ViewKind
import gg.views.ViewRegion
import org.teavm.jso.JSObject
import org.teavm.jso.core.JSArray

/**
 * **Reading the wire** — every JavaScript value the guest hands back, as the Kotlin value this SDK's
 * signatures promise.
 *
 * Nothing here is model-facing, and nothing here is clever: each function is the one place that knows
 * a field's name on the wire, so a rename is one edit rather than a search. Three shapes are worth
 * naming, because each is a decision Kotlin makes differently from the arm this file's Java sibling
 * serves — a field the wire may leave out becomes a **nullable** rather than an `Optional`, a
 * discriminated union becomes an arm of a **sealed interface**, and a fixed choice becomes an **enum
 * entry** rather than the string it arrived as.
 *
 * These are ordinary functions rather than `external` ones, so unlike [ggCall]'s neighbours they may
 * live on an `object`.
 */
internal object Read {
    // -------------------------------------------------------------------------------------------
    // The building blocks
    // -------------------------------------------------------------------------------------------

    /** A whole number the wire may have left out. */
    fun optionalInt(owner: JSObject, name: String): Int? {
        val value = ggGet(owner, name)
        return if (ggAbsent(value)) null else ggAsInteger(value!!)
    }

    /** Text the wire may have left out. */
    fun optionalText(owner: JSObject, name: String): String? {
        val value = ggGet(owner, name)
        return if (ggAbsent(value)) null else ggAsString(value!!)
    }

    /** Every element of an array property, mapped. */
    private fun <T> each(array: JSArray<JSObject>, read: (JSObject) -> T): List<T> {
        val out = ArrayList<T>(array.length)
        for (index in 0 until array.length) {
            out.add(read(array[index]))
        }
        return out
    }

    /** An array of text, as a read-only list. */
    fun texts(owner: JSObject, name: String): List<String> =
        each(ggArray(owner, name)) { ggAsString(it) }

    // -------------------------------------------------------------------------------------------
    // The results
    // -------------------------------------------------------------------------------------------

    /** What a command reported. */
    fun shellOutput(value: JSObject): ShellOutput =
        ShellOutput(
            exitCode = optionalInt(value, "exitCode"),
            output = ggString(value, "output"),
            truncated = ggBool(value, "truncated"),
        )

    /** A read, narrowed to the arm the guest tagged it with. */
    fun fileRead(value: JSObject): FileRead =
        if (ggString(value, "kind") == "image") {
            ImageFile(
                mediaType = ggString(value, "mediaType"),
                label = ggString(value, "label"),
                bytes = ggInteger(value, "bytes"),
                shown = ggBool(value, "shown"),
                notShownReason = optionalText(value, "notShownReason"),
            )
        } else {
            TextFile(
                contents = ggString(value, "contents"),
                firstLine = ggInteger(value, "firstLine"),
                lastLine = ggInteger(value, "lastLine"),
                totalLines = ggInteger(value, "totalLines"),
                byteTruncated = ggBool(value, "byteTruncated"),
            )
        }

    /** Every directory entry in an array. */
    fun dirEntries(value: JSObject): List<DirEntry> =
        each(ggAsArray(value)) {
            DirEntry(name = ggString(it, "name"), kind = entryKind(ggString(it, "kind")))
        }

    /** The memory budget. */
    fun memoryUsage(value: JSObject): MemoryUsage =
        MemoryUsage(
            count = ggInteger(value, "count"),
            maxCount = optionalInt(value, "maxCount"),
            totalChars = ggInteger(value, "totalChars"),
            maxTotalChars = optionalInt(value, "maxTotalChars"),
            indexChars = optionalInt(value, "indexChars"),
            maxIndexChars = optionalInt(value, "maxIndexChars"),
        )

    /** Every memory a search matched. */
    fun memoryHits(value: JSObject): List<MemoryHit> =
        each(ggAsArray(value)) {
            MemoryHit(
                name = ggString(it, "name"),
                description = ggString(it, "description"),
                matched = ggInteger(it, "matched"),
                occurrences = ggInteger(it, "occurrences"),
                excerpt = ggString(it, "excerpt"),
            )
        }

    /** The task budget. */
    fun taskUsage(value: JSObject): TaskUsage =
        TaskUsage(count = ggInteger(value, "count"), maxTasks = ggInteger(value, "maxTasks"))

    /** The board budget. */
    fun boardUsage(value: JSObject): BoardUsage =
        BoardUsage(
            epics = ggInteger(value, "epics"),
            maxEpics = ggInteger(value, "maxEpics"),
            issues = ggInteger(value, "issues"),
            maxIssues = ggInteger(value, "maxIssues"),
        )

    /** An epic that was just created. */
    fun epicCreated(value: JSObject): EpicCreated =
        EpicCreated(id = ggString(value, "id"), board = boardUsage(ggGet(value, "board")!!))

    /** An issue that was just created. */
    fun issueCreated(value: JSObject): IssueCreated =
        IssueCreated(id = ggString(value, "id"), board = boardUsage(ggGet(value, "board")!!))

    /** What a reclaim freed. */
    fun reclaimReport(value: JSObject): ReclaimReport =
        ReclaimReport(
            items = ggInteger(value, "items"),
            reclaimedTokens = ggInteger(value, "reclaimedTokens"),
            paths = texts(value, "paths"),
            detail = ggString(value, "detail"),
        )

    /** What an archive search found. */
    fun archiveSearch(value: JSObject): ArchiveSearch =
        ArchiveSearch(
            archiveEmpty = ggBool(value, "archiveEmpty"),
            hits =
                each(ggArray(value, "hits")) {
                    ArchiveHit(
                        seq = ggInteger(it, "seq"),
                        role = messageRole(ggString(it, "role")),
                        text = ggString(it, "text"),
                    )
                },
        )

    /** Every view open in the window. */
    fun openViews(value: JSObject): List<OpenView> =
        each(ggAsArray(value)) {
            val region = ggGet(it, "region")
            OpenView(
                kind = viewKind(ggString(it, "kind")),
                selector = ggString(it, "selector"),
                tokens = ggInteger(it, "tokens"),
                region =
                    if (ggAbsent(region)) {
                        null
                    } else {
                        ViewRegion(
                            offset = ggInteger(region!!, "offset"),
                            limit = ggInteger(region, "limit"),
                        )
                    },
            )
        }

    /** A child agent's handle. */
    fun subagentHandle(value: JSObject): SubagentHandle =
        SubagentHandle(
            id = ggString(value, "id"),
            slot = ggString(value, "slot"),
            modelId = ggString(value, "modelId"),
        )

    /** Every child agent's result. */
    fun subagentResults(value: JSObject): List<SubagentResult> =
        each(ggAsArray(value)) {
            SubagentResult(
                id = ggString(it, "id"),
                status = optionalText(it, "status")?.let(::agentEnding),
                summary = ggString(it, "summary"),
            )
        }

    /** Every program this session has run. */
    fun programSummaries(value: JSObject): List<ProgramSummary> =
        each(ggAsArray(value)) {
            ProgramSummary(
                turn = ggInteger(it, "turn"),
                lines = ggInteger(it, "lines"),
                chars = ggInteger(it, "chars"),
                ok = ggBool(it, "ok"),
                error = optionalText(it, "error"),
            )
        }

    /** Every function an object's directory named. */
    fun functionSummaries(value: JSObject): List<FunctionSummary> =
        each(ggAsArray(value)) {
            FunctionSummary(name = ggString(it, "name"), summary = ggString(it, "summary"))
        }

    // -------------------------------------------------------------------------------------------
    // The fixed choices
    // -------------------------------------------------------------------------------------------

    /** What a directory entry is, from the word the wire used. */
    private fun entryKind(wire: String): EntryKind =
        when (wire) {
            "file" -> EntryKind.FILE
            "directory" -> EntryKind.DIRECTORY
            else -> EntryKind.OTHER
        }

    /** Who said an archived message, from the word the wire used. */
    private fun messageRole(wire: String): MessageRole =
        when (wire) {
            "system" -> MessageRole.SYSTEM
            "assistant" -> MessageRole.ASSISTANT
            "tool" -> MessageRole.TOOL
            else -> MessageRole.USER
        }

    /** Which kind a view is, from the word the wire used. */
    private fun viewKind(wire: String): ViewKind =
        when (wire) {
            "file" -> ViewKind.FILE
            "docs" -> ViewKind.DOCS
            else -> ViewKind.TEXT
        }

    /** How a child agent ended, from the word the wire used. */
    private fun agentEnding(wire: String): AgentEnding =
        when (wire) {
            "completed" -> AgentEnding.COMPLETED
            "exhausted" -> AgentEnding.EXHAUSTED
            "timed_out" -> AgentEnding.TIMED_OUT
            "auth_error" -> AgentEnding.AUTH_ERROR
            "limit_exceeded" -> AgentEnding.LIMIT_EXCEEDED
            else -> AgentEnding.MODEL_ERROR
        }
}
