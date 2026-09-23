# Record the arguments of the calls no gg tool backs

The generated argument gate checks every call gg dispatches, but it can only check
argument order where the call left a tool record behind. Make the double record the
calls no tool backs, so the gate reaches the ids it cannot attribute today.

## Current state

`crates/gg/src/sandbox/membrane/wire.arguments.test.rs` builds each call's
arguments out of gg's own WIT — the same file a guest's SDK lowers against — and
drives every id the wire dispatches with them. Two gates sit on that:
`every_arm_decodes_the_arguments_its_wit_function_declares` (`:70`) asserts that a
well-formed argument list never produces a wire fault, and
`markers_land_where_their_parameter_names` (`:133`) gives every string and every
integer a distinct value built for one named parameter, then reads the JSON the
membrane composed for a tool to see which parameter each field was read from. A
transposition of two same-typed arguments lands a marker under a field named for
the other one, and the gate says so by name.

Both walk `OPERATIONS` and `NON_OPERATIONS` (`crates/gg/src/sandbox/membrane/wire.rs:297`),
so together they are the only exhaustive argument check over the non-tool half of
the surface. The companion reachability walk is
`every_operation_is_reachable_through_the_wire` at
`crates/gg/src/sandbox/membrane/wire.test.rs:65`, with the feedback channel's own
row at `:86`.

There is no language axis here. The wire is one door, the only interface on the
membrane that names a call by a string, and both JVM arms come through it
(`crates/gg/wit/gg-sandbox.wit:1142`, `interface wire` at `:1201`).

The blind spot is stated twice, at `wire.arguments.test.rs:34`-`:37` and again in
the second gate's own doc at `:127`-`:131`, and recorded as a list at `:224`:
`context.archive_thread`, `docs.search`, `views.open_text`,
`feedback.report_error` and `feedback.report_module_error`. The list is asserted
for equality at `:210`, so an id that stops reaching a tool joins it and the gate
reports that rather than going quiet. Three different things put an id there.

`context.archive_thread` does leave a tool record, but the double lowers its ranges
into positional pairs — `json!([range.from, range.to])` at
`crates/gg/src/sandbox/fake.test.rs:575`-`:580` — so the `from` and `to` names are
gone by the time `scalars_by_key` (`wire.arguments.test.rs:258`) looks for them.

`docs.search` and `views.open_text` leave no record at all. The double answers them
from its own state through `search_docs` (`fake.test.rs:642`) and `open_text_view`
(`:717`), neither of which calls `call` (`:301`), so nothing reaches the `CallLog`
(`:90`) the gate reads. Their family's neighbours — `open_docs_view` (`:625`),
`close_docviews` (`:661`), `open_file_view` (`:676`), `close_view` (`:732`),
`program_history` (`:744`) and `program_source` (`:748`) — are answered the same
way and stay out of the list only because each declares fewer than two
same-shaped arguments.

The feedback ids are not `OperationApi` calls in the first place.
`crates/gg/src/sandbox/membrane/wire.rs:281`-`:285` hands them to
`crates/gg/src/sandbox/membrane/wire.session.rs`, which calls the capture host at
`crates/gg/src/sandbox/membrane/capture.rs:237` onwards; `report_module_error`
lands its pair in `MembraneState::module_errors`
(`crates/gg/src/sandbox/membrane.rs:261`) and `report_error` lands a
`ProgramError` in the state's error slot.

The record the gate reads a non-tool call through today is `RecordedApiCall`
(`fake.test.rs:187`), which carries the operation id, whether the call closed and
the class it threw with — and no arguments. Its own comment at `:195`-`:197` notes
that for the calls no tool backs the class is the only record there is.
`UNATTRIBUTED`'s comment at `:219`-`:223` names the fix: a method per family on the
double.

## Design

Three causes, three fixes, each with its own short test. The gate functions stay
as they are and grow the rows the fixes unlock; no one function walks all three.

### The double records what it answered

Give `RecordedApiCall` an `arguments: Value` field carrying the call's arguments
under their WIT parameter names, and fill it from every `FakeOperationApi` method
that answers an operation without calling `call`: `open_docs_view`, `search_docs`,
`close_docviews`, `open_file_view`, `open_text_view`, `close_view`,
`program_history` and `program_source`. `ApiLog` (`fake.test.rs:183`) gains a
reader for the arguments of the first call to an operation, matching `CallLog::args`
(`:117`). The names used are the WIT's own, so `RENAMED`
(`wire.arguments.test.rs:238`) needs no row for any of them.

`archive_thread` keeps its positional pairs, because that is the shape the
production api records and the gate exists to read what production records. What
closes it instead is the same new field: the fake records the ranges a second time
under `from` and `to` keys on the api record, leaving the tool record untouched.

The feedback ids are read out of the membrane state rather than out of either log.
`report_module_error`'s two strings are the pair in `module_errors`;
`report_error`'s markers are the fields of the captured `ProgramError` — its
message, its location and its code.

### The gate reaches them

`markers_land_where_their_parameter_names` gains a lookup that tries, in order, the
tool record, the api record's arguments and the membrane state, and attributes a
marker from whichever answered. `UNATTRIBUTED` becomes empty, and the equality
assertion at `:210` keeps it honest: an operation that stops being attributable
reappears there and the gate reports it.

Both statements of the blind spot — the module header at `:34`-`:37` and the second
gate's doc at `:127`-`:131` — are rewritten to describe what the gate now reaches
and through which of the three records.

### The tests

| Test | What it drives |
| --- | --- |
| `an_archived_range_keeps_its_ends_apart` | `context.archive-thread` with a range whose `from` and `to` are distinct markers; each lands under its own name, and a swap reads as the other |
| `a_docs_search_reads_its_query_and_its_filter_apart` | `docs.search` through the double; every declared parameter is attributed from the api record |
| `a_text_view_reads_its_label_and_its_body_apart` | `views.open-text` with distinct markers for both strings |
| `a_reported_module_error_reads_its_name_and_its_message_apart` | `feedback.report-module-error`; the pair in `module_errors` carries the marker built for each parameter |
| `a_reported_program_error_reads_its_message_and_its_location_apart` | `feedback.report-error`; the captured `ProgramError`'s fields carry the marker built for each |
| `every_id_the_wire_dispatches_is_attributable` | the walk with an empty `UNATTRIBUTED`, which is the gate proper |

## Done when

- [ ] `RecordedApiCall` carries the arguments of the calls no gg tool backs, and
      every `FakeOperationApi` method that answers an operation without a tool fills
      it under the WIT's own parameter names.
- [ ] `markers_land_where_their_parameter_names` attributes a marker from the tool
      record, the api record or the membrane state, and `UNATTRIBUTED` is empty.
- [ ] Each id `UNATTRIBUTED` names has its own short test whose assertion fails
      on a transposition of its two arguments.
- [ ] The blind-spot statements at `wire.arguments.test.rs:34` and `:127` describe
      the three records the gate now reads.
- [ ] No test in the file reaches a model or a provider.
- [ ] Gates green.
