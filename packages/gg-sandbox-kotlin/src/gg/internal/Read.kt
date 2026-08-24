package gg.internal

import gg.board.BoardUsage
import gg.board.EpicCreated
import gg.board.IssueCreated
import gg.context.ArchiveHit
import gg.context.ArchiveSearch
import gg.context.MessageRole
import gg.context.ReclaimReport
import gg.delegation.AgentEnding
import gg.delegation.SubagentHandle
import gg.delegation.SubagentResult
import gg.docs.DocHit
import gg.docs.DocKind
import gg.docs.DocSearch
import gg.files.DirEntry
import gg.files.EntryKind
import gg.files.FileRead
import gg.files.ImageFile
import gg.files.SearchMatch
import gg.files.TextFile
import gg.memories.MemoryHit
import gg.memories.MemoryUsage
import gg.programs.ProgramSummary
import gg.shell.ShellOutput
import gg.tasks.TaskUsage

/**
 * **Reading the wire** — every [Value] gg answers with, as the Kotlin value this SDK's signatures
 * promise.
 *
 * Nothing here is model-facing, and nothing here is clever: each function is the one place that knows
 * a field's name on the wire, so a rename is one edit rather than a search. A field name is the
 * **WIT** name verbatim, hyphens and all, because that is what
 * `crates/gg/src/sandbox/membrane/wire.*.rs` writes and gg owns both ends of it.
 *
 * Three shapes are worth naming, because each is a decision Kotlin makes differently from the arm
 * this file's [Java sibling](https://docs.testcabinet.ai/gg/languages/java/) serves — a field the wire
 * may leave out becomes a **nullable** rather than an `Optional`, a discriminated union becomes an arm
 * of a **sealed interface**, and a fixed choice becomes an **enum entry** rather than the case name it
 * arrived as.
 */
internal object Read {
    // -------------------------------------------------------------------------------------------
    // The results
    // -------------------------------------------------------------------------------------------

    /** What a command reported. */
    fun shellOutput(value: Value): ShellOutput =
        ShellOutput(
            exitCode = ggOptionalInt(value.get("exit-code")),
            output = value.get("output").text(),
            truncated = value.get("truncated").flag(),
        )

    /** A read, narrowed to the arm gg tagged it with. */
    fun fileRead(value: Value): FileRead {
        val read = value.get("value")
        return if (value.get("case").text() == "image") {
            ImageFile(
                mediaType = read.get("media-type").text(),
                label = read.get("label").text(),
                bytes = read.get("bytes").integer(),
                shown = read.get("shown").flag(),
                notShownReason = ggOptionalText(read.get("not-shown-reason")),
            )
        } else {
            TextFile(
                contents = read.get("contents").text(),
                firstLine = read.get("first-line").integer(),
                lastLine = read.get("last-line").integer(),
                totalLines = read.get("total-lines").integer(),
                byteTruncated = read.get("byte-truncated").flag(),
            )
        }
    }

    /** Every directory entry in a list. */
    fun dirEntries(value: Value): List<DirEntry> =
        ggEach(value) {
            DirEntry(name = it.get("name").text(), kind = entryKind(it.get("kind").text()))
        }

    /** Every line a search matched. */
    fun searchMatches(value: Value): List<SearchMatch> =
        ggEach(value) {
            SearchMatch(
                path = it.get("path").text(),
                line = it.get("line").integer(),
                text = it.get("text").text(),
            )
        }

    /** The memory budget. */
    fun memoryUsage(value: Value): MemoryUsage =
        MemoryUsage(
            count = value.get("count").integer(),
            maxCount = ggOptionalInt(value.get("max-count")),
            totalChars = value.get("total-chars").integer(),
            maxTotalChars = ggOptionalInt(value.get("max-total-chars")),
            indexChars = ggOptionalInt(value.get("index-chars")),
            maxIndexChars = ggOptionalInt(value.get("max-index-chars")),
        )

    /** Every memory a search matched. */
    fun memoryHits(value: Value): List<MemoryHit> =
        ggEach(value) {
            MemoryHit(
                name = it.get("name").text(),
                description = it.get("description").text(),
                matched = it.get("matched").integer(),
                occurrences = it.get("occurrences").integer(),
                excerpt = it.get("excerpt").text(),
            )
        }

