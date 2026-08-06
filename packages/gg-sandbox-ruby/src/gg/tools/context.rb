# frozen_string_literal: true

module GG
  # The `context` family: managing the agent's own context window.
  #
  # These are the only tools whose effect is on the conversation rather than on the workspace. They
  # are worth calling from a program precisely because a program can decide *when* to: read a set
  # of files, extract what matters, then evict the views in the same turn.
  #
  # @api private
  module Context
    # The membrane's reclaim record, as the model-facing one.
    #
    # @param report [Object] the wire record
    # @return [ReclaimReport] what the reclaim freed
    def self.report(report)
      ReclaimReport.new(
        items: Wire.field(report, "items"),
        reclaimed_tokens: Wire.field(report, "reclaimedTokens"),
        paths: Wire.field(report, "paths"),
        detail: Wire.field(report, "detail")
      )
    end

    # Drop the contents of files you have read out of your context window, freeing the tokens they
    # occupy, and report what that reclaimed.
    #
    # The files on disk are untouched — this forgets what you read, not what exists.
    #
    # @param path [String, nil] The file whose views to drop. Leave it out to drop every file view
    #   you hold.
    # @return [ReclaimReport] what the eviction freed
    def self.evict_file_view(path = nil)
      report(Wire.call("evict_file_view", "context", "evictFileView", [Wire.js(path)]))
    end

    # Move whole turns out of your context window and report what that reclaimed.
    #
    # Every result you are given carries a header with its turn number and roughly what holding it
    # costs, so name the turns worth dropping: `context.archive_thread(4..19)` archives turns 4
    # through 19, both ends included. Your own messages in an archived turn are dropped; the
    # results are kept and stay searchable with `context.search_archive`.
    #
    # @param ranges [Array<TurnRange>] The inclusive spans of turn numbers to move out of your
    #   window, splatted: `context.archive_thread(4..19, 30..35)`.
    # @return [ReclaimReport] what the archive freed
    # @raise [ToolError] `:invalid_argument` for anything that is not a range of turn numbers.
    def self.archive_thread(*ranges)
      spans = ranges.flatten.map do |span|
        first, last = Check.span("archive_thread", span)
        Wire.record("start" => first, "end" => last)
      end
      report(Wire.call("archive_thread", "context", "archiveThread", [spans]))
    end

    # Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
    #
    # Check `archive_empty?` before reading `hits`: it distinguishes "nothing has been archived
    # yet" from "the search ran and matched nothing", so you do not archive again believing the
    # first archive failed.
    #
    # @param query [String] The substring to look for. Matching is case-insensitive.
    # @return [ArchiveSearch] whether anything is archived at all, and what matched
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

    # Compact your context window: the detailed thread is dropped and restarted from `summary`,
    # plus a fresh read of each path in `files`.
    #
    # Your skills, memories and task list are kept as they are. You are asked to call this when
    # your window is full, and every other call is refused until you do.
    #
    # It does NOT stop your program: it registers the request and returns, and the rewrite happens
    # once your program has ended. Everything not in your summary and not in `files` is gone, so
    # write the summary for your future self and name the files you will actually need in hand.
    #
    # @param summary [String] What your restarted window opens with. Write it for your future self:
    #   everything not in it and not re-read from `files` is gone.
    # @param files [Array<String>] The paths to read afresh into the restarted window. Defaults to
    #   none.
    # @return [nil] nothing; the request is registered and your program runs on
    def self.compact(summary, files: [])
      Wire.call("compact", "context", "compact",
                [summary, Check.strings("compact", "files", files)])
      nil
    end
  end
end
