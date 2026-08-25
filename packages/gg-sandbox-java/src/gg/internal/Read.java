package gg.internal;

import gg.board.Board;
import gg.context.Context;
import gg.delegation.Delegation;
import gg.docs.Docs;
import gg.files.Files;
import gg.memories.Memories;
import gg.programs.Programs;
import gg.shell.Shell;
import gg.tasks.Tasks;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;

/**
 * <b>Reading the wire</b> — every {@link Value} gg answers with, as the Java value this SDK's
 * signatures promise.
 *
 * <p>Nothing here is model-facing, and nothing here is clever: each function is the one place that
 * knows a field's name on the wire, so a rename is one edit rather than a search. A field name is
 * the <b>WIT</b> name verbatim, hyphens and all, because that is what
 * {@code crates/gg/src/sandbox/membrane/wire.*.rs} writes and gg owns both ends of it.
 *
 * <p>The three shapes worth naming are the ones a language with no {@code undefined} has to decide
 * about — a field the wire may leave out becomes {@link Optional} or {@link OptionalInt}, a
 * discriminated union becomes a real Java subtype, and a fixed choice becomes an enum constant
 * rather than the case name it arrived as.
 */
public final class Read {
    private Read() {
    }

    // -------------------------------------------------------------------------------------------
    // The building blocks
    // -------------------------------------------------------------------------------------------

    /** A whole number the wire may have left out. */
    public static OptionalInt optionalInt(Value value) {
        return value.absent() ? OptionalInt.empty() : OptionalInt.of(value.integer());
    }

    /** Text the wire may have left out. */
    public static Optional<String> optionalText(Value value) {
        return value.absent() ? Optional.empty() : Optional.of(value.text());
    }

    /** A list of text, as an unmodifiable list. */
    public static List<String> texts(Value value) {
        List<String> out = new ArrayList<>(value.size());
        for (int index = 0; index < value.size(); index++) {
            out.add(value.at(index).text());
        }
        return List.copyOf(out);
    }

    // -------------------------------------------------------------------------------------------
    // The results
    // -------------------------------------------------------------------------------------------

    /** What a command reported. */
    public static Shell.ShellOutput shellOutput(Value value) {
        return new Shell.ShellOutput(optionalInt(value.get("exit-code")),
                value.get("output").text(), value.get("truncated").flag());
    }

    /** A read, narrowed to the arm gg tagged it with. */
    public static Files.FileRead fileRead(Value value) {
        Value read = value.get("value");
        if ("image".equals(value.get("case").text())) {
            return new Files.ImageFile(read.get("media-type").text(), read.get("label").text(),
                    read.get("bytes").integer(), read.get("shown").flag(),
                    optionalText(read.get("not-shown-reason")));
        }
        return new Files.TextFile(read.get("contents").text(), read.get("first-line").integer(),
                read.get("last-line").integer(), read.get("total-lines").integer(),
                read.get("byte-truncated").flag());
    }

    /** One directory entry. */
    public static Files.DirEntry dirEntry(Value value) {
        return new Files.DirEntry(value.get("name").text(), entryKind(value.get("kind").text()));
    }

    /** Every directory entry in a list. */
    public static List<Files.DirEntry> dirEntries(Value value) {
        List<Files.DirEntry> out = new ArrayList<>(value.size());
        for (int index = 0; index < value.size(); index++) {
            out.add(dirEntry(value.at(index)));
        }
        return List.copyOf(out);
    }

    /** Every line a search matched. */
    public static List<Files.SearchMatch> searchMatches(Value value) {
        List<Files.SearchMatch> out = new ArrayList<>(value.size());
        for (int index = 0; index < value.size(); index++) {
            Value match = value.at(index);
            out.add(new Files.SearchMatch(match.get("path").text(), match.get("line").integer(),
                    match.get("text").text()));
        }
        return List.copyOf(out);
    }

    /** The memory budget. */
    public static Memories.MemoryUsage memoryUsage(Value value) {
        return new Memories.MemoryUsage(value.get("count").integer(),
                optionalInt(value.get("max-count")), value.get("total-chars").integer(),
                optionalInt(value.get("max-total-chars")), optionalInt(value.get("index-chars")),
                optionalInt(value.get("max-index-chars")));
    }

    /** Every memory a search matched. */
    public static List<Memories.MemoryHit> memoryHits(Value value) {
        List<Memories.MemoryHit> out = new ArrayList<>(value.size());
        for (int index = 0; index < value.size(); index++) {
            Value hit = value.at(index);
            out.add(new Memories.MemoryHit(hit.get("name").text(), hit.get("description").text(),
                    hit.get("matched").integer(), hit.get("occurrences").integer(),
                    hit.get("excerpt").text()));
        }
        return List.copyOf(out);
    }

