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
import gg.views.Views;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSArray;

/**
 * <b>Reading the wire</b> — every JavaScript value the guest hands back, as the Java value this
 * SDK's signatures promise.
 *
 * <p>Nothing here is model-facing, and nothing here is clever: each function is the one place that
 * knows a field's name on the wire, so a rename is one edit rather than a search. The three
 * shapes worth naming are the ones a language with no {@code undefined} has to decide about — a
 * field the wire may leave out becomes {@link Optional} or {@link OptionalInt}, a discriminated
 * union becomes a real Java subtype, and a fixed choice becomes an enum constant rather than the
 * string it arrived as.
 */
public final class Read {
    private Read() {
    }

    // -------------------------------------------------------------------------------------------
    // The building blocks
    // -------------------------------------------------------------------------------------------

    /** A whole number the wire may have left out. */
    public static OptionalInt optionalInt(JSObject owner, String name) {
        JSObject value = Wire.get(owner, name);
        return Wire.absent(value) ? OptionalInt.empty() : OptionalInt.of(Wire.asInteger(value));
    }

    /** Text the wire may have left out. */
    public static Optional<String> optionalText(JSObject owner, String name) {
        JSObject value = Wire.get(owner, name);
        return Wire.absent(value) ? Optional.empty() : Optional.of(Wire.asString(value));
    }

