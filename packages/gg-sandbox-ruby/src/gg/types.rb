# frozen_string_literal: true

module GG
  # Why a call failed — the `code` on a raised `ToolError`, and the value a handler branches on
  # instead of matching on prose. Every one of them is a Symbol, so the constants below and the
  # symbol literals a program writes (`:not_found`) are the same value.
  module ToolErrorCode
    # The arguments were malformed, ill-typed, or out of range — including a path that is absolute
    # or climbs out of the workspace, and an agent name this run does not declare.
    INVALID_ARGUMENT = :invalid_argument

    # The named file, skill, memory, task, epic, issue, subagent, stored program, or documentation
    # entry does not exist.
    NOT_FOUND = :not_found

    # Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle, a
    # duplicate id, a subagent that already returned.
    CONFLICT = :conflict

    # gg refused the call on a rule about your state: a compaction in flight that this call is not
    # the one it asked for, a memory call while your memories are read-only, a second ending or
    # hand-over in a turn that already declared one, or a hook that blocked it. A ceiling you ran
    # into is `:limit_exceeded`, not this.
    REFUSED = :refused

    # The call exists but this run's capability set does not offer it. Your program can see every
    # function this SDK has; the ones the run withheld are refused here, by gg, rather than hidden.
    UNAVAILABLE = :unavailable

    # A gg-side ceiling was hit: a shell timeout, a store cap, the delegation depth cap, one of the
    # view caps this program spends, or the run's wall-clock budget.
    LIMIT_EXCEEDED = :limit_exceeded

    # The underlying I/O or process failed.
    IO_ERROR = :io_error

    # The failure was not classified. Reserved for outcomes raised outside a tool implementation
    # (gg's own bridge and degradation paths); nothing you call produces it.
    OTHER = :other
  end

  # What a command `system.shell` ran reported when it finished.
  class ShellOutput
    include Value

    # @return [Integer, nil] The process's exit status; `nil` when a signal killed it. Zero means
    #   success.
    attr_reader :exit_code

    # @return [String] Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run
    #   offloads shell output, at the configured line/character ceiling, with a note naming the
    #   files holding the whole of it. Under the default `adaptive` mode a command that succeeded
    #   returns just that note.
    attr_reader :output

    # @api private
    def initialize(exit_code:, output:, truncated:)
      @exit_code = exit_code
      @output = output
      @truncated = truncated
      freeze
    end

    # @return [Boolean] Whether the cap cut `output`, dropping the head and keeping the tail.
    def truncated?
      @truncated
    end
  end

  # A text file's contents, or the window of lines a capped read policy returned.
  class TextFile
    include Value

    # @return [String] The file's text, or just the requested window under a capped read policy.
    attr_reader :contents

    # @return [Integer] The 1-based first line returned.
    attr_reader :first_line

    # @return [Integer] The 1-based last line returned.
    attr_reader :last_line

    # @return [Integer] The file's total line count, so you know whether to page again.
    attr_reader :total_lines

    # @api private
    def initialize(contents:, first_line:, last_line:, total_lines:, byte_truncated:)
      @contents = contents
      @first_line = first_line
      @last_line = last_line
      @total_lines = total_lines
      @byte_truncated = byte_truncated
      freeze
    end

    # @return [Boolean] A 256 KiB byte ceiling cut the returned text.
    def byte_truncated?
      @byte_truncated
    end
  end

  # A picture gg found where you read a file: what it is, rather than its bytes.
  #
  # The pixels never enter your program. `view.open_file` is what attaches the picture to your turn
  # so you can look at it, which is worth far more than base64 in a variable.
  class ImageFile
    include Value

    # @return [String] The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
    attr_reader :media_type

    # @return [String] The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
    attr_reader :label

    # @return [Integer] The file's size in bytes.
    attr_reader :bytes

    # @return [String, nil] Why it is not being shown; `nil` when it is.
    attr_reader :not_shown_reason

    # @api private
    def initialize(media_type:, label:, bytes:, shown:, not_shown_reason:)
      @media_type = media_type
      @label = label
      @bytes = bytes
      @shown = shown
      @not_shown_reason = not_shown_reason
      freeze
    end

    # @return [Boolean] Whether the picture is being attached to this turn for you to look at.
    def shown?
      @shown
    end
  end

  # What a directory entry is.
  module EntryKind
    # An ordinary file.
    FILE = :file

    # A directory, which you can list in its own right.
    DIRECTORY = :directory

    # Everything that is neither, a symlink among them.
    OTHER = :other
  end

  # One entry `fs.list_dir` found: a bare name, and its kind.
  class DirEntry
    include Value

    # @return [String] The entry's bare name, with no directory part. Join it with the directory
    #   you listed.
    attr_reader :name

    # @return [Symbol] What the entry is: one of `EntryKind`'s symbols.
    attr_reader :kind

    # @api private
    def initialize(name:, kind:)
      @name = name
      @kind = kind
      freeze
    end
  end

  # How much of the run's durable-memory budget is used, after the call that returned it.
  #
  # Every maximum is optional: each limit can be turned off, and a run's memory strategy applies
  # only some of them, so `nil` means nothing bounds that axis — check before subtracting.
  class MemoryUsage
    include Value

    # @return [Integer] Memories currently held.
    attr_reader :count

    # @return [Integer, nil] The most memories this run allows, if it limits the count.
    attr_reader :max_count

    # @return [Integer] Characters of body currently held, across all memories.
    attr_reader :total_chars

    # @return [Integer, nil] The most characters of body this run allows in total, if it limits the
    #   aggregate.
    attr_reader :max_total_chars

    # @return [Integer, nil] Characters the memory index occupies, under a run that keeps one.
    attr_reader :index_chars

    # @return [Integer, nil] The most characters the index may occupy, if it is limited.
    attr_reader :max_index_chars

    # @api private
    def initialize(count:, max_count:, total_chars:, max_total_chars:, index_chars:,
                   max_index_chars:)
      @count = count
      @max_count = max_count
      @total_chars = total_chars
      @max_total_chars = max_total_chars
      @index_chars = index_chars
      @max_index_chars = max_index_chars
      freeze
    end
  end

  # One memory `memory.search_memories` matched, and the numbers it was ranked by.
  class MemoryHit
    include Value

    # @return [String] The memory's slug — what `memory.read_memory` takes.
    attr_reader :name

    # @return [String] Its description, or the empty string when it was created without one.
    attr_reader :description

    # @return [Integer] How many of your distinct keywords it matched — the primary ranking.
    attr_reader :matched

    # @return [Integer] How many times those keywords occur in it — the tiebreak.
    attr_reader :occurrences

    # @return [String] A short window of the memory around its first match.
    attr_reader :excerpt

    # @api private
    def initialize(name:, description:, matched:, occurrences:, excerpt:)
      @name = name
      @description = description
      @matched = matched
      @occurrences = occurrences
      @excerpt = excerpt
      freeze
    end
  end

  # Where a task stands.
  module TaskStatus
    # Not started. Every task begins here.
    PENDING = :pending

    # Being worked on now.
    IN_PROGRESS = :in_progress

    # Finished. Tasks blocked on it become actionable once all their blockers are done.
    DONE = :done

    # Every status a task may be moved to.
    ALL = [PENDING, IN_PROGRESS, DONE].freeze
  end

  # How much of the run's task budget is used, after the call that returned it.
  class TaskUsage
    include Value

    # @return [Integer] Tasks currently on the list.
    attr_reader :count

    # @return [Integer] The most tasks this run allows.
    attr_reader :max_tasks

    # @api private
    def initialize(count:, max_tasks:)
      @count = count
      @max_tasks = max_tasks
      freeze
    end
  end

  # Where an issue stands.
  module IssueStatus
    # Not started, and dispatchable once its blockers are done.
    OPEN = :open

    # Dispatched, with its assigned agent working on it.
    IN_PROGRESS = :in_progress

    # Finished and, where this run requires reviewers, approved.
    DONE = :done

    # Every status an issue may be moved to.
    ALL = [OPEN, IN_PROGRESS, DONE].freeze
  end

  # How much of the run's board budget is used, after the call that returned it.
  class BoardUsage
    include Value

    # @return [Integer] Epics currently on the board.
    attr_reader :epics

    # @return [Integer] The most epics this run allows.
    attr_reader :max_epics

    # @return [Integer] Issues currently on the board.
    attr_reader :issues

    # @return [Integer] The most issues this run allows.
    attr_reader :max_issues

    # @api private
    def initialize(epics:, max_epics:, issues:, max_issues:)
      @epics = epics
      @max_epics = max_epics
      @issues = issues
      @max_issues = max_issues
      freeze
    end
  end

  # An epic that was just created: the id its prefix resolved to, and the board budget.
  class EpicCreated
    include Value

    # @return [String] The epic's id — the prefix you gave, upper-cased (`auth` becomes `AUTH`).
    #   Group issues under it with this, and its issues are numbered from it (`AUTH-1`).
    attr_reader :id

    # @return [BoardUsage] How much of the board budget is used.
    attr_reader :board

    # @api private
    def initialize(id:, board:)
      @id = id
      @board = board
      freeze
    end
  end

  # An issue that was just created: the id the board assigned it, and the board budget.
  class IssueCreated
    include Value

    # @return [String] The id the board assigned (`AUTH-1`) — you do not choose it. Use it to block
    #   later issues on this one, or to wait for it.
    attr_reader :id

    # @return [BoardUsage] How much of the board budget is used.
    attr_reader :board

    # @api private
    def initialize(id:, board:)
      @id = id
      @board = board
      freeze
    end
  end

  # The "leave this field exactly as it is" value, and the default of every patch argument that can
  # also be *cleared*.
  #
  # A field a patch may clear has three states rather than two, and Ruby already spells "absent" as
  # `nil` — which here is the request to clear it. So the third state gets a name of its own: leave
  # the argument out (or pass `UNCHANGED`) to keep what is there, pass `nil` to empty it, pass a
  # string to replace it. A field with no clear state is an ordinary `nil` default, where `nil`
  # simply means you are not changing it.
  module Unchanged
    # Leave the field exactly as it is. It is bound at the top level as well, so a program writes
    # `UNCHANGED` rather than `Unchanged::UNCHANGED`.
    UNCHANGED = :unchanged
  end

  # The default of every patch argument that can also be cleared: leave the argument out to keep
  # what is there, and pass `nil` to empty it.
  UNCHANGED = Unchanged::UNCHANGED

  # What a context reclaim actually freed from the live context window.
  class ReclaimReport
    include Value

    # @return [Integer] Context items dropped from the live window.
    attr_reader :items

    # @return [Integer] Approximately how many tokens that freed.
    attr_reader :reclaimed_tokens

    # @return [Array<String>] The workspace paths whose views were evicted. Empty for an archive.
    attr_reader :paths

    # @return [String] The prose summary of what was reclaimed.
    attr_reader :detail

    # @api private
    def initialize(items:, reclaimed_tokens:, paths:, detail:)
      @items = items
      @reclaimed_tokens = reclaimed_tokens
      @paths = paths
      @detail = detail
      freeze
    end
  end

  # An inclusive span of turn numbers, the unit `context.archive_thread` moves out of your window —
  # and Ruby's own `Range`, because that is what a span of integers is in this language.
  #
  # The numbers are the ones on the header of every result you are given, so `4..19` means exactly
  # the turns you can see numbered 4 through 19, both ends included. An exclusive range (`4...20`)
  # means the same thing and is read the same way.
  TurnRange = ::Range

  # Who said an archived message.
  module MessageRole
    # Your system prompt.
    SYSTEM = :system

    # A message addressed to you — a turn's results, or an operator's instruction.
    USER = :user

    # You.
    ASSISTANT = :assistant

    # A tool result, from a session that ran in tool-calling mode.
    TOOL = :tool
  end

  # One archived message that matched a search.
  class ArchiveHit
    include Value

    # @return [Integer] The archived message's sequence number.
    attr_reader :seq

    # @return [Symbol] Who said it: one of `MessageRole`'s symbols.
    attr_reader :role

    # @return [String] The message text.
    attr_reader :text

    # @api private
    def initialize(seq:, role:, text:)
      @seq = seq
      @role = role
      @text = text
      freeze
    end
  end

  # What `context.search_archive` found.
  class ArchiveSearch
    include Value

    # @return [Array<ArchiveHit>] The matches, most recent first, at most 8.
    attr_reader :hits

    # @api private
    def initialize(archive_empty:, hits:)
      @archive_empty = archive_empty
      @hits = hits
      freeze
    end

    # @return [Boolean] Nothing has been archived yet, so there was nothing to search.
    #   Deliberately distinct from a search that ran and matched nothing, so you do not archive
    #   again believing the first archive failed.
    def archive_empty?
      @archive_empty
    end
  end

  # Which of the three kinds a view is.
  #
  # The taxonomy is closed at three on purpose: everything on disk is a file, everything a program
  # can compute is a string, and documentation is neither — gg holds it.
  module ViewKind
    # A file you opened; its selector is the path.
    FILE = :file

    # A value you showed yourself; its selector is the label you gave it. A directory listing, a
    # command's output, a child agent's answer and a table you assembled are all this kind.
    TEXT = :text

    # A function's documentation; its selector is the function's name.
    DOCS = :docs
  end

  # The window of lines a **paged** file view covers; absent for a whole-file view.
  class ViewRegion
    include Value

    # @return [Integer] The 1-based first line the view shows.
    attr_reader :offset

    # @return [Integer] How many lines it shows.
    attr_reader :limit

    # @api private
    def initialize(offset:, limit:)
      @offset = offset
      @limit = limit
      freeze
    end
  end

  # One view open in your context window, as `view.current` reports it.
  class OpenView
    include Value

    # @return [Symbol] Whether it is a file, text, or documentation view: one of `ViewKind`'s
    #   symbols.
    attr_reader :kind

    # @return [String] What `view.close` takes: a file's path, a text view's label, or a docs
    #   view's function name.
    attr_reader :selector

    # @return [Integer] Roughly what holding it costs you, in tokens.
    attr_reader :tokens

    # @return [ViewRegion, nil] The line window a paged file view covers; `nil` for a whole-file
    #   view and for text views.
    attr_reader :region

    # @api private
    def initialize(kind:, selector:, tokens:, region:)
      @kind = kind
      @selector = selector
      @tokens = tokens
      @region = region
      freeze
    end
  end

  # A child agent that was spawned and is now running in parallel.
  class SubagentHandle
    include Value

    # @return [String] The child's id — pass it to `agents.wait_for_subagents` or
    #   `agents.send_message`.
    attr_reader :id

    # @return [String] The agent profile it runs as.
    attr_reader :slot

    # @return [String] The model actually bound to that agent.
    attr_reader :model_id

    # @api private
    def initialize(id:, slot:, model_id:)
      @id = id
      @slot = slot
      @model_id = model_id
      freeze
    end
  end

  # How a child agent's loop ended — gg's own six words, as the native path also reports them.
  module AgentEnding
    # It finished normally: it called `harness.finish`, and its summary is what it returned.
    COMPLETED = :completed

    # It hit the per-run turn ceiling.
    EXHAUSTED = :exhausted

    # It passed its wall-clock deadline.
    TIMED_OUT = :timed_out

    # A model turn failed.
    MODEL_ERROR = :model_error

    # The run's credential was refused.
    AUTH_ERROR = :auth_error

    # An execution ceiling stopped it — consecutive errors, error rate, or cost.
    LIMIT_EXCEEDED = :limit_exceeded
  end

  # One child agent's collected result.
  class SubagentResult
    include Value

    # @return [String] The child's id.
    attr_reader :id

    # @return [Symbol, nil] How it finished: one of `AgentEnding`'s symbols, or `nil` when it
    #   produced no return value at all.
    attr_reader :status

    # @return [String] Its final message.
    attr_reader :summary

    # @api private
    def initialize(id:, status:, summary:)
      @id = id
      @status = status
      @summary = summary
      freeze
    end
  end

  # One program you have already run, as `programs.history` lists it.
  #
  # It describes the program's **shape**, never its source: a directory that inlined every program
  # would put the whole session back in front of you, which is the one thing the library exists to
  # avoid. Fetch the source you actually want with `programs.get(turn)`.
  class ProgramSummary
    include Value

    # @return [Integer] The turn it ran on — what `programs.get` takes.
    attr_reader :turn

    # @return [Integer] How many lines of source it was.
    attr_reader :lines

    # @return [Integer] How many characters of source it was.
    attr_reader :chars

    # @return [String, nil] The error it ended with, when it did not run to its end; `nil` when it
    #   did.
    attr_reader :error

    # @api private
    def initialize(turn:, lines:, chars:, ok:, error:)
      @turn = turn
      @lines = lines
      @chars = chars
      @ok = ok
      @error = error
      freeze
    end

    # @return [Boolean] Whether it ran to its end, with nothing raised and no sandbox ceiling
    #   stopping it.
    def ok?
      @ok
    end
  end

  # One function in an API object's directory, as `list` returns it.
  #
  # It is the entry of the one function every API object carries whatever a run enables, so a
  # program can always discover what it has. The summary is one line; the whole documentation of a
  # function — every shape it may be called in, what to put in each argument, and the types it
  # refers to — is a view, opened with `view.open_docs_view`.
  class FunctionSummary
    include Value

    # @return [String] The function name on its object — `read_file` in `fs.read_file(...)`.
    attr_reader :name

    # @return [String] One line saying what it does: the first sentence of its documentation.
    attr_reader :summary

    # @api private
    def initialize(name:, summary:)
      @name = name
      @summary = summary
      freeze
    end
  end
end
