# Cover the compact tool's own dispatch and files list

Drive `CompactTool` through its JSON adapter, and assert every branch of the
`files` list its shared parser normalizes.

## Current state

`parse_compact_request` (`crates/gg/src/tools/context.rs:278`) is the one
definition of a well-formed `compact` call, shared by the tool's adapter
(`crates/gg/src/tools/context.rs:351`), the typed function beneath it (`:366`)
and the agent loop's interception (`crates/gg/src/agent.rs:8188-8198`). It
refuses a `summary` that is absent, non-string or blank at
`crates/gg/src/tools/context.rs:279-285`, refuses a `files` value that is not an
array at `:306-310`, refuses an entry that is not a string at `:292-296`, drops
blanks and collapses duplicates at `:297-300`, and truncates the list to
`MAX_COMPACT_FILES` (`crates/gg/src/tools/context.rs:52`) at `:303`.

The loop path is driven end to end.
`self_compaction_refuses_everything_until_compact_is_called`
(`crates/gg/src/agent.compaction.test.rs:199`) scripts a synthesized `compact`
tool call carrying a summary and one file (`:213-217`), asserts the call is
accepted (`:236`), that the boundary carries the summary (`:246-248`) and that
the named file is re-read into the restarted window (`:255-270`).
`a_malformed_compact_leaves_the_compaction_pending` (`:270`) feeds
`json!({ "files": [] })` and asserts the refusal and the retry.

What the tool's own surface lacks is a test of any kind:
`crates/gg/src/tools/context.test.rs` covers `evict_file_view`,
`archive_thread` and `search_archive`, and never constructs `CompactTool`. The
`files` normalization has no assertion on either path.

`ctx()` (`crates/gg/src/tools/context.test.rs:16`) and the classification test
`argument_diagnostics_are_classified_as_invalid_arguments` (`:244`) are the
harness to extend.

## Design

All of these land in `crates/gg/src/tools/context.test.rs`, beside the existing
argument-parsing section. The adapter cases are `#[tokio::test]`s calling
`CompactTool`'s `invoke`; the normalization cases are plain `#[test]`s over
`parse_compact_request`, the level the sibling range parser is asserted at
(`parse_archive_ranges_refuses_malformed_calls`, `:67`).

### Through the adapter

- `a_well_formed_compact_is_accepted_by_the_tool` — `json!({ "summary": "…",
  "files": ["src/a.ts"] })`; the outcome is ok, its summary is
  `compact context`, and it carries no `ApiData`, because the loop replaces the
  result with what it actually compacted.
- `a_compact_missing_its_summary_is_an_argument_error` —
  `json!({ "files": [] })`; `ToolFailure::InvalidArgument`.
- `a_blank_compact_summary_is_an_argument_error` — `"summary": "   "`.
- `a_compact_summary_that_is_not_a_string_is_an_argument_error` —
  `"summary": 7`.
- `a_compact_files_value_that_is_not_a_list_is_an_argument_error` —
  `"files": "src/a.ts"`; the message names `files`.
- `a_compact_file_entry_that_is_not_a_string_is_an_argument_error` —
  `"files": [7]`.
- `a_compact_with_no_files_is_accepted` — `"summary"` alone, and again with
  `"files": null`; both ok.

### Through the parser

- `compact_file_paths_are_trimmed_and_blanks_dropped` — `["  src/a.ts  ", "",
  "   "]` yields exactly `["src/a.ts"]`.
- `a_repeated_compact_file_is_named_once` — the same path three times, once in a
  padded spelling, yields one entry.
- `the_compact_file_list_is_cut_at_the_ceiling` — `MAX_COMPACT_FILES + 3`
  distinct paths yield `MAX_COMPACT_FILES`, keeping the first ones in order.

## Done when

- [ ] `CompactTool` is driven through its `invoke` with a synthesized JSON
      argument object for the accepted call and for each refusal.
- [ ] Every branch of `parse_compact_request`'s `files` handling has a test.
- [ ] The accepted call is asserted to carry no sidecar.
- [ ] Gates green.