    /** An array of text, as an unmodifiable list. */
    public static List<String> texts(JSObject owner, String name) {
        JSArray<JSObject> array = Wire.array(owner, name);
        List<String> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            out.add(Wire.asString(array.get(index)));
        }
        return List.copyOf(out);
    }

    // -------------------------------------------------------------------------------------------
    // The results
    // -------------------------------------------------------------------------------------------

    /** What a command reported. */
    public static Shell.ShellOutput shellOutput(JSObject value) {
        return new Shell.ShellOutput(optionalInt(value, "exitCode"), Wire.string(value, "output"),
                Wire.bool(value, "truncated"));
    }

    /** A read, narrowed to the arm the guest tagged it with. */
    public static Files.FileRead fileRead(JSObject value) {
        if ("image".equals(Wire.string(value, "kind"))) {
            return new Files.ImageFile(Wire.string(value, "mediaType"), Wire.string(value, "label"),
                    Wire.integer(value, "bytes"), Wire.bool(value, "shown"),
                    optionalText(value, "notShownReason"));
        }
        return new Files.TextFile(Wire.string(value, "contents"), Wire.integer(value, "firstLine"),
                Wire.integer(value, "lastLine"), Wire.integer(value, "totalLines"),
                Wire.bool(value, "byteTruncated"));
    }

    /** One directory entry. */
    public static Files.DirEntry dirEntry(JSObject value) {
        return new Files.DirEntry(Wire.string(value, "name"), entryKind(Wire.string(value, "kind")));
    }

    /** Every directory entry in an array. */
    public static List<Files.DirEntry> dirEntries(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<Files.DirEntry> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            out.add(dirEntry(array.get(index)));
        }
        return List.copyOf(out);
    }

    /** The memory budget. */
    public static Memories.MemoryUsage memoryUsage(JSObject value) {
        return new Memories.MemoryUsage(Wire.integer(value, "count"), optionalInt(value, "maxCount"),
                Wire.integer(value, "totalChars"), optionalInt(value, "maxTotalChars"),
                optionalInt(value, "indexChars"), optionalInt(value, "maxIndexChars"));
    }

    /** Every memory a search matched. */
    public static List<Memories.MemoryHit> memoryHits(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<Memories.MemoryHit> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject hit = array.get(index);
            out.add(new Memories.MemoryHit(Wire.string(hit, "name"), Wire.string(hit, "description"),
                    Wire.integer(hit, "matched"), Wire.integer(hit, "occurrences"),
                    Wire.string(hit, "excerpt")));
        }
        return List.copyOf(out);
    }

    /** One page of a documentation search. */
    public static Docs.DocSearch docSearch(JSObject value) {
        JSArray<JSObject> array = Wire.array(value, "hits");
        List<Docs.DocHit> hits = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject hit = array.get(index);
            hits.add(new Docs.DocHit(Wire.string(hit, "key"), docKind(Wire.string(hit, "kind")),
                    Wire.string(hit, "module"), Wire.string(hit, "name"),
                    Wire.string(hit, "summary")));
        }
        return new Docs.DocSearch(Wire.integer(value, "total"), Wire.integer(value, "offset"),
                List.copyOf(hits));
    }

    /** The task budget. */
    public static Tasks.TaskUsage taskUsage(JSObject value) {
        return new Tasks.TaskUsage(Wire.integer(value, "count"), Wire.integer(value, "maxTasks"));
    }

    /** The board budget. */
    public static Board.BoardUsage boardUsage(JSObject value) {
        return new Board.BoardUsage(Wire.integer(value, "epics"), Wire.integer(value, "maxEpics"),
                Wire.integer(value, "issues"), Wire.integer(value, "maxIssues"));
    }

    /** An epic that was just created. */
    public static Board.EpicCreated epicCreated(JSObject value) {
        return new Board.EpicCreated(Wire.string(value, "id"),
                boardUsage(Wire.get(value, "board")));
    }

    /** An issue that was just created. */
    public static Board.IssueCreated issueCreated(JSObject value) {
        return new Board.IssueCreated(Wire.string(value, "id"),
                boardUsage(Wire.get(value, "board")));
    }

    /** What a reclaim freed. */
    public static Context.ReclaimReport reclaimReport(JSObject value) {
        return new Context.ReclaimReport(Wire.integer(value, "items"),
                Wire.integer(value, "reclaimedTokens"), texts(value, "paths"),
                Wire.string(value, "detail"));
    }

    /** What an archive search found. */
    public static Context.ArchiveSearch archiveSearch(JSObject value) {
        JSArray<JSObject> array = Wire.array(value, "hits");
        List<Context.ArchiveHit> hits = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject hit = array.get(index);
            hits.add(new Context.ArchiveHit(Wire.integer(hit, "seq"),
                    messageRole(Wire.string(hit, "role")), Wire.string(hit, "text")));
        }
        return new Context.ArchiveSearch(Wire.bool(value, "archiveEmpty"), List.copyOf(hits));
    }

    /** Every view open in the window. */
    public static List<Views.OpenView> openViews(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<Views.OpenView> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject open = array.get(index);
            JSObject region = Wire.get(open, "region");
            out.add(new Views.OpenView(viewKind(Wire.string(open, "kind")),
                    Wire.string(open, "selector"), Wire.integer(open, "tokens"),
                    Wire.absent(region)
                            ? Optional.empty()
                            : Optional.of(new Views.ViewRegion(Wire.integer(region, "offset"),
                                    Wire.integer(region, "limit")))));
        }
        return List.copyOf(out);
    }

    /** A child agent's handle. */
    public static Delegation.SubagentHandle subagentHandle(JSObject value) {
        return new Delegation.SubagentHandle(Wire.string(value, "id"), Wire.string(value, "slot"),
                Wire.string(value, "modelId"));
    }

    /** Every child agent's result. */
    public static List<Delegation.SubagentResult> subagentResults(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<Delegation.SubagentResult> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject result = array.get(index);
            out.add(new Delegation.SubagentResult(Wire.string(result, "id"),
                    optionalText(result, "status").map(Read::agentEnding),
                    Wire.string(result, "summary")));
        }
        return List.copyOf(out);
    }

    /** Every program this session has run. */
    public static List<Programs.ProgramSummary> programSummaries(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<Programs.ProgramSummary> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject program = array.get(index);
            out.add(new Programs.ProgramSummary(Wire.integer(program, "turn"),
                    Wire.integer(program, "lines"), Wire.integer(program, "chars"),
                    Wire.bool(program, "ok"), optionalText(program, "error")));
        }
        return List.copyOf(out);
    }

    // -------------------------------------------------------------------------------------------
    // The fixed choices
    // -------------------------------------------------------------------------------------------

    /** What a directory entry is, from the word the wire used. */
    private static Files.EntryKind entryKind(String wire) {
        return switch (wire) {
            case "file" -> Files.EntryKind.FILE;
            case "directory" -> Files.EntryKind.DIRECTORY;
            default -> Files.EntryKind.OTHER;
        };
    }

    /** Who said an archived message, from the word the wire used. */
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
        return "type".equals(wire) ? Docs.DocKind.TYPE : Docs.DocKind.FUNCTION;
    }

    /** Which kind a view is, from the word the wire used. */
    private static Views.ViewKind viewKind(String wire) {
        return switch (wire) {
            case "file" -> Views.ViewKind.FILE;
            case "docs" -> Views.ViewKind.DOCS;
            default -> Views.ViewKind.TEXT;
        };
    }

    /** How a child agent ended, from the word the wire used. */
    private static Delegation.AgentEnding agentEnding(String wire) {
        return switch (wire) {
            case "completed" -> Delegation.AgentEnding.COMPLETED;
            case "exhausted" -> Delegation.AgentEnding.EXHAUSTED;
            case "timed_out" -> Delegation.AgentEnding.TIMED_OUT;
            case "auth_error" -> Delegation.AgentEnding.AUTH_ERROR;
            case "limit_exceeded" -> Delegation.AgentEnding.LIMIT_EXCEEDED;
            default -> Delegation.AgentEnding.MODEL_ERROR;
        };
    }
}