    /** One page of a documentation search. */
    public static Docs.DocSearch docSearch(Value value) {
        Value found = value.get("hits");
        List<Docs.DocHit> hits = new ArrayList<>(found.size());
        for (int index = 0; index < found.size(); index++) {
            Value hit = found.at(index);
            hits.add(new Docs.DocHit(hit.get("key").text(), docKind(hit.get("kind").text()),
                    hit.get("module").text(), hit.get("name").text(),
                    hit.get("summary").text()));
        }
        return new Docs.DocSearch(value.get("total").integer(), value.get("offset").integer(),
                List.copyOf(hits));
    }

    /** The task budget. */
    public static Tasks.TaskUsage taskUsage(Value value) {
        return new Tasks.TaskUsage(value.get("count").integer(),
                value.get("max-tasks").integer());
    }

    /** The board budget. */
    public static Board.BoardUsage boardUsage(Value value) {
        return new Board.BoardUsage(value.get("epics").integer(),
                value.get("max-epics").integer(), value.get("issues").integer(),
                value.get("max-issues").integer());
    }

    /** An epic that was just created. */
    public static Board.EpicCreated epicCreated(Value value) {
        return new Board.EpicCreated(value.get("id").text(), boardUsage(value.get("board")));
    }

    /** An issue that was just created. */
    public static Board.IssueCreated issueCreated(Value value) {
        return new Board.IssueCreated(value.get("id").text(), boardUsage(value.get("board")));
    }

    /** What a reclaim freed. */
    public static Context.ReclaimReport reclaimReport(Value value) {
        return new Context.ReclaimReport(value.get("items").integer(),
                value.get("reclaimed-tokens").integer(), texts(value.get("paths")),
                value.get("detail").text());
    }

    /** What an archive search found. */
    public static Context.ArchiveSearch archiveSearch(Value value) {
        Value found = value.get("hits");
        List<Context.ArchiveHit> hits = new ArrayList<>(found.size());
        for (int index = 0; index < found.size(); index++) {
            Value hit = found.at(index);
            hits.add(new Context.ArchiveHit(hit.get("seq").integer(),
                    messageRole(hit.get("role").text()), hit.get("text").text()));
        }
        return new Context.ArchiveSearch(value.get("archive-empty").flag(), List.copyOf(hits));
    }

    /** A child agent's handle. */
    public static Delegation.SubagentHandle subagentHandle(Value value) {
        return new Delegation.SubagentHandle(value.get("id").text(), value.get("slot").text(),
                value.get("model-id").text());
    }

    /** Every child agent's result. */
    public static List<Delegation.SubagentResult> subagentResults(Value value) {
        List<Delegation.SubagentResult> out = new ArrayList<>(value.size());
        for (int index = 0; index < value.size(); index++) {
            Value result = value.at(index);
            out.add(new Delegation.SubagentResult(result.get("id").text(),
                    optionalText(result.get("status")).map(Read::agentEnding),
                    result.get("summary").text()));
        }
        return List.copyOf(out);
    }

    /** Every program this session has run. */
    public static List<Programs.ProgramSummary> programSummaries(Value value) {
        List<Programs.ProgramSummary> out = new ArrayList<>(value.size());
        for (int index = 0; index < value.size(); index++) {
            Value program = value.at(index);
            out.add(new Programs.ProgramSummary(program.get("id").text(),
                    program.get("turn").integer(),
                    program.get("lines").integer(), program.get("chars").integer(),
                    program.get("ok").flag(), optionalText(program.get("error"))));
        }
        return List.copyOf(out);
    }

    // -------------------------------------------------------------------------------------------
    // The fixed choices
    // -------------------------------------------------------------------------------------------

    /** What a directory entry is, from the case name the wire used. */
    private static Files.EntryKind entryKind(String wire) {
        return switch (wire) {
            case "file" -> Files.EntryKind.FILE;
            case "directory" -> Files.EntryKind.DIRECTORY;
            default -> Files.EntryKind.OTHER;
        };
    }

    /** Who said an archived message, from the case name the wire used. */
    private static Context.MessageRole messageRole(String wire) {
        return switch (wire) {
            case "system" -> Context.MessageRole.SYSTEM;
            case "assistant" -> Context.MessageRole.ASSISTANT;
            case "tool" -> Context.MessageRole.TOOL;
            default -> Context.MessageRole.USER;
        };
    }

    /** Which kind a documentation entry is, from the word the wire used. */
    private static Docs.DocKind docKind(String wire) {
        return switch (wire) {
            case "module" -> Docs.DocKind.MODULE;
            case "type" -> Docs.DocKind.TYPE;
            default -> Docs.DocKind.FUNCTION;
        };
    }

    /** How a child agent ended, from the case name the wire used. */
    private static Delegation.AgentEnding agentEnding(String wire) {
        return switch (wire) {
            case "completed" -> Delegation.AgentEnding.COMPLETED;
            case "exhausted" -> Delegation.AgentEnding.EXHAUSTED;
            case "timed-out" -> Delegation.AgentEnding.TIMED_OUT;
            case "auth-error" -> Delegation.AgentEnding.AUTH_ERROR;
            case "limit-exceeded" -> Delegation.AgentEnding.LIMIT_EXCEEDED;
            default -> Delegation.AgentEnding.MODEL_ERROR;
        };
    }
}