    /** One page of a documentation search. */
    fun docSearch(value: Value): DocSearch =
        DocSearch(
            total = value.get("total").integer(),
            offset = value.get("offset").integer(),
            hits =
                ggEach(value.get("hits")) {
                    DocHit(
                        key = it.get("key").text(),
                        kind = docKind(it.get("kind").text()),
                        module = it.get("module").text(),
                        name = it.get("name").text(),
                        summary = it.get("summary").text(),
                    )
                },
        )

    /** The task budget. */
    fun taskUsage(value: Value): TaskUsage =
        TaskUsage(count = value.get("count").integer(), maxTasks = value.get("max-tasks").integer())

    /** The board budget. */
    fun boardUsage(value: Value): BoardUsage =
        BoardUsage(
            epics = value.get("epics").integer(),
            maxEpics = value.get("max-epics").integer(),
            issues = value.get("issues").integer(),
            maxIssues = value.get("max-issues").integer(),
        )

    /** An epic that was just created. */
    fun epicCreated(value: Value): EpicCreated =
        EpicCreated(id = value.get("id").text(), board = boardUsage(value.get("board")))

    /** An issue that was just created. */
    fun issueCreated(value: Value): IssueCreated =
        IssueCreated(id = value.get("id").text(), board = boardUsage(value.get("board")))

    /** What a reclaim freed. */
    fun reclaimReport(value: Value): ReclaimReport =
        ReclaimReport(
            items = value.get("items").integer(),
            reclaimedTokens = value.get("reclaimed-tokens").integer(),
            paths = ggTextList(value.get("paths")),
            detail = value.get("detail").text(),
        )

    /** What an archive search found. */
    fun archiveSearch(value: Value): ArchiveSearch =
        ArchiveSearch(
            archiveEmpty = value.get("archive-empty").flag(),
            hits =
                ggEach(value.get("hits")) {
                    ArchiveHit(
                        seq = it.get("seq").integer(),
                        role = messageRole(it.get("role").text()),
                        text = it.get("text").text(),
                    )
                },
        )

    /** A child agent's handle. */
    fun subagentHandle(value: Value): SubagentHandle =
        SubagentHandle(
            id = value.get("id").text(),
            slot = value.get("slot").text(),
            modelId = value.get("model-id").text(),
        )

    /** Every child agent's result. */
    fun subagentResults(value: Value): List<SubagentResult> =
        ggEach(value) {
            SubagentResult(
                id = it.get("id").text(),
                status = ggOptionalText(it.get("status"))?.let(::agentEnding),
                summary = it.get("summary").text(),
            )
        }

    /** Every program this session has run. */
    fun programSummaries(value: Value): List<ProgramSummary> =
        ggEach(value) {
            ProgramSummary(
                turn = it.get("turn").integer(),
                lines = it.get("lines").integer(),
                chars = it.get("chars").integer(),
                ok = it.get("ok").flag(),
                error = ggOptionalText(it.get("error")),
            )
        }

    // -------------------------------------------------------------------------------------------
    // The fixed choices
    // -------------------------------------------------------------------------------------------

    /** What a directory entry is, from the case name the wire used. */
    private fun entryKind(wire: String): EntryKind =
        when (wire) {
            "file" -> EntryKind.FILE
            "directory" -> EntryKind.DIRECTORY
            else -> EntryKind.OTHER
        }

    /** Who said an archived message, from the case name the wire used. */
    private fun messageRole(wire: String): MessageRole =
        when (wire) {
            "system" -> MessageRole.SYSTEM
            "assistant" -> MessageRole.ASSISTANT
            "tool" -> MessageRole.TOOL
            else -> MessageRole.USER
        }

    /** Which kind a documentation entry is, from the case name the wire used. */
    private fun docKind(wire: String): DocKind =
        when (wire) {
            "module" -> DocKind.MODULE
            "type" -> DocKind.TYPE
            else -> DocKind.FUNCTION
        }

    /** Which kind a view is, from the case name the wire used. */
    /** How a child agent ended, from the case name the wire used. */
    private fun agentEnding(wire: String): AgentEnding =
        when (wire) {
            "completed" -> AgentEnding.COMPLETED
            "exhausted" -> AgentEnding.EXHAUSTED
            "timed-out" -> AgentEnding.TIMED_OUT
            "auth-error" -> AgentEnding.AUTH_ERROR
            "limit-exceeded" -> AgentEnding.LIMIT_EXCEEDED
            else -> AgentEnding.MODEL_ERROR
        }
}
