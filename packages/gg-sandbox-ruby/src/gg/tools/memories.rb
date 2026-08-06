# frozen_string_literal: true

module GG
  # The `memory` family: durable notes that survive context compaction.
  #
  # A run picks one of three memory strategies, and only that strategy's functions are enabled — so
  # `memory.list` is the honest answer to "what can I do with memory here?". The scratchpad keeps
  # every memory in the context window (`write_memory`/`update_memory`); the two file-shaped
  # strategies keep the contents *outside* it
  # (`create_memory`/`read_memory`/`edit_memory`), one behind an index that is always in context
  # and one behind `search_memories`. `delete_memory` is offered under all three.
  #
  # Every mutation returns the budget after it, so a program can decide whether to write another
  # memory by reading numbers rather than by parsing a sentence about them.
  #
  # **Why the three writes take their fields as arguments rather than a record.** The membrane
  # declares one `memory-input` for all of them, and a language whose optional arguments are
  # keyword arguments has no reason to make a model construct a value before it can make a call:
  # `memory.create_memory(name, description, body, code: …)` is the same information with one fewer
  # thing to get right.
  #
  # @api private
  module Memories
    # A code half, with a blank normalised to absent.
    #
    # @param value [String, nil] what the program passed
    # @return [String, nil] the value, or nil when it was blank
    def self.present(value)
      value.nil? || value.strip.empty? ? nil : value
    end

    # The membrane's `memory-input`, assembled from the arguments a program wrote.
    #
    # @param name [String] the memory's slug
    # @param description [String] its one-line description
    # @param body [String] its contents
    # @param code [String, nil] the Ruby module bound at `lib.<name>`
    # @param on_use [String, nil] the script gg runs on first use
    # @return [Object] the wire record
    def self.input(name, description, body, code, on_use)
      Wire.record(
        "name" => name,
        "description" => description,
        "body" => body,
        "code" => present(code),
        "onUse" => present(on_use)
      )
    end

    # The membrane's budget record, as the model-facing one.
    #
    # @param usage [Object] the wire record
    # @return [MemoryUsage] the budget a program reads
    def self.usage(usage)
      MemoryUsage.new(
        count: Wire.field(usage, "count"),
        max_count: Wire.field(usage, "maxCount"),
        total_chars: Wire.field(usage, "totalChars"),
        max_total_chars: Wire.field(usage, "maxTotalChars"),
        index_chars: Wire.field(usage, "indexChars"),
        max_index_chars: Wire.field(usage, "maxIndexChars")
      )
    end

    # Record a durable memory that survives context compaction, and return how much of the memory
    # budget is now used.
    #
    # A memory may also carry **code**. `code` is a Ruby module whose methods are bound at
    # `lib.<name>` in every later program you write, so a helper you get right once you never write
    # again; `on_use` is a script gg runs the first time the memory comes into use, whose views
    # reach you on your next turn. Neither is context — they cost you no window, are never shown
    # back to you, and count against no body limit — and both are bounded on their own.
    #
    # @param name [String] The memory's slug: letters, digits, `-`, `_` and `.`. It is what every
    #   other memory call takes, and no two memories may share one.
    # @param description [String] A one-line description of what the memory holds. Where the run
    #   keeps a memory index this is the memory's line in it, and so all you see of the memory
    #   until you read it.
    # @param body [String] The memory's contents.
    # @param code [String, nil] A Ruby module whose methods are bound at `lib.<name>` for the rest
    #   of your session. Leave it out for a memory that is only prose.
    # @param on_use [String, nil] A script gg runs the first time the memory comes into use;
    #   whatever it shows you arrives on your next turn. Leave it out for a memory that runs
    #   nothing.
    # @return [MemoryUsage] how much of the memory budget is now used
    # @raise [ToolError] `:conflict` on a duplicate name, and `:limit_exceeded` when the body would
    #   breach the run's caps — revise or delete a memory rather than accruing more.
    def self.write_memory(name, description, body, code: nil, on_use: nil)
      usage(Wire.call("write_memory", "memories", "writeMemory",
                      [input(name, description, body, code, on_use)]))
    end

    # Replace an existing memory's description and body, keyed on its `name`, and return the memory
    # budget.
    #
    # Its `code` and `on_use` are replaced too — leaving them out clears them.
    #
    # @param name [String] The slug of the memory to replace. Every other argument replaces what it
    #   held.
    # @param description [String] The one-line description to replace the old one with.
    # @param body [String] The contents to replace the old ones with.
    # @param code [String, nil] The Ruby module to replace the old one with. Leave it out to clear
    #   it.
    # @param on_use [String, nil] The script to replace the old one with. Leave it out to clear it.
    # @return [MemoryUsage] how much of the memory budget is now used
    # @raise [ToolError] `:not_found` when no memory has that name.
    def self.update_memory(name, description, body, code: nil, on_use: nil)
      usage(Wire.call("update_memory", "memories", "updateMemory",
                      [input(name, description, body, code, on_use)]))
    end

    # Record a new memory whose contents are kept OUT of your context window until you read them,
    # and return the memory budget.
    #
    # @param name [String] The memory's slug: letters, digits, `-`, `_` and `.`. No two memories
    #   may share one.
    # @param description [String] A one-line description of what the memory holds. Required where
    #   the run keeps an index, since that is the memory's line in it.
    # @param body [String] The initial contents. They stay out of your context window until you
    #   read them.
    # @param code [String, nil] A Ruby module bound at `lib.<name>` once you read the memory. Leave
    #   it out for a memory that is only prose.
    # @param on_use [String, nil] A script gg runs on that first read. Leave it out for a memory
    #   that runs nothing.
    # @return [MemoryUsage] how much of the memory budget is now used
    # @raise [ToolError] `:conflict` on a duplicate slug, and `:limit_exceeded` when the contents,
    #   or the index entry, would breach a limit.
    def self.create_memory(name, description, body, code: nil, on_use: nil)
      usage(Wire.call("create_memory", "memories", "createMemory",
                      [input(name, description, body, code, on_use)]))
    end

    # Read one memory's full contents, by slug — the only thing that brings them into your context.
    #
    # If the memory carries code, reading it also loads that code: the reply names the `lib.<key>`
    # it is bound at, and it stays bound for the rest of your session.
    #
    # @param name [String] The memory's slug.
    # @return [String] the memory's contents
    # @raise [ToolError] `:not_found` when no memory has that slug.
    def self.read_memory(name)
      Wire.call("read_memory", "memories", "readMemory", [name])
    end

    # Revise a memory in place by replacing the one exact occurrence of `search` with `replace`,
    # and return the memory budget.
    #
    # Append by quoting the last line and replacing it with itself plus what you are adding.
    #
    # @param name [String] The slug of the memory to revise.
    # @param search [String] The exact text to find in its contents. It must appear exactly once.
    # @param replace [String] The text to put in its place.
    # @return [MemoryUsage] how much of the memory budget is now used
    # @raise [ToolError] `:not_found` when the text does not appear, `:conflict` when it appears
    #   more than once, `:limit_exceeded` when the result would be too long, and
    #   `:invalid_argument` when the edit would leave the memory empty — delete it instead.
    def self.edit_memory(name, search, replace)
      usage(Wire.call("edit_memory", "memories", "editMemory", [
                        Wire.record("name" => name, "search" => search, "replace" => replace)
                      ]))
    end

    # Find the memories mentioning any of `keywords`, best first: plain case-insensitive substring
    # matching over each memory's slug, description and contents, ranked by how many of your
    # keywords a memory mentions and then by how often.
    #
    # Pass several specific words rather than one sentence, then `read_memory` the hits worth
    # having in full. A search that matches nothing is an empty array.
    #
    # @param keywords [Array<String>] The words to look for, splatted. Several specific words rank
    #   better than one sentence, because a memory is ranked by how many of them it mentions.
    # @return [Array<MemoryHit>] the memories that matched, best first
    # @raise [ToolError] `:invalid_argument` when every keyword is empty.
    def self.search_memories(*keywords)
      hits = Wire.call("search_memories", "memories", "searchMemories",
                       [Check.strings("search_memories", "keywords", keywords)])
      hits.map do |hit|
        MemoryHit.new(
          name: Wire.field(hit, "name"),
          description: Wire.field(hit, "description"),
          matched: Wire.field(hit, "matched"),
          occurrences: Wire.field(hit, "occurrences"),
          excerpt: Wire.field(hit, "excerpt")
        )
      end
    end

    # Evict a memory by name, freeing room in the budget, and return what is left in use.
    #
    # @param name [String] The memory's slug.
    # @return [MemoryUsage] how much of the memory budget is still used
    # @raise [ToolError] `:not_found` when no memory has that name.
    def self.delete_memory(name)
      usage(Wire.call("delete_memory", "memories", "deleteMemory", [name]))
    end
  end
end
