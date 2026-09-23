# Cover the memory tools' argument diagnostics and cap breaches

Give every memory tool a test for each argument diagnostic its adapter can
raise, and surface the two store cap variants that no memory tool test reaches.

## Current state

`failure_for` (`crates/gg/src/tools/memories.rs:174`) maps the `MemoryError` cap
variants to `ToolFailure::LimitExceeded` at `:188-193`. `TotalCap`,
`DescriptionCap` and `CodeCap` are raised only in
`crates/gg/src/memories.test.rs`, the first at `:279` and `:315`, the second at
`:520`, `:544` and `:569`, and `CodeCap` nowhere. `CodeCap`
guards a memory's `code`/`onUse` halves (`crates/gg/src/memories.rs:1393-1405`),
and the memory tools' schemas declare no code fields, as the comments at
`crates/gg/src/tools/memories.rs:258`, `:339` and
`crates/gg/src/tools/memories.files.rs:119` each say. It is reachable from the
typed functions the responses-as-code membrane calls, so it belongs with that
surface rather than here.

The scratchpad tools' argument coverage stops at `write_memory`:
`write_memory_validates_missing_arguments`
(`crates/gg/src/tools/memories.test.rs:136`) is the only argument-diagnostic test
in the file, and `each_store_refusal_is_classified_from_its_variant` (`:250`)
covers the store's refusals. `update_memory` and `delete_memory` read their
arguments through `write_args` (`crates/gg/src/tools/memories.rs:436`) and
`required_str` (`crates/gg/src/tools/memories.rs:335` and `:409`) with nothing
asserting either.

The file-shaped tools are the same shape. `create_memory` reads `name`,
`description` and `contents` at
`crates/gg/src/tools/memories.files.rs:107-117`, `read_memory` reads `name` at
`:193` and `edit_memory` reads its three at `:269-282`, and
`crates/gg/src/tools/memories.files.test.rs` asserts the store's refusals
(`:132`, `:155`, `:271`, `:378`) without ever handing a tool an ill-typed or
absent argument.

The fixtures to reuse are `fixture(caps)`
(`crates/gg/src/tools/memories.test.rs:29`) with its `tiny_caps()` at `:46`, and
`fixture(strategy)` / `fixture_with(strategy, caps)`
(`crates/gg/src/tools/memories.files.test.rs:20` and `:25`), which already builds
bounded stores at `:64` and `:159`.

## Design

Each case is its own short `#[tokio::test]` calling the tool's `invoke` with a
synthesized JSON argument object. An argument diagnostic asserts
`ToolFailure::InvalidArgument` and that the message names the field.

### `crates/gg/src/tools/memories.test.rs`

- `a_write_past_the_total_character_cap_is_a_limit` — a store whose
  `max_total_len` is smaller than the sum of two bodies that each fit
  `max_len_per_memory`; the second write is `LimitExceeded`, and the message
  distinguishes the total from the per-memory ceiling.
- `a_write_with_an_over_long_description_is_a_limit` — a store with a
  `max_len_description`; `LimitExceeded`.
- `an_update_past_the_per_memory_cap_is_a_limit` — a memory written under
  `tiny_caps()`, then revised with a body past `max_len_per_memory`.
- `an_update_with_an_over_long_description_is_a_limit` — the same through
  `max_len_description`.
- `an_update_missing_a_required_argument_is_an_argument_error` — one call per
  absent field across `name`, `description` and `body`.
- `an_update_with_an_ill_typed_argument_is_an_argument_error` — `"name": 7`.
- `a_delete_missing_its_name_is_an_argument_error` — `json!({})`.
- `a_delete_with_an_ill_typed_name_is_an_argument_error` — `"name": []`.

### `crates/gg/src/tools/memories.files.test.rs`

- `a_create_missing_its_name_is_an_argument_error` — `json!({ "contents": "x" })`.
- `a_create_missing_its_contents_is_an_argument_error` — `json!({ "name": "n" })`.
- `a_create_with_an_ill_typed_description_is_an_argument_error` —
  `"description": 3`.
- `a_create_past_the_memory_count_cap_is_a_limit` — `fixture_with` bounded by
  `max_count`; `LimitExceeded`.
- `a_create_past_the_per_memory_cap_is_a_limit` — bounded by
  `max_len_per_memory`.
- `a_create_with_an_over_long_description_is_a_limit` — bounded by
  `max_len_description`.
- `a_read_missing_its_name_is_an_argument_error` — `json!({})`.
- `a_read_with_an_ill_typed_name_is_an_argument_error` — `"name": 1`.
- `an_edit_of_an_unknown_memory_is_not_found` — a well-formed edit naming a slug
  the store does not hold; `ToolFailure::NotFound`.
- `an_edit_missing_its_name_or_old_string_is_an_argument_error` — one call per
  absent field.
- `an_edit_with_an_ill_typed_new_string_is_an_argument_error` —
  `"new_string": 5`, which `optional_str` refuses.
- `an_edit_past_the_per_memory_cap_is_a_limit` — a bounded store and a
  replacement longer than the text it replaces; `LimitExceeded`.

## Done when

- [ ] Every memory tool has a test asserting `ToolFailure::InvalidArgument` for
      an absent required argument and for an ill-typed one.
- [ ] `MemoryError::TotalCap`, `DescriptionCap`, `PerMemoryCap` and `CountCap`
      each reach a model through a memory tool in at least one test.
- [ ] `edit_memory` has a test for a memory name the store does not hold.
- [ ] Gates green.
