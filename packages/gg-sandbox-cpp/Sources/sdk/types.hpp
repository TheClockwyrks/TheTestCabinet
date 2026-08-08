// The **model-facing shapes** this SDK hands back and takes.
//
// Three conventions run through the file, and each is a decision rather than a habit.
//
//   * A value with parts is an AGGREGATE `struct` with public members, so it is built with
//     designated initialisers and read with a dot. A value that is one of a fixed set of things is
//     an `enum class`. A value that is one of a fixed set of things AND carries something is a
//     `std::variant` — which is what C++ has a closed sum type for — or, where the arms are
//     asymmetric enough that a program only ever CONSTRUCTS one, a class with named factories.
//   * A fixed choice is NEVER a string. A model that guesses the spelling of a string constant
//     guesses wrong about as often as it guesses right, and a wrong string is a branch that
//     silently never runs, where `task_status::done` is a name the compiler either knows or does
//     not.
//   * A count is a `std::uint32_t` and a size is a `std::uint64_t` — the wire's own widths, kept
//     rather than narrowed to `int`, because a C++ author reading `total_lines` wants to know it
//     cannot be negative and the standard library's own sizes are unsigned too.
//
// SPELLING. Types are `snake_case` and so are their members, because this SDK arrives in the same
// prelude as `<vector>` and `<string>` and is called with `std::string` arguments: a surface that
// reads like the standard library is a surface a C++ author does not have to switch conventions
// for mid-expression. It is a spelling rather than an identity, and the agreement gate accepts it.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace gg {

// ------------------------------------------------------------------------------------------------
// The workspace
// ------------------------------------------------------------------------------------------------

/// What a command `system::shell` ran reported when it finished.
struct shell_output {
  /// The process's exit status; empty when a signal killed it. Zero means success.
  std::optional<std::int32_t> exit_code;
  /// Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run offloads shell output,
  /// at the configured line/character ceiling, with a note naming the files holding the whole of
  /// it. Under the default `adaptive` mode a command that succeeded returns just that note.
  std::string output;
  /// Whether the cap cut `output`, dropping the head and keeping the tail.
  bool truncated{};
};

/// A text file's window, as the `text_file` alternative of a read carries it.
struct text_file {
  /// The file's text, or just the requested window under a capped read policy.
  std::string contents;
  /// The 1-based first line returned.
  std::uint32_t first_line{};
  /// The 1-based last line returned.
  std::uint32_t last_line{};
  /// The file's total line count, so you know whether to page again.
  std::uint32_t total_lines{};
  /// Whether a 256 KiB byte ceiling cut the returned text.
  bool byte_truncated{};
};

/// A picture's description, as the `image_file` alternative of a read carries it.
struct image_file {
  /// The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
  std::string media_type;
  /// The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
  std::string label;
  /// The file's size in bytes.
  std::uint64_t bytes{};
  /// Whether the picture is being attached to this turn for you to look at.
  bool shown{};
  /// Why it is not being shown; empty when `shown` is true.
  std::optional<std::string> not_shown_reason;
};

/// What `fs::read_file` returned: a text file's window, or a picture's description.
///
/// A picture is a different kind of thing from text, so it is a different alternative rather than
/// a string that happens to be binary — a program that treats an image as text is caught by the
/// `std::get_if` instead of silently writing an empty string somewhere. Image *bytes* never enter
/// the program: gg attaches the picture to the turn so you can look at it directly, which is worth
/// far more than base64 in a variable.
///
/// It is a `std::variant`, which is what C++ has for a value that is exactly one of two things, so
/// narrow it the way you narrow any other:
///
/// ```cpp
/// const auto read = fs::read_file("logo.png");
/// if (const auto* text = std::get_if<text_file>(&read)) {
///   view::open_text("logo", text->contents);
/// } else {
///   view::open_text("logo", std::get<image_file>(read).label);
/// }
/// ```
using file_read = std::variant<text_file, image_file>;

/// What a directory entry is.
enum class entry_kind {
  /// An ordinary file.
  file,
  /// A directory, which you can list in turn.
  directory,
  /// Everything that is neither, a symlink among them.
  other,
};

/// One entry `fs::list_dir` found.
struct dir_entry {
  /// The entry's bare name, with no directory part. Join it with the directory you listed.
  std::string name;
  /// What the entry is.
  entry_kind kind{};
};

// ------------------------------------------------------------------------------------------------
// Memories
// ------------------------------------------------------------------------------------------------

