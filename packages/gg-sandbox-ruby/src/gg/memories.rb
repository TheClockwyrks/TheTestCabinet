# frozen_string_literal: true

module GG
  # Durable memories, which survive a context compaction.
  #
  # Every mutation hands back the memory budget after it.
  module Memories
    extend Surface::Operations

    # A code half, with a blank normalised to absent.
    #
    # @param value [String, nil] what the program passed
    # @return [String, nil] the value, or nil when it was blank
    # @api private
    def self.present(value)
      value.nil? || value.strip.empty? ? nil : value
    end
    private_class_method :present

    # The membrane's `memory-input`, assembled from the arguments a program wrote.
    #
    # @param name [String] the memory's slug
    # @param description [String] its one-line description
    # @param body [String] its contents
    # @param code [String, nil] the Ruby module reached at `lib.<name>`
    # @param on_use [String, nil] the script gg runs on every use
    # @return [Object] the wire record
    # @api private
    def self.input(name, description, body, code, on_use)
      Wire.record(
        "name" => name,
        "description" => description,
        "body" => body,
        "code" => present(code),
        "onUse" => present(on_use)
      )
    end
    private_class_method :input

    # The membrane's budget record, as the model-facing one.
    #
    # @param usage [Object] the wire record
    # @return [GG::Memories::MemoryUsage] the budget a program reads
    # @api private
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
    private_class_method :usage

    # Record a durable memory that survives a context compaction.
    #
    # A memory may also carry code. `code` is a Ruby module whose methods are reached at
    # `lib.<name>` by every later program this session writes that requires `lib`; `on_use` is a
    # script gg runs on every use of the memory, whose views arrive on the next turn. Neither is
    # context: they cost no window, are never shown back, and count against no body limit.
    #
    # @param name [String] The memory's slug: letters, digits, `-`, `_` and `.`. Every other memory
    #   call takes it, and no two memories may share one.
    # @param description [String] A one-line description of what the memory holds. Where the run
    #   keeps a memory index this is the memory's line in it, and so all that is visible until it is
    #   read.
    # @param body [String] The memory's contents.
    # @param code [String, nil] A Ruby module whose methods are reached at `lib.<name>` for the
    #   rest of the session. Leave it out for a memory that is only prose.
    # @param on_use [String, nil] A script gg runs on every use of the memory. Leave it out for a
    #   memory that runs nothing.
    # @return [GG::Memories::MemoryUsage] how much of the memory budget is now used
    # @raise [GG::Core::ApiError] `:conflict` on a duplicate name, and `:limit_exceeded` when the
    #   body would breach the run's caps.
    def self.write_memory(name, description, body, code: nil, on_use: nil)
      usage(Wire.call("write_memory", "memories", "writeMemory",
                      [input(name, description, body, code, on_use)]))
    end
    operation :write_memory, "memories.write_memory", tool: "write_memory"

    # Replace an existing memory's description and body, keyed on its slug.
    #
    # Its code and on-use script are replaced too — leaving them out clears them.
    #
    # @param name [String] The slug of the memory to replace. Every other argument replaces what it
    #   held.
    # @param description [String] The one-line description to replace the old one with.
    # @param body [String] The contents to replace the old ones with.
    # @param code [String, nil] The Ruby module to replace the old one with. Leave it out to clear
    #   it.
    # @param on_use [String, nil] The script to replace the old one with. Leave it out to clear it.
    # @return [GG::Memories::MemoryUsage] how much of the memory budget is now used
    # @raise [GG::Core::ApiError] `:not_found` when no memory has that name.
    def self.update_memory(name, description, body, code: nil, on_use: nil)
      usage(Wire.call("update_memory", "memories", "updateMemory",
                      [input(name, description, body, code, on_use)]))
    end
    operation :update_memory, "memories.update_memory", tool: "update_memory"

    # Record a new memory whose contents stay out of the context window until they are read.
    #
    # @param name [String] The memory's slug: letters, digits, `-`, `_` and `.`. No two memories may
    #   share one.
    # @param description [String] A one-line description of what the memory holds. Required where
    #   the run keeps an index, since that is the memory's line in it.
    # @param body [String] The initial contents, which stay out of the context window until they are
    #   read.
    # @param code [String, nil] A Ruby module reached at `lib.<name>` once the memory is read.
    #   Leave it out for a memory that is only prose.
    # @param on_use [String, nil] A script gg runs on every read of the memory. Leave it out for a
    #   memory that runs nothing.
    # @return [GG::Memories::MemoryUsage] how much of the memory budget is now used
    # @raise [GG::Core::ApiError] `:conflict` on a duplicate slug, and `:limit_exceeded` when the
    #   contents, or the index entry, would breach a limit.
    def self.create_memory(name, description, body, code: nil, on_use: nil)
      usage(Wire.call("create_memory", "memories", "createMemory",
                      [input(name, description, body, code, on_use)]))
    end
    operation :create_memory, "memories.create_memory", tool: "create_memory"

    # Read one memory's full contents by slug, which is the only thing that brings them into
    # context.
    #
    # A memory that carries code loads that code on being read: gg opens a documentation view of
    # each function the module declares, and a program reaches it at `lib.<key>` by writing
    # `require "lib"`.
    #
    # @param name [String] The memory's slug.
    # @return [String] the memory's contents
    # @raise [GG::Core::ApiError] `:not_found` when no memory has that slug.
    def self.read_memory(name)
      Wire.call("read_memory", "memories", "readMemory", [name])
    end
    operation :read_memory, "memories.read_memory", tool: "read_memory"

    # Revise a memory in place, replacing the one exact occurrence of `search` with `replace`.
    #
    # @param name [String] The slug of the memory to revise.
    # @param search [String] The exact text to find in its contents. It must appear exactly once.
    # @param replace [String] The text to put in its place.
    # @return [GG::Memories::MemoryUsage] how much of the memory budget is now used
    # @raise [GG::Core::ApiError] `:not_found` when the text does not appear, `:conflict` when it
    #   appears more than once, `:limit_exceeded` when the result would be too long, and
    #   `:invalid_argument` when the edit would leave the memory empty.
    def self.edit_memory(name, search, replace)
      usage(Wire.call("edit_memory", "memories", "editMemory", [
                        Wire.record("name" => name, "search" => search, "replace" => replace)
                      ]))
    end
    operation :edit_memory, "memories.edit_memory", tool: "edit_memory"

    # Find the memories mentioning any of `keywords`, best first.
    #
    # Plain case-insensitive substring matching over each memory's slug, description and contents,
    # ranked by how many distinct keywords a memory mentions and then by how often. A search that
    # matches nothing is an empty array.
    #
    # @param keywords [Array<String>] The words to look for, splatted.
    # @return [Array<GG::Memories::MemoryHit>] the memories that matched, best first
    # @raise [GG::Core::ApiError] `:invalid_argument` when every keyword is empty.
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
    operation :search_memories, "memories.search_memories", tool: "search_memories"

    # Evict a memory by name, freeing room in the budget.
    #
    # @param name [String] The memory's slug.
    # @return [GG::Memories::MemoryUsage] how much of the memory budget is still used
    # @raise [GG::Core::ApiError] `:not_found` when no memory has that name.
    def self.delete_memory(name)
      usage(Wire.call("delete_memory", "memories", "deleteMemory", [name]))
    end
    operation :delete_memory, "memories.delete_memory", tool: "delete_memory"

    # How much of the run's durable-memory budget is used, after the call that returned it.
    #
    # Every maximum is optional: each limit can be turned off, and a run's memory strategy applies
    # only some of them, so `nil` means nothing bounds that axis.
    class MemoryUsage
      include Value

      # @return [Integer] Memories currently held.
      attr_reader :count

      # @return [Integer, nil] The most memories this run allows, if it limits the count.
      attr_reader :max_count

      # @return [Integer] Characters of body currently held, across all memories.
      attr_reader :total_chars

      # @return [Integer, nil] The most characters of body this run allows in total, if it limits
      #   the aggregate.
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

    # One memory `GG::Memories.search_memories` matched, and the numbers it was ranked by.
    class MemoryHit
      include Value
      extend Surface::Operations

      # @return [String] The memory's slug — what `GG::Memories.read_memory` takes.
      attr_reader :name

      # @return [String] Its description, or the empty string when it was created without one.
      attr_reader :description

      # @return [Integer] How many distinct keywords it matched — the primary ranking.
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

      # Read this memory's full contents, which a search hit does not carry.
      #
      # @return [String] the memory's contents
      # @raise [GG::Core::ApiError] `:not_found` when the memory has since been deleted.
      def read
        Memories.read_memory(@name)
      end
      member_operation :read, "memories.read_memory", tool: "read_memory"
    end
  end
end
