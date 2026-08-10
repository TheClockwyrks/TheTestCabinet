# frozen_string_literal: true

module GG
  # Manage the agent's own context window.
  #
  # These are the only calls whose effect is on the conversation rather than on the workspace. They
  # are worth making from a program precisely because a program can decide *when* to: read a set of
  # files, extract what matters, then evict the views, all in one turn.
  module Context
    extend Surface::Operations

    # The membrane's reclaim record, as the model-facing one.
    #
    # @param report [Object] the wire record
    # @return [GG::Context::ReclaimReport] what the reclaim freed
    # @api private
    def self.report(report)
      ReclaimReport.new(
        items: Wire.field(report, "items"),
        reclaimed_tokens: Wire.field(report, "reclaimedTokens"),
        paths: Wire.field(report, "paths"),
        detail: Wire.field(report, "detail")
      )
    end
    private_class_method :report

    # Drop the contents of files that were read out of the context window, freeing their tokens.
    #
    # The files on disk are untouched: this forgets what was read, not what exists.
    #
    # @param path [String, nil] The file whose views to drop. Leave it out to drop every file view
    #   held.
    # @return [GG::Context::ReclaimReport] what the eviction freed
    # @raise [GG::Core::ToolError] `:not_found` when the named path has no view open.
    def self.evict_file_view(path = nil)
      report(Wire.call("evict_file_view", "context", "evictFileView", [Wire.js(path)]))
    end
    operation :evict_file_view, "context.evict_file_view", tool: "evict_file_view"

    # Move whole turns out of the context window and report what that reclaimed.
    #
    # Every result carries a header with its turn number and roughly what holding it costs, which is
    # what names the turns worth dropping. A span is a Ruby `Range` and both ends are included, so
    # `GG::Context.archive_thread(4..19)` archives turns 4 through 19; an exclusive range means the
    # same thing and is read the same way. The agent's own messages in an archived turn are dropped;
    # the results are kept and stay searchable with `GG::Context.search_archive`.
    #
    # @param ranges [Array<GG::Context::TurnRange>] The inclusive spans of turn numbers to move out
    #   of the window, splatted: `GG::Context.archive_thread(4..19, 30..35)`.
    # @return [GG::Context::ReclaimReport] what the archive freed
    # @raise [GG::Core::ToolError] `:invalid_argument` for anything that is not a range of turn
    #   numbers, for an empty list, and for too many spans at once.
    def self.archive_thread(*ranges)
      spans = ranges.flatten.map do |span|
        first, last = Check.span("archive_thread", span)
        Wire.record("start" => first, "end" => last)
      end
      report(Wire.call("archive_thread", "context", "archiveThread", [spans]))
    end
    operation :archive_thread, "context.archive_thread", tool: "archive_thread"

    # Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
    #
    # `archive_empty?` is worth checking before `hits`: it distinguishes "nothing has been archived
    # yet" from "the search ran and matched nothing", so a program does not archive again believing
    # the first archive failed.
    #
    # @param query [String] The substring to look for. Matching is case-insensitive.
    # @return [GG::Context::ArchiveSearch] whether anything is archived at all, and what matched
    # @raise [GG::Core::ToolError] `:invalid_argument` for a blank query.
    def self.search_archive(query)
      found = Wire.call("search_archive", "context", "searchArchive", [query])
      ArchiveSearch.new(
        archive_empty: Wire.field(found, "archiveEmpty"),
        hits: Wire.field(found, "hits").map do |hit|
          ArchiveHit.new(
            seq: Wire.field(hit, "seq"),
            role: Wire.symbol(`#{hit}.role`),
            text: Wire.field(hit, "text")
          )
        end
      )
    end
    operation :search_archive, "context.search_archive", tool: "search_archive"

    # Compact the context window: the detailed thread is dropped and restarted from `summary`.
    #
    # A fresh read of each path in `files` is added to the restarted window. Skills, memories and
    # the task list are kept as they are. gg asks for this call when the window is full, and refuses
    # every other call until it arrives.
    #
    # It does not stop the program: it registers the request and returns, and the rewrite happens
    # once the program has ended. Everything not in the summary and not in `files` is gone, so the
    # summary is written for the agent that comes after and `files` names what it will need in hand.
    #
    # @param summary [String] What the restarted window opens with. Everything not in it and not
    #   re-read from `files` is gone.
    # @param files [Array<String>] The paths to read afresh into the restarted window. Defaults to
    #   none.
    # @return [nil] nothing; the request is registered and the program runs on
    # @raise [GG::Core::ToolError] `:invalid_argument` for a blank summary.
    def self.compact(summary, files: [])
      Wire.call("compact", "context", "compact",
                [summary, Check.strings("compact", "files", files)])
      nil
    end
    operation :compact, "context.compact", tool: "compact"

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

    # An inclusive span of turn numbers, which is Ruby's own `Range`.
    #
    # The numbers are the ones on the header of every result, so `4..19` means exactly the turns
    # numbered 4 through 19, both ends included. An exclusive range (`4...20`) means the same thing
    # and is read the same way.
    TurnRange = ::Range

    # Who said an archived message.
    #
    # Every arm is a Symbol, so a comparison may name the constant or write the literal:
    # `GG::Context::MessageRole::USER` and `:user` are the same value.
    module MessageRole
      # The system prompt.
      SYSTEM = :system

      # A turn's input to the agent — a result, a view, or an operator's instruction.
      USER = :user

      # Something the agent said.
      ASSISTANT = :assistant

      # A tool result, on a session that made tool calls rather than writing programs.
      TOOL = :tool
    end

    # One archived message that matched a search.
    class ArchiveHit
      include Value

      # @return [Integer] The archived message's sequence number.
      attr_reader :seq

      # @return [GG::Context::MessageRole] Who said it.
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

    # What `GG::Context.search_archive` found.
    class ArchiveSearch
      include Value

      # @return [Array<GG::Context::ArchiveHit>] The matches, most recent first, at most 8.
      attr_reader :hits

      # @api private
      def initialize(archive_empty:, hits:)
        @archive_empty = archive_empty
        @hits = hits
        freeze
      end

      # Nothing has been archived yet, so there was nothing to search.
      #
      # Deliberately distinct from a search that ran and matched nothing, so a program does not
      # archive again believing the first archive failed.
      #
      # @return [Boolean]
      def archive_empty?
        @archive_empty
      end
    end
  end
end