/// How much of the run's durable-memory budget is used, after the call that returned it.
///
/// Every maximum is optional: each limit can be turned off, and a run's memory strategy applies
/// only some of them, so an empty one means nothing bounds that axis — check before subtracting.
struct memory_usage {
  /// Memories currently held.
  std::uint32_t count{};
  /// The most memories this run allows, if it limits the count.
  std::optional<std::uint32_t> max_count;
  /// Characters of body currently held, across all memories.
  std::uint32_t total_chars{};
  /// The most characters of body this run allows in total, if it limits the aggregate.
  std::optional<std::uint32_t> max_total_chars;
  /// Characters the memory index occupies, under a run that keeps one.
  std::optional<std::uint32_t> index_chars;
  /// The most characters the index may occupy, if it is limited.
  std::optional<std::uint32_t> max_index_chars;
};

/// One memory `memory::search_memories` matched, and the numbers it was ranked by.
struct memory_hit {
  /// The memory's slug — what `memory::read_memory` takes.
  std::string name;
  /// Its description, or `""` when it was created without one.
  std::string description;
  /// How many of your distinct keywords it matched — the primary ranking.
  std::uint32_t matched{};
  /// How many times those keywords occur in it — the tiebreak.
  std::uint32_t occurrences{};
  /// A short window of the memory around its first match.
  std::string excerpt;
};

// ------------------------------------------------------------------------------------------------
// The task list and the board
// ------------------------------------------------------------------------------------------------

/// Where a task stands.
enum class task_status {
  /// Not started. Every task begins here.
  pending,
  /// Being worked on now.
  in_progress,
  /// Finished. Tasks blocked on it become actionable once all their blockers are done.
  done,
};

/// How much of the run's task budget is used, after the call that returned it.
struct task_usage {
  /// Tasks currently on the list.
  std::uint32_t count{};
  /// The most tasks this run allows.
  std::uint32_t max_tasks{};
};

/// Where an issue stands.
enum class issue_status {
  /// Not started, and dispatchable once its blockers are done.
  open,
  /// Dispatched, with its assigned agent working on it.
  in_progress,
  /// Finished and, where this run requires reviewers, approved.
  done,
};

/// How much of the run's board budget is used, after the call that returned it.
struct board_usage {
  /// Epics currently on the board.
  std::uint32_t epics{};
  /// The most epics this run allows.
  std::uint32_t max_epics{};
  /// Issues currently on the board.
  std::uint32_t issues{};
  /// The most issues this run allows.
  std::uint32_t max_issues{};
};

/// An epic that was just created: the id its prefix resolved to, and the board budget.
struct epic_created {
  /// The epic's id — the prefix you gave, upper-cased (`auth` becomes `AUTH`). Group issues under
  /// it with this, and its issues are numbered from it (`AUTH-1`).
  std::string id;
  /// How much of the board budget is used.
  board_usage board;
};

/// An issue that was just created: the id the board assigned it, and the board budget.
struct issue_created {
  /// The id the board assigned (`AUTH-1`) — you do not choose it. Use it to block later issues on
  /// this one, or to wait for it.
  std::string id;
  /// How much of the board budget is used.
  board_usage board;
};

// ------------------------------------------------------------------------------------------------
// The context window
// ------------------------------------------------------------------------------------------------

/// What a context reclaim actually freed from the live context window.
struct reclaim_report {
  /// Context items dropped from the live window.
  std::uint32_t items{};
  /// Approximately how many tokens that freed.
  std::uint32_t reclaimed_tokens{};
  /// The workspace paths whose views were evicted. Empty for an archive.
  std::vector<std::string> paths;
  /// The prose summary of what was reclaimed.
  std::string detail;
};

/// Who said an archived message.
enum class message_role {
  /// The system prompt.
  system,
  /// A turn's input to you — a result, a view, or an operator's instruction.
  user,
  /// Something you said.
  assistant,
  /// A tool result, on a session that made tool calls rather than writing programs.
  tool,
};

/// One archived message that matched a search.
struct archive_hit {
  /// The archived message's sequence number.
  std::uint32_t seq{};
  /// Who said it.
  message_role role{};
  /// The message text.
  std::string text;
};

/// What `context::search_archive` found.
struct archive_search {
  /// Nothing has been archived yet, so there was nothing to search. Deliberately distinct from a
  /// search that ran and matched nothing, so you do not archive again believing the first archive
  /// failed.
  bool archive_empty{};
  /// The matches, most recent first, at most 8.
  std::vector<archive_hit> hits;
};

/// An inclusive span of turn numbers, as `context::archive_thread` takes them.
///
/// Both ends are included, so `{.from = 4, .to = 19}` is turns 4 through 19. C++ has no value type
/// for a closed integer range — `std::ranges::iota_view` is a *sequence*, which is not what a span
/// of turn numbers is — so this is an ordinary aggregate, and a list of them is written the way a
/// list of aggregates is: `context::archive_thread({{4, 19}, {30, 36}})`.
struct turn_range {
  /// The first turn in the span.
  std::uint32_t from{};
  /// The last turn in the span, included.
  std::uint32_t to{};
};

