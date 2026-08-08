// The bridge from Swift's idiom onto the canonical ABI — **the one file in this package a model
// never reads**.
//
// Everything above it is written for a Swift author: argument labels, default values, optionals,
// enums with associated values, and `throws`. Everything below it is the C the `wit-bindgen` C
// generator emitted from `crates/gg/wit`, reached through the bridging header. Nothing here is
// public, nothing here is in the signature catalogue, and no doc comment here is model-facing —
// which is why these are `//` comments rather than `///` ones.
//
// TWO DIRECTIONS, TWO DISCIPLINES.
//
// **Lowering** (Swift → C) has to keep bytes alive for exactly as long as a call. The canonical
// ABI's `sandbox_string_t` does not own what it points at, and every import lowers its arguments
// during the call — so a pointer that outlived the call would be a dangling read the first time a
// host function was slow, and one that died early would be a dangling read every time. `Scratch`
// owns every allocation a call needs and frees them together, after the call has returned.
//
// **Lifting** (C → Swift) has to copy and then free. What an import hands back is memory the guest
// owns: `String(decoding:)` copies it into a Swift value, and the generated `*_free` gives it back.
// A program that reads a hundred files in a loop would otherwise grow its own heap until the fuel
// ceiling stopped it, and the failure would read as "your program was too expensive" rather than as
// a leak.

// ------------------------------------------------------------------------------------------------
// Lowering
// ------------------------------------------------------------------------------------------------

/// Every allocation one call's arguments need, freed together once the call has returned.
///
/// A class rather than a struct because the allocations must outlive the expression that made them
/// and die at a point this file chooses; `withScratch` is the only way to get one, so that point is
/// always "after the import returned".
final class Scratch {
    private var allocations: [UnsafeMutableRawPointer] = []

    /// `text`, lowered — pointing at bytes this scratch owns.
    ///
    /// A zero-length string still gets a one-byte allocation: the ABI's length is what decides how
    /// many bytes are read, but a null pointer is not a thing the lowering is specified to accept
    /// and an empty `description` is an ordinary argument here.
    func string(_ text: String) -> sandbox_string_t {
        let bytes = Array(text.utf8)
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: max(bytes.count, 1))
        if !bytes.isEmpty {
            bytes.withUnsafeBufferPointer { source in
                buffer.update(from: source.baseAddress!, count: bytes.count)
            }
        }
        allocations.append(UnsafeMutableRawPointer(buffer))
        return sandbox_string_t(ptr: buffer, len: bytes.count)
    }

    /// `text`, lowered as the ABI's optional — `nil` becoming the absent case.
    func optional(_ text: String?) -> sandbox_option_string_t {
        guard let text else {
            return sandbox_option_string_t(is_some: false, val: sandbox_string_t())
        }
        return sandbox_option_string_t(is_some: true, val: string(text))
    }

    /// `texts`, lowered as a list — each element pointing at bytes this scratch owns.
    func list(_ texts: [String]) -> sandbox_list_string_t {
        let items = UnsafeMutablePointer<sandbox_string_t>.allocate(capacity: max(texts.count, 1))
        for (index, text) in texts.enumerated() {
            items[index] = string(text)
        }
        allocations.append(UnsafeMutableRawPointer(items))
        return sandbox_list_string_t(ptr: items, len: texts.count)
    }

    /// `ranges`, lowered as the ABI's list of turn ranges.
    ///
    /// A `ClosedRange` is what a Swift author writes for an inclusive span, and both of its ends are
    /// included — which is exactly what the wire's `start`/`end` mean.
    func ranges(_ ranges: [ClosedRange<Int>]) -> test_cabinet_gg_context_list_turn_range_t {
        let items = UnsafeMutablePointer<test_cabinet_gg_context_turn_range_t>.allocate(
            capacity: max(ranges.count, 1))
        for (index, range) in ranges.enumerated() {
            items[index] = test_cabinet_gg_context_turn_range_t(
                start: UInt32(truncatingIfNeeded: range.lowerBound),
                end: UInt32(truncatingIfNeeded: range.upperBound))
        }
        allocations.append(UnsafeMutableRawPointer(items))
        return test_cabinet_gg_context_list_turn_range_t(ptr: items, len: ranges.count)
    }

    /// `edit`, lowered as the wire's three-way variant.
    func textEdit(_ edit: TextEdit) -> test_cabinet_gg_types_text_edit_t {
        var lowered = test_cabinet_gg_types_text_edit_t()
        switch edit {
        case .keep:
            lowered.tag = UInt8(TEST_CABINET_GG_TYPES_TEXT_EDIT_KEEP)
        case .clear:
            lowered.tag = UInt8(TEST_CABINET_GG_TYPES_TEXT_EDIT_CLEAR)
        case .set(let text):
            lowered.tag = UInt8(TEST_CABINET_GG_TYPES_TEXT_EDIT_SET)
            lowered.val.set = string(text)
        }
        return lowered
    }

    /// `assignment`, lowered as the wire's three-way variant.
    func epicAssignment(_ assignment: EpicAssignment) -> test_cabinet_gg_board_epic_assignment_t {
        var lowered = test_cabinet_gg_board_epic_assignment_t()
        switch assignment {
        case .keep:
            lowered.tag = UInt8(TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_KEEP)
        case .ungroup:
            lowered.tag = UInt8(TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_UNGROUP)
        case .set(let id):
            lowered.tag = UInt8(TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_SET)
            lowered.val.set = string(id)
        }
        return lowered
    }

    /// `brief`, lowered as the wire's two-case variant.
    func brief(_ brief: Brief) -> test_cabinet_gg_delegation_subagent_brief_t {
        var lowered = test_cabinet_gg_delegation_subagent_brief_t()
        switch brief {
        case .prompt(let text):
            lowered.tag = UInt8(TEST_CABINET_GG_DELEGATION_SUBAGENT_BRIEF_PROMPT)
            lowered.val.prompt = string(text)
        case .issue(let id):
            lowered.tag = UInt8(TEST_CABINET_GG_DELEGATION_SUBAGENT_BRIEF_ISSUE)
            lowered.val.issue = string(id)
        }
        return lowered
    }

    /// Give every allocation back. Called by `withScratch` and by nothing else.
    fileprivate func release() {
        for allocation in allocations {
            allocation.deallocate()
        }
        allocations.removeAll()
    }
}

