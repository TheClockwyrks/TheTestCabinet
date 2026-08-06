# frozen_string_literal: true

module GG
  # The map from gg's own vocabulary to this SDK's methods — pure data, calling nothing.
  #
  # Three consumers read it, which is why it is data rather than a `case` somewhere:
  #
  # 1. `GG::Scope`, to build a program's surface. Only the entries whose gg tool name is enabled
  #    for the run become methods on an API object, so the object a model reads is the honest
  #    directory of what this run offers. It is **not** the capability model — the host refuses a
  #    withheld call whatever the guest binds — but a name a model can see is a name it will use.
  # 2. `GG::Scope.bound_tools`, which the component's `bound-tools` export answers with, and which
  #    gg compares against its own `ALL_TOOL_NAMES` on the *committed artifact*. That is the one
  #    drift check that catches a stale `.wasm` rather than a stale source file.
  # 3. `tools/signatures.rb`, which reflects each entry's declaration and YARD documentation out of
  #    this package into `crates/gg/src/sandbox/guests/ruby.signatures.json` — the catalogue gg
  #    renders the system prompt and every documentation view from, for *this* language.
  #
  # It holds one entry per name in `ALL_TOOL_NAMES` (`crates/gg/src/tools/mod.rs`) — there is no
  # class of gg tool a program is denied — and gg asserts exactly that.
  #
  # ## `key`: identity, as against spelling
  #
  # A gg tool carries its own identity: `tool` is its name in `ALL_TOOL_NAMES`, and every
  # language's guest catalogues the same set of them. The model-facing functions that are **not**
  # gg tools have no such name, so each of them carries a `key`: a stable, language-independent
  # identity that a sibling guest for another language uses for the same function, however that
  # language spells it. `request_changes` and `requestChanges` are one function under two
  # spellings, and `key` is what says so.
  #
  # @api private
  module Catalogue
    # read, write, and edit workspace files
    OBJECT_FS = "fs"

    # run shell commands in the workspace
    OBJECT_SYSTEM = "system"

    # the epic/issue board — decompose work into dispatchable issues
    OBJECT_PROJECT = "project"

    # your task list
    OBJECT_TASKS = "tasks"

    # durable memories that survive context compaction
    OBJECT_MEMORY = "memory"

    # show yourself a file, a value, or a function's documentation — the only way material enters
    # your context
    OBJECT_VIEW = "view"

    # manage your own context window
    OBJECT_CONTEXT = "context"

    # delegate work to child agents
    OBJECT_AGENTS = "agents"

    # read authored skills
    OBJECT_SKILLS = "skills"

    # fetch a program you already ran, and hand a patched copy back to be run
    OBJECT_PROGRAMS = "programs"

    # end your session
    OBJECT_HARNESS = "harness"

    # return your verdict on the work you are reviewing
    OBJECT_REVIEW = "review"

    # Every gg tool a program can call, in `ALL_TOOL_NAMES` order: gg's name for it, this SDK's
    # method name, and the module that defines it.
    TOOLS = [
      ["shell", "shell", "Shell"],
      ["read_file", "read_file", "Files"],
      ["write_file", "write_file", "Files"],
      ["edit_file", "edit_file", "Files"],
      ["list_dir", "list_dir", "Files"],
      ["read_skill", "read_skill", "Skills"],
      ["write_memory", "write_memory", "Memories"],
      ["update_memory", "update_memory", "Memories"],
      ["create_memory", "create_memory", "Memories"],
      ["read_memory", "read_memory", "Memories"],
      ["edit_memory", "edit_memory", "Memories"],
      ["search_memories", "search_memories", "Memories"],
      ["delete_memory", "delete_memory", "Memories"],
      ["add_task", "add_task", "Tasks"],
      ["update_task", "update_task", "Tasks"],
      ["set_blocked_by", "set_blocked_by", "Tasks"],
      ["complete_task", "complete_task", "Tasks"],
      ["remove_task", "remove_task", "Tasks"],
      ["create_epic", "create_epic", "Board"],
      ["create_issue", "create_issue", "Board"],
      ["update_issue", "update_issue", "Board"],
      ["set_issue_blocked_by", "set_issue_blocked_by", "Board"],
      ["remove_epic", "remove_epic", "Board"],
      ["remove_issue", "remove_issue", "Board"],
      ["wait_for_issue", "wait_for_issue", "Board"],
      ["evict_file_view", "evict_file_view", "Context"],
      ["archive_thread", "archive_thread", "Context"],
      ["search_archive", "search_archive", "Context"],
      ["compact", "compact", "Context"],
      ["spawn_subagent", "spawn_subagent", "Delegation"],
      ["wait_for_subagents", "wait_for_subagents", "Delegation"],
      ["send_message", "send_message", "Delegation"],
      ["transition_state", "transition_state", "Delegation"],
      ["exec", "exec", "Delegation"],
      ["fork", "fork", "Delegation"]
    ].freeze

    # Every helper bound alongside a tool: its language-independent key, this SDK's method name,
    # and the gg tool it is built on.
    #
    # Deliberately one entry. Reading a file's text is the single most common thing a program does,
    # and forcing a narrowing on it is friction on the hot path; everything else a "standard
    # library" might add is another name in the prompt and another thing for a model to get wrong.
    HELPERS = [
      ["read_text_file", "read_text_file", "read_file"]
    ].freeze

    # Every model-facing function that ends a session — none of them a gg tool: its key, this SDK's
    # method name, the API object it is grouped under, and the role whose programs bind it.
    #
    # An ending is a **result**, and a role's result has a shape: work reports what was done, a
    # review returns a verdict. So there is one method per shape, each carrying exactly what that
    # result is made of, and `GG::Scope` binds only the group matching the ending the host passed.
    SESSION = [
      ["finish", "finish", OBJECT_HARNESS, "standard"],
      ["approve", "approve", OBJECT_REVIEW, "review"],
      ["request_changes", "request_changes", OBJECT_REVIEW, "review"]
    ].freeze

    # Every model-facing view function — the calls that put material into the agent's own context
    # window: its key, this SDK's method name, and the gg tool (if any) that gates it.
    #
    # `open_text`, `open_docs_view`, `close` and `current` are **ungated**, the carve-out `harness`
    # has and for the same reason: a run that enables no tools at all must still be able to show
    # its model something — and must always be able to read what the functions it does have do.
    # `open_file` is a read, so it is gated on `read_file`: a run with reading withheld must not
    # get one through a side door.
    VIEWS = [
      ["open_file", "open_file", "read_file"],
      ["open_text", "open_text", nil],
      ["open_docs_view", "open_docs_view", nil],
      ["close", "close", nil],
      ["current", "current", nil]
    ].freeze

    # Every model-facing function on the **program library** — the object a program reaches back
    # through for the source of a program it already ran. None of them is a gg tool.
    #
    # They carry no gate at all, unlike `VIEWS`, because the whole object is bound or absent
    # together, from the `library` flag the host passes to `run`: a *capability* decides this
    # family, and no tool name stands for it.
    PROGRAMS = [
      ["history", "history"],
      ["get", "get"],
      ["rerun", "rerun"]
    ].freeze

    # Every model-facing function that belongs to **no API object** — because it belongs to all of
    # them.
    #
    # `list` is the whole of it: `GG::Scope` seeds it onto every object it creates, with that
    # object's name closed over, so its bound arity is zero and there is no one object it hangs
    # off. That is why it is a group of its own rather than an entry in `VIEWS` or `TOOLS`: an
    # entry there carries an object, and any object this one named would be a lie about the other
    # eleven.
    META = [
      ["list", "list"]
    ].freeze

    # The **API object** each SDK module's functions are grouped under in a program's scope.
    #
    # A program does not receive flat methods (`read_file`, `create_issue`, …). It receives a small
    # set of namespaced objects — `fs.read_file`, `project.create_issue` — one per module that
    # offers at least one enabled function, so the surface a model has to reason about is a handful
    # of objects rather than thirty loose names.
    OBJECT_FOR_MODULE = {
      "Shell" => OBJECT_SYSTEM,
      "Files" => OBJECT_FS,
      "Skills" => OBJECT_SKILLS,
      "Memories" => OBJECT_MEMORY,
      "Tasks" => OBJECT_TASKS,
      "Board" => OBJECT_PROJECT,
      "Context" => OBJECT_CONTEXT,
      "Delegation" => OBJECT_AGENTS,
      "Views" => OBJECT_VIEW,
      "Programs" => OBJECT_PROGRAMS,
      "Session" => OBJECT_HARNESS,
      "Helpers" => OBJECT_FS,
      "Docs" => OBJECT_VIEW
    }.freeze

    # Every API object, in the order a program's surface is listed in.
    #
    # The order is model-facing: it is the sequence the system prompt's API list renders in, and
    # the sequence the run's agent surface reports. It runs from the objects almost every run has
    # (`fs`, `system`) to the ones a particular shape of agent has (`programs`, `harness`,
    # `review`), because a model reads a list from the top.
    OBJECT_ORDER = [
      OBJECT_FS,
      OBJECT_SYSTEM,
      OBJECT_PROJECT,
      OBJECT_TASKS,
      OBJECT_MEMORY,
      OBJECT_VIEW,
      OBJECT_CONTEXT,
      OBJECT_AGENTS,
      OBJECT_SKILLS,
      OBJECT_PROGRAMS,
      OBJECT_HARNESS,
      OBJECT_REVIEW
    ].freeze

    # The scope name a program reaches its loaded **code modules** through: the code of a skill or
    # a memory it has read, bound at `lib.<name>`.
    #
    # It is not an API object and carries no `list`: nothing there is a gg function, the members
    # are whatever the module's body left behind, and the host already told the model which key
    # each one got and what it offers when it answered the read. It is bound only when at least one
    # module was handed over, so a run with none has no `lib` name at all.
    LIB_OBJECT = "lib"

    # Every type this SDK declares, in the order the catalogue lists them.
    #
    # The order is model-facing in the same way `OBJECT_ORDER` is: a documentation view appends the
    # declarations a signature referred to, and it appends them in this sequence. It runs from the
    # failure type every call can raise, through the workspace, to the session's own shapes.
    #
    # Listed rather than derived because it is an *ordering*, and a reflector that sorted
    # alphabetically would put `AgentEnding` before `ToolError`. `tools/signatures.rb` asserts that
    # every declaration in `gg/types.rb` and `gg/errors.rb` appears here exactly once, so a type
    # added and not listed is a build error rather than a type nothing ever shows a model.
    TYPES = %w[
      ToolError
      ToolErrorCode
      ShellOutput
      TextFile
      ImageFile
      EntryKind
      DirEntry
      MemoryUsage
      MemoryHit
      TaskStatus
      TaskUsage
      IssueStatus
      BoardUsage
      EpicCreated
      IssueCreated
      Unchanged
      ReclaimReport
      TurnRange
      MessageRole
      ArchiveHit
      ArchiveSearch
      ViewKind
      ViewRegion
      OpenView
      SubagentHandle
      AgentEnding
      SubagentResult
      ProgramSummary
      FunctionSummary
    ].freeze
  end
end
