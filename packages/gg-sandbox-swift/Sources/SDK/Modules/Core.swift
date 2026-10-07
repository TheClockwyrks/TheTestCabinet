/// The types every other module's signatures name: how a call fails, and how a field is patched.
///
/// Every fallible function in this SDK throws a `core.ApiError`, every one of those is classified
/// by a `core.ApiErrorCode`, and every patch call takes a `core.TextEdit`.
///
/// - ggmodule: core
public enum core {
    /// A gg call that failed.
    ///
    /// Every fallible function in this SDK is `throws` and throws one of these. An uncaught one
    /// ends the program, with gg told which call failed and on which line.
    ///
    /// A failure a program expects is an ordinary `catch` on `code`:
    ///
    /// ```swift
    /// do {
    ///     _ = try files.readFile("notes.md")
    /// } catch let failure as core.ApiError where failure.code == .notFound {
    ///     // the file is not there
    /// }
    /// ```
    public struct ApiError: Error, CustomStringConvertible, Sendable {
        /// The failure class, so a catch site branches on a value rather than on prose.
        public let code: ApiErrorCode
        /// The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).
        public let operation: String
        /// What went wrong, in gg's words. It is prose rather than a stable value.
        public let message: String

        /// gg's own sentence about a failed call: the call, the class, and what went wrong.
        public var description: String {
            "`\(operation)` failed (\(code.ggName)): \(message)"
        }

        /// The SDK's own failure, built from the wire's record.
        init(code: ApiErrorCode, operation: String, message: String) {
            self.code = code
            self.operation = operation
            self.message = message
        }
    }

    /// Why a gg call failed — the `code` a catch site branches on.
    public enum ApiErrorCode: Sendable {
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
        /// Every name in this SDK is in scope whatever a run enables, so a withheld call comes back
        /// as this rather than as a compile error.
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

        /// gg's own word for this class, as every other execution mode prints it.
        ///
        /// A Swift case is `notFound` and gg's word is `not-found`.
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

    /// A three-way edit of an optional text field: leave it, empty it, or replace it.
    ///
    /// `.keep` is the default value of every argument that takes one, so a patch that names two
    /// fields leaves the third alone.
    public enum TextEdit: Sendable {
        /// Leave the field as it is.
        case keep
        /// Empty the field.
        case clear
        /// Replace the field with this text.
        case set(String)
    }
}
