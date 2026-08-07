package gg.internal;

import gg.AgentEnding;
import gg.ArchiveHit;
import gg.ArchiveSearch;
import gg.BoardUsage;
import gg.DirEntry;
import gg.EntryKind;
import gg.EpicCreated;
import gg.FileRead;
import gg.FunctionSummary;
import gg.ImageFile;
import gg.IssueCreated;
import gg.MemoryHit;
import gg.MemoryUsage;
import gg.MessageRole;
import gg.OpenView;
import gg.ProgramSummary;
import gg.ReclaimReport;
import gg.ShellOutput;
import gg.SubagentHandle;
import gg.SubagentResult;
import gg.TaskUsage;
import gg.TextFile;
import gg.ViewKind;
import gg.ViewRegion;
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
    public static ShellOutput shellOutput(JSObject value) {
        return new ShellOutput(optionalInt(value, "exitCode"), Wire.string(value, "output"),
                Wire.bool(value, "truncated"));
    }

    /** A read, narrowed to the arm the guest tagged it with. */
    public static FileRead fileRead(JSObject value) {
        if ("image".equals(Wire.string(value, "kind"))) {
            return new ImageFile(Wire.string(value, "mediaType"), Wire.string(value, "label"),
                    Wire.integer(value, "bytes"), Wire.bool(value, "shown"),
                    optionalText(value, "notShownReason"));
        }
        return new TextFile(Wire.string(value, "contents"), Wire.integer(value, "firstLine"),
                Wire.integer(value, "lastLine"), Wire.integer(value, "totalLines"),
                Wire.bool(value, "byteTruncated"));
    }

    /** One directory entry. */
    public static DirEntry dirEntry(JSObject value) {
        return new DirEntry(Wire.string(value, "name"), entryKind(Wire.string(value, "kind")));
    }

    /** Every directory entry in an array. */
    public static List<DirEntry> dirEntries(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<DirEntry> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            out.add(dirEntry(array.get(index)));
        }
        return List.copyOf(out);
    }

    /** The memory budget. */
    public static MemoryUsage memoryUsage(JSObject value) {
        return new MemoryUsage(Wire.integer(value, "count"), optionalInt(value, "maxCount"),
                Wire.integer(value, "totalChars"), optionalInt(value, "maxTotalChars"),
                optionalInt(value, "indexChars"), optionalInt(value, "maxIndexChars"));
    }

    /** Every memory a search matched. */
    public static List<MemoryHit> memoryHits(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<MemoryHit> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject hit = array.get(index);
            out.add(new MemoryHit(Wire.string(hit, "name"), Wire.string(hit, "description"),
                    Wire.integer(hit, "matched"), Wire.integer(hit, "occurrences"),
                    Wire.string(hit, "excerpt")));
        }
        return List.copyOf(out);
    }

    /** The task budget. */
    public static TaskUsage taskUsage(JSObject value) {
        return new TaskUsage(Wire.integer(value, "count"), Wire.integer(value, "maxTasks"));
    }

    /** The board budget. */
    public static BoardUsage boardUsage(JSObject value) {
        return new BoardUsage(Wire.integer(value, "epics"), Wire.integer(value, "maxEpics"),
                Wire.integer(value, "issues"), Wire.integer(value, "maxIssues"));
    }

    /** An epic that was just created. */
    public static EpicCreated epicCreated(JSObject value) {
        return new EpicCreated(Wire.string(value, "id"),
                boardUsage(Wire.get(value, "board")));
    }

    /** An issue that was just created. */
    public static IssueCreated issueCreated(JSObject value) {
        return new IssueCreated(Wire.string(value, "id"),
                boardUsage(Wire.get(value, "board")));
    }

    /** What a reclaim freed. */
    public static ReclaimReport reclaimReport(JSObject value) {
        return new ReclaimReport(Wire.integer(value, "items"),
                Wire.integer(value, "reclaimedTokens"), texts(value, "paths"),
                Wire.string(value, "detail"));
    }

    /** What an archive search found. */
    public static ArchiveSearch archiveSearch(JSObject value) {
        JSArray<JSObject> array = Wire.array(value, "hits");
        List<ArchiveHit> hits = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject hit = array.get(index);
            hits.add(new ArchiveHit(Wire.integer(hit, "seq"),
                    messageRole(Wire.string(hit, "role")), Wire.string(hit, "text")));
        }
        return new ArchiveSearch(Wire.bool(value, "archiveEmpty"), List.copyOf(hits));
    }

    /** Every view open in the window. */
    public static List<OpenView> openViews(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<OpenView> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject open = array.get(index);
            JSObject region = Wire.get(open, "region");
            out.add(new OpenView(viewKind(Wire.string(open, "kind")),
                    Wire.string(open, "selector"), Wire.integer(open, "tokens"),
                    Wire.absent(region)
                            ? Optional.empty()
                            : Optional.of(new ViewRegion(Wire.integer(region, "offset"),
                                    Wire.integer(region, "limit")))));
        }
        return List.copyOf(out);
    }

    /** A child agent's handle. */
    public static SubagentHandle subagentHandle(JSObject value) {
        return new SubagentHandle(Wire.string(value, "id"), Wire.string(value, "slot"),
                Wire.string(value, "modelId"));
    }

    /** Every child agent's result. */
    public static List<SubagentResult> subagentResults(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<SubagentResult> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject result = array.get(index);
            out.add(new SubagentResult(Wire.string(result, "id"),
                    optionalText(result, "status").map(Read::agentEnding),
                    Wire.string(result, "summary")));
        }
        return List.copyOf(out);
    }

    /** Every program this session has run. */
    public static List<ProgramSummary> programSummaries(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<ProgramSummary> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject program = array.get(index);
            out.add(new ProgramSummary(Wire.integer(program, "turn"),
                    Wire.integer(program, "lines"), Wire.integer(program, "chars"),
                    Wire.bool(program, "ok"), optionalText(program, "error")));
        }
        return List.copyOf(out);
    }

    /** Every function an object's directory named. */
    public static List<FunctionSummary> functionSummaries(JSObject value) {
        JSArray<JSObject> array = Wire.asArray(value);
        List<FunctionSummary> out = new ArrayList<>(array.getLength());
        for (int index = 0; index < array.getLength(); index++) {
            JSObject entry = array.get(index);
            out.add(new FunctionSummary(Wire.string(entry, "name"),
                    Wire.string(entry, "summary")));
        }
        return List.copyOf(out);
    }

    // -------------------------------------------------------------------------------------------
    // The fixed choices
    // -------------------------------------------------------------------------------------------

    /** What a directory entry is, from the word the wire used. */
    private static EntryKind entryKind(String wire) {
        return switch (wire) {
            case "file" -> EntryKind.FILE;
            case "directory" -> EntryKind.DIRECTORY;
            default -> EntryKind.OTHER;
        };
    }

    /** Who said an archived message, from the word the wire used. */
    private static MessageRole messageRole(String wire) {
        return switch (wire) {
            case "system" -> MessageRole.SYSTEM;
            case "assistant" -> MessageRole.ASSISTANT;
            case "tool" -> MessageRole.TOOL;
            default -> MessageRole.USER;
        };
    }

    /** Which kind a view is, from the word the wire used. */
    private static ViewKind viewKind(String wire) {
        return switch (wire) {
            case "file" -> ViewKind.FILE;
            case "docs" -> ViewKind.DOCS;
            default -> ViewKind.TEXT;
        };
    }

    /** How a child agent ended, from the word the wire used. */
    private static AgentEnding agentEnding(String wire) {
        return switch (wire) {
            case "completed" -> AgentEnding.COMPLETED;
            case "exhausted" -> AgentEnding.EXHAUSTED;
            case "timed_out" -> AgentEnding.TIMED_OUT;
            case "auth_error" -> AgentEnding.AUTH_ERROR;
            case "limit_exceeded" -> AgentEnding.LIMIT_EXCEEDED;
            default -> AgentEnding.MODEL_ERROR;
        };
    }
}