/// Run `body` with a scratch whose allocations are freed the moment it returns.
///
/// The scope is the whole safety argument: `body` makes the import call, so every pointer the ABI
/// reads is alive for the call and dead immediately after it.
@inline(__always)
func withScratch<R>(_ body: (Scratch) throws -> R) rethrows -> R {
    let scratch = Scratch()
    defer { scratch.release() }
    return try body(scratch)
}

/// A nullable pointer to `value`, which is how the C bindings spell an optional scalar argument.
///
/// `body` gets `nil` for `nil`, which is the absent case, and a pointer to a live copy otherwise.
@inline(__always)
func withOptional<T, R>(_ value: T?, _ body: (UnsafeMutablePointer<T>?) throws -> R) rethrows -> R {
    guard var value else { return try body(nil) }
    return try withUnsafeMutablePointer(to: &value) { try body($0) }
}

// ------------------------------------------------------------------------------------------------
// Lifting
// ------------------------------------------------------------------------------------------------

/// One canonical-ABI string as a Swift `String`, copied out of guest memory.
///
/// It does **not** free: the caller frees the whole record this string came out of, with the
/// generated free for that record's own type, which walks every string in it.
func lift(_ text: sandbox_string_t) -> String {
    guard let pointer = text.ptr, text.len > 0 else { return "" }
    return String(decoding: UnsafeBufferPointer(start: pointer, count: text.len), as: UTF8.self)
}

/// One optional string as a Swift optional.
func lift(_ text: sandbox_option_string_t) -> String? {
    text.is_some ? lift(text.val) : nil
}

/// One list of strings as a Swift array.
func lift(_ list: sandbox_list_string_t) -> [String] {
    guard let pointer = list.ptr, list.len > 0 else { return [] }
    return UnsafeBufferPointer(start: pointer, count: list.len).map(lift)
}

/// Every element of an ABI list, mapped — the shape every list lift here has.
@inline(__always)
func lift<T, R>(_ pointer: UnsafeMutablePointer<T>?, _ count: Int, _ each: (T) -> R) -> [R] {
    guard let pointer, count > 0 else { return [] }
    return UnsafeBufferPointer(start: pointer, count: count).map(each)
}

/// One failed call, as the `Error` a Swift program catches, and the wire record freed.
///
/// It takes the record `inout` because freeing it is half the job: what comes back is guest-owned
/// memory, and the strings are copied into Swift values first.
func lift(failure: inout test_cabinet_gg_types_tool_error_t) -> ToolError {
    let error = ToolError(
        code: ToolErrorCode(wire: failure.code),
        tool: lift(failure.tool),
        message: lift(failure.message))
    test_cabinet_gg_types_tool_error_free(&failure)
    return error
}
