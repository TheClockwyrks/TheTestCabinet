# Drive the tree and search adapters through their JSON arguments

Give `tree` and `search` a test per failure mode on the path a tool-calling model
actually takes — the JSON adapter — and pin down what a search rooted at a
regular file does.

## Current state

Both tools split into a JSON adapter and a typed function the
responses-as-code membrane reaches. `TreeTool`'s adapter is at
`crates/gg/src/tools/filesystem.tree.rs:99` and its typed `tree` at `:126`;
`SearchTool`'s adapter is at `crates/gg/src/tools/filesystem.search.rs:108` and
its typed `search` at `:141`. The adapters hold branches of their own: a
non-string `path` at `filesystem.tree.rs:103` and
`filesystem.search.rs:116`, a `depth` that is not a positive integer at
`filesystem.tree.rs:110`, and a `limit` that is not a positive integer at
`filesystem.search.rs:123`.

One test per file drives an adapter — `the_json_adapter_reads_path_and_depth`
(`crates/gg/src/tools/filesystem.tree.test.rs:305`) and
`the_adapter_reads_query_path_and_limit`
(`crates/gg/src/tools/filesystem.search.test.rs:326`). Every other refusal is
asserted against the typed function: the zero depth at
`filesystem.tree.test.rs:165`, the missing path and the file-as-root at `:284`,
the blank query and the unparseable pattern at
`filesystem.search.test.rs:83`, the zero limit at `:232`, and the missing search
root at `:123`.

`search` treats a `path` that names a regular file as a root the walk yields a
single entry for: `root.exists()` at `filesystem.search.rs:174` admits it and the
walk at `:186` runs over that one file. Its typed docstring states this at
`filesystem.search.rs:135-139`. Nothing asserts it.

Both files have a `workspace()` fixture over a `TempDir`
(`crates/gg/src/tools/filesystem.tree.test.rs:18`,
`crates/gg/src/tools/filesystem.search.test.rs:17`) and a `write` helper beside
it.

## Design

Each case below is its own short `#[tokio::test]` calling the tool's `invoke`
with a synthesized JSON argument object. A refusal asserts
`ToolFailure::InvalidArgument` or `NotFound` and that the message names the
argument at fault.

### `crates/gg/src/tools/filesystem.tree.test.rs`

- `a_tree_path_that_is_not_a_string_is_an_argument_error` — `"path": 7`.
- `a_tree_depth_that_is_not_a_whole_number_is_an_argument_error` — `"depth":
  -1`.
- `a_tree_depth_of_zero_is_an_argument_error_through_the_adapter` — `"depth": 0`.
- `an_empty_tree_path_is_an_argument_error` — `"path": "  "`.
- `a_tree_of_a_missing_path_is_not_found` — a path nothing occupies.
- `a_tree_of_a_file_is_an_argument_error` — a path naming a regular file; the
  message says it is not a directory.

### `crates/gg/src/tools/filesystem.search.test.rs`

- `a_search_path_that_is_not_a_string_is_an_argument_error` — `"path": true`.
- `a_search_limit_that_is_not_a_whole_number_is_an_argument_error` — `"limit":
  "many"`, and a second call with `"limit": -3`.
- `a_search_limit_of_zero_is_an_argument_error_through_the_adapter` — `"limit":
  0`.
- `a_blank_search_query_is_an_argument_error` — `"query": "   "`.
- `a_search_pattern_that_does_not_parse_is_an_argument_error` — `"query": "["`;
  the message carries the regex compiler's own words.
- `an_empty_search_path_is_an_argument_error` — `"path": ""`.
- `a_search_of_a_missing_path_is_not_found` — a path nothing occupies.
- `a_search_rooted_at_a_file_searches_that_one_file` — two files each holding the
  pattern, `path` naming one of them; the matches all name that file.

## Done when

- [ ] Every failure mode of `tree` and `search` has a test driving it through the
      tool's `invoke`.
- [ ] Each adapter branch listed above is entered by an ill-typed argument.
- [ ] A search rooted at a regular file is asserted to answer from that file
      alone.
- [ ] Gates green.
