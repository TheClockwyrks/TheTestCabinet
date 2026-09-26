# frozen_string_literal: true

module GG
  # The argument checks every wrapper runs before it lowers anything onto the wire.
  #
  # Nothing type-checks a model's program: Opal compiles it and the guest runs it, and Ruby binds
  # arguments by name and arity alone. An `ArgumentError` already covers the mistakes that matter
  # most, and names the call while doing it — a wrong positional count from the `arity_check` gg
  # compiles both this SDK and the model's program with, and an unknown keyword from `GG::Scope`'s
  # forwarder, which is the one place that knows both what was passed and what the target declares.
  #
  # What an `ArgumentError` cannot see is a value of the right *class* and the wrong *range*:
  # `GG::Files.read_file("a.rb", offset: -1)` lowers to a `u32` by two's-complement wrap and fails
  # for a reason that has nothing to do with what was written. These cover exactly that gap.
  #
  # @api private
  module Check
    # The `u32` range, so no wrapper inlines the magic number.
    U32_MAX = 4_294_967_295

    # A whole number in `0..U32_MAX`, or an `ApiError` naming the argument.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param name [String] the argument's name, for the message
    # @param value [Integer, nil] what the program passed
    # @return [Integer, nil] the value, or nil when it was left out
    # @raise [GG::Core::ApiError] `invalid-argument` when it is not a whole number in range
    def self.uint(fn, name, value)
      return nil if value.nil?

      unless value.is_a?(Integer) && value >= 0 && value <= U32_MAX
        raise Core::ApiError.new(fn, Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "`#{name}` must be a whole number 0..#{U32_MAX}, " \
                                 "got #{value.inspect}")
      end

      value
    end

    # A finite positive number of seconds, or an `ApiError` naming the argument.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param name [String] the argument's name, for the message
    # @param value [Numeric, nil] what the program passed
    # @return [Float, nil] the value as a float, or nil when it was left out
    # @raise [GG::Core::ApiError] `invalid-argument` when it is not a positive number
    def self.positive(fn, name, value)
      return nil if value.nil?

      unless value.is_a?(Numeric) && value.to_f > 0
        raise Core::ApiError.new(fn, Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "`#{name}` must be a positive number of seconds, " \
                                 "got #{value.inspect}")
      end

      value.to_f
    end

    # A list of strings, flattened, defaulted to empty, or an `ApiError` naming the argument.
    #
    # Every `list<string>` argument goes through this, and every one of them is a splat — so
    # `GG::Delegation.wait_for_subagents(*ids)` and `GG::Delegation.wait_for_subagents(ids)` are the
    # same call, which is the forgiveness a Ruby caller expects of a variadic method.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param name [String] the argument's name, for the message
    # @param values [Array] what the program passed, splatted
    # @return [Array<String>] the flattened strings
    # @raise [GG::Core::ApiError] `invalid-argument` when an entry is not a string
    def self.strings(fn, name, values)
      flat = Array(values).flatten
      flat.each do |item|
        next if item.is_a?(String)

        raise Core::ApiError.new(fn, Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "every entry of `#{name}` must be a string, got #{item.inspect}")
      end
      flat
    end

    # One of a fixed set of symbols, or an `ApiError` listing the set.
    #
    # This is what makes a symbol a *typed* choice rather than a free string. `:in_progres` is a
    # value Ruby will happily construct, so the check has to be here — and the failure names every
    # symbol that would have worked, which is the whole difference from a branch that silently
    # never runs.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param name [String] the argument's name, for the message
    # @param value [Symbol, nil] what the program passed
    # @param allowed [Array<Symbol>] every symbol this argument accepts
    # @return [Symbol, nil] the value, or nil when it was left out
    # @raise [GG::Core::ApiError] `invalid-argument` when it is not one of `allowed`
    def self.choice(fn, name, value, allowed)
      return nil if value.nil?
      return value if allowed.include?(value)

      # Written with a leading colon by hand rather than with `inspect`, because Opal's Symbol is a
      # String: `:done.inspect` is `"done"` here, and a message that quoted the accepted set that
      # way would be telling a model to write the one thing this argument does not take.
      raise Core::ApiError.new(fn, Core::ApiErrorCode::INVALID_ARGUMENT,
                               "`#{name}` must be one of " \
                               "#{allowed.map { |arm| ":#{arm}" }.join(", ")}, got :#{value}")
    end

    # An inclusive `Range` of whole turn numbers, lowered to the membrane's `{ start, end }` record.
    #
    # A `Range` is what a Ruby program writes a span as, and nothing stops one being built out of
    # strings or backwards; the membrane would lower either into a pair of `u32`s without complaint
    # and archive turns nobody named.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param span [Range] the span to check
    # @return [Array(Integer, Integer)] the first and last turn, both inclusive
    # @raise [GG::Core::ApiError] `invalid-argument` for anything that is not a whole, forward,
    #   closed range
    def self.span(fn, span)
      unless span.is_a?(Range) && span.first.is_a?(Integer) && span.last.is_a?(Integer)
        raise Core::ApiError.new(fn, Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "every entry of `ranges` must be a Range of turn numbers " \
                                 "(`4..19`), got #{span.inspect}")
      end

      last = span.exclude_end? ? span.last - 1 : span.last
      [uint(fn, "ranges", span.first), uint(fn, "ranges", last)]
    end
  end
end
