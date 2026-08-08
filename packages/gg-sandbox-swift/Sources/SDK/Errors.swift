/// A gg call that failed.
///
/// Every function in this SDK is `throws`, and a failing one throws one of these. That is what a
/// Swift author expects of a fallible call, and it is what makes `try` the whole of the ceremony:
/// `let notes = try fs.readTextFile("notes.md")` binds a `String`, and a failure leaves your program
/// with gg told exactly which call failed and on which line.
///
/// Catch the failures you *expect* and branch on `code`, which is a value rather than prose:
///
/// ```swift
/// do {
///     let notes = try fs.readTextFile("notes.md")
///     try view.openText("notes", body: notes)
/// } catch let failure as ToolError where failure.code == .notFound {
///     _ = try fs.writeFile("notes.md", contents: "")
/// }
/// ```
///
/// Let the ones you do not expect out. Swift's top-level code is not a `throws` context, so an
/// uncaught error ends the program — and gg reports the failed call rather than an unexplained stop.
public struct ToolError: Error, CustomStringConvertible, Sendable {
    /// The failure class, so a `catch` branches on a value rather than on prose.
    public let code: ToolErrorCode
    /// The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).
    public let tool: String
    /// What went wrong, in gg's words. Worth showing yourself; not worth matching on.
    public let message: String

    /// gg's own sentence about a failed call: the call, the class, and what went wrong.
    ///
    /// It is gg's convention rather than Swift's. The same line is what the ECMAScript guest's shim
    /// writes and what the native tool-calling path shows, and it is what a model reads when a
    /// failure escapes — so two arms whose uncaught failures read differently would be two arms
    /// whose error rates a study could not compare.
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

/// Why a gg call failed — the `code` on a `ToolError`, and what a `catch` branches on instead of
/// matching on a message.
public enum ToolErrorCode: Sendable {
    /// The arguments were malformed, ill-typed, or out of range — including an agent name this run
    /// does not declare, and an empty list where the call requires one.
    case invalidArgument
    /// The named file, skill, memory, task, epic, issue, subagent, stored program, or documentation
    /// entry does not exist.
    case notFound
    /// Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle, a
    /// duplicate id, a subagent that already returned.
    case conflict
    /// gg refused the call on a rule about your state: a compaction in flight that this call is not
    /// the one it asked for, a memory call while your memories are read-only, a second ending or
    /// hand-over in a turn that already declared one, or a hook that blocked it. A ceiling you ran
    /// into is `limitExceeded`, not this.
    case refused
    /// The call exists but this run's capability set does not offer it. Every name in this SDK is in
    /// scope whatever a run enables, because the SDK is compiled once and a run's capability set is
    /// decided per run — so this is what a call gg withheld comes back as.
    case unavailable
    /// A gg-side ceiling was hit: a shell timeout, a store cap, the delegation depth cap, one of the
    /// view caps your program spends, or the run's wall-clock budget.
    case limitExceeded
    /// The underlying I/O or process failed.
    case ioError
    /// The failure was not classified. Reserved for outcomes raised outside a tool implementation;
    /// nothing you can call produces it.
    case other

    /// gg's own word for this class, as every other execution mode and every other language arm
    /// prints it.
    ///
    /// A Swift case is `notFound` and gg's word is `not-found`. A model that has read one failure
    /// should recognise the next one whichever arm it is on, so the sentence a failure renders as
    /// uses gg's word rather than this SDK's.
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