// ------------------------------------------------------------------------------------------------
// Views
// ------------------------------------------------------------------------------------------------

/// Which of the three kinds a view is.
///
/// The taxonomy is closed at three on purpose: everything on disk is a file, everything a program
/// can compute is a string, and documentation is neither — gg holds it.
enum class view_kind {
  /// A file you opened; its selector is the path.
  file,
  /// A value you showed yourself; its selector is the label you gave it. A directory listing, a
  /// command's output, a child agent's answer and a table you assembled are all this.
  text,
  /// A function's documentation; its selector is the function's name.
  docs,
};

/// The window of lines a **paged** file view covers.
struct view_region {
  /// The 1-based first line the view shows.
  std::uint32_t offset{};
  /// How many lines it shows.
  std::uint32_t limit{};
};

/// One view open in your context window, as `view::current` reports it.
struct open_view {
  /// Whether it is a file, text, or documentation view.
  view_kind kind{};
  /// What `view::close` takes: a file's path, a text view's label, or a docs view's function name.
  std::string selector;
  /// Roughly what holding it costs you, in tokens.
  std::uint64_t tokens{};
  /// The line window a paged file view covers; empty for a whole-file view and for text views.
  std::optional<view_region> region;
};

/// One function in an API object's directory, as `list` returns it.
///
/// The summary is one line; the whole documentation of a function — every shape it may be called
/// in, what to put in each argument, and the types it refers to — is a view, opened with
/// `view::open_docs_view`.
struct function_summary {
  /// The function name on its object — `read_file` in `fs::read_file`.
  std::string name;
  /// One line saying what it does: the first sentence of its documentation.
  std::string summary;
};

// ------------------------------------------------------------------------------------------------
// Delegation
// ------------------------------------------------------------------------------------------------

/// What a child agent is briefed with — self-contained instructions, or a board issue.
///
/// It is one value with two named factories rather than two optional arguments, so "both" and
/// "neither" are programs that do not compile instead of calls that fail at run time. There is
/// nothing to read back off it: a program builds one and hands it over.
class brief {
 public:
  /// Brief the child with self-contained instructions, which it needs no other context to act on.
  ///
  /// \param instructions What the child is to do, written for a reader with no other context.
  /// \returns the brief to hand to `agents::spawn_subagent`.
  static brief prompt(std::string instructions);

  /// Brief the child from a board issue, whose scope, non-scope and completion criteria become its
  /// instructions.
  ///
  /// \param id The issue's id, as `project::create_issue` returned it.
  /// \returns the brief to hand to `agents::spawn_subagent`.
  static brief issue(std::string id);

  // Not model-facing: what the bridge reads back out of one.
  bool is_issue() const noexcept { return issue_; }
  const std::string& text() const noexcept { return text_; }

 private:
  brief(bool issue, std::string text) : issue_(issue), text_(std::move(text)) {}

  bool issue_;
  std::string text_;
};

/// A child agent that was spawned and is now running in parallel.
struct subagent_handle {
  /// The child's id — pass it to `agents::wait_for_subagents` or `agents::send_message`.
  std::string id;
  /// The agent profile it runs as.
  std::string slot;
  /// The model actually bound to that agent.
  std::string model_id;
};

/// How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them.
enum class agent_status {
  /// It finished normally: it called `harness::finish`, and its summary is what it returned.
  completed,
  /// It hit the per-run turn ceiling.
  exhausted,
  /// It passed its wall-clock deadline.
  timed_out,
  /// A model turn failed.
  model_error,
  /// The run's credential was refused.
  auth_error,
  /// An execution ceiling stopped it — consecutive errors, error rate, or cost.
  limit_exceeded,
};

/// One child agent's collected result.
struct subagent_result {
  /// The child's id.
  std::string id;
  /// How it finished; empty when it produced no return value at all.
  std::optional<agent_status> status;
  /// Its final message.
  std::string summary;
};

// ------------------------------------------------------------------------------------------------
// The program library
// ------------------------------------------------------------------------------------------------

/// One program you have already run, as `programs::history` lists it.
///
/// It describes the program's **shape**, never its source: a directory that inlined every program
/// would put the whole session back in front of you, which is the one thing the library exists to
/// avoid. Fetch the source you actually want with `programs::get`.
struct program_summary {
  /// The turn it ran on — what `programs::get` takes.
  std::uint32_t turn{};
  /// How many lines of source it was.
  std::uint32_t lines{};
  /// How many characters of source it was.
  std::uint32_t chars{};
  /// Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
  bool ok{};
  /// The error it ended with, when it did not run to its end.
  std::optional<std::string> error;
};

}  // namespace gg
