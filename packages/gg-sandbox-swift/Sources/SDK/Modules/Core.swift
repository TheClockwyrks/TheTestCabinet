/// The types every other module's signatures name: how a call fails, and what a directory lists.
///
/// A capability module owns the types it produces, so `files.FileRead` belongs to `files` and
/// `board.IssueCreated` to `board`. These four belong to none of them because they belong to all of
/// them: every fallible function in this SDK throws a `core.ToolError`, every module's `list` hands
/// back `core.FunctionSummary`, and both patch calls take a `core.TextEdit`.
///
/// It is the one module with no `list`, because it offers no capability to list: it conforms to
/// `ModuleDirectory` nowhere, and the reflector refuses a catalogue in which it does.
///
/// - ggmodule: core
public enum core {
    /// A gg call that failed.
    ///
    /// Every fallible function in this SDK is `throws` and throws one of these, which is what a
    /// Swift author expects of a fallible call and what makes `try` the whole of the ceremony:
    /// `let notes = try files.readTextFile("notes.md")` binds a `String`, and a failure ends the
    /// program with gg told exactly which call failed and on which line.
    ///
    /// A failure a program expects is an ordinary `catch` on `code`, which is a value rather than
    /// prose:
    ///
    /// ```swift
    /// do {
    ///     try views.openText("notes", body: try files.readTextFile("notes.md"))
    /// } catch let failure as core.ToolError where failure.code == .notFound {
    ///     try files.writeFile("notes.md", contents: "")
    /// }
    /// ```
    public struct ToolError: Error, CustomStringConvertible, Sendable {
        /// The failure class, so a catch site branches on a value rather than on prose.
        public let code: ToolErrorCode
        /// The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).
        public let tool: String
        /// What went wrong, in gg's words. Worth showing in a view; not worth matching on.
        public let message: String

        /// gg's own sentence about a failed call: the call, the class, and what went wrong.
        ///
        /// It is gg's convention rather than Swift's. The same line is what the ECMAScript guest's
        /// shim writes and what the native tool-calling path shows, and it is what a model reads
        /// when a failure escapes — so two arms whose uncaught failures read differently would be
        /// two arms whose error rates a study could not compare.
        public var description: String {
            "`\(tool)` failed (\(code.ggName)): \(message)"
        }

        /// The SDK's own failure, built from the wire's record.
        init(code: ToolErrorCode, tool: String, message: String) {
            self.code = code
            self.tool = tool
            self.message = message
        }
    }

    /// Why a gg call failed — the `code` a catch site branches on.
    public enum ToolErrorCode: Sendable {
        /// The arguments were malformed, ill-typed, or out of range.
        ///
        /// It covers an agent name this run does not declare, and an empty list where the call
        /// requires one.
        case invalidArgument
        /// The named thing does not exist.
        ///
        /// A file, a skill, a memory, a task, an epic, an issue, a subagent, a stored program, or a
        /// documentation entry.
        case notFound
        /// Well-formed, but in conflict with the current state.
        ///
        /// An ambiguous edit, a dependency cycle, a duplicate id, a subagent that has already
        /// returned.
        case conflict
        /// gg refused the call on a rule about the session's state.
        ///
        /// A compaction in flight that this call is not the one it asked for, a memory call while
        /// memories are read-only, a second ending or hand-over in a turn that already declared
        /// one, or a hook that blocked it. A ceiling that was reached is `.limitExceeded` rather
        /// than this.
        case refused
        /// The call exists and this run's capability set does not offer it.
        ///
        /// Every name in this SDK is in scope whatever a run enables, because the module is
        /// compiled once and a run's capability set is decided per run — so a withheld call comes
        /// back as this rather than as a compile error.
        case unavailable
        /// A gg-side ceiling was reached.
        ///
        /// A shell timeout, a store cap, the delegation depth cap, or the run's wall-clock budget.
        case limitExceeded
        /// The underlying input, output or process failed.
        case ioError
        /// The failure was not classified.
        ///
        /// Reserved for outcomes raised outside a tool implementation; no call in this SDK produces
        /// it.
        case other

        /// gg's own word for this class, as every other execution mode and every other language arm
        /// prints it.
        ///
        /// A Swift case is `notFound` and gg's word is `not-found`. A model that has read one
        /// failure should recognise the next one whichever arm it is on, so the sentence a failure
        /// renders as uses gg's word rather than this SDK's.
        public var ggName: String {
            switch self {
            case .invalidArgument: "invalid-argument"
            case .notFound: "not-found"
            case .conflict: "conflict"
            case .refused: "refused"
            case .unavailable: "unavailable"
            case .limitExceeded: "limit-exceeded"
            case .ioError: "io-error"
            case .other: "other"
            }
        }

        /// The case a wire code names.
        init(wire code: test_cabinet_gg_types_error_code_t) {
            switch Int32(code) {
            case TEST_CABINET_GG_TYPES_ERROR_CODE_INVALID_ARGUMENT: self = .invalidArgument
            case TEST_CABINET_GG_TYPES_ERROR_CODE_NOT_FOUND: self = .notFound
            case TEST_CABINET_GG_TYPES_ERROR_CODE_CONFLICT: self = .conflict
            case TEST_CABINET_GG_TYPES_ERROR_CODE_REFUSED: self = .refused
            case TEST_CABINET_GG_TYPES_ERROR_CODE_UNAVAILABLE: self = .unavailable
            case TEST_CABINET_GG_TYPES_ERROR_CODE_LIMIT_EXCEEDED: self = .limitExceeded
            case TEST_CABINET_GG_TYPES_ERROR_CODE_IO_ERROR: self = .ioError
            default: self = .other
            }
        }
    }

    /// One function in a module's directory, as `list` returns it.
    ///
    /// The summary is one line. A function's whole documentation — every argument, what to put in
    /// it, and the types it refers to — is a view, opened with `views.openDocsView`.
    public struct FunctionSummary: Sendable {
        /// The function's name in its module — `readFile` in `files.readFile`.
        public let name: String
        /// One line saying what it does.
        public let summary: String

        init(wire: test_cabinet_gg_docs_function_summary_t) {
            name = lift(wire.name)
            summary = lift(wire.summary)
        }
    }

    /// A three-way edit of an optional text field: leave it, empty it, or replace it.
    ///
    /// It is an `enum` because the field really has three states: a `String?` could say only two,
    /// and would make "clear it" and "set it to the empty string" one request.
    ///
    /// `.keep` is the default value of every argument that takes one, so a patch that names two
    /// fields leaves the third alone — which is what leaving a field out of a patch has to mean.
    /// The board's `updateIssue` takes the same type.
    public enum TextEdit: Sendable {
        /// Leave the field as it is.
        case keep
        /// Empty the field.
        case clear
        /// Replace the field with this text.
        case set(String)
    }
}
