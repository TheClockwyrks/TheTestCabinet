package gg;

import java.util.Optional;

/**
 * One view open in your context window, as {@code view.current} reports it.
 *
 * @param kind Whether it is a file, text, or documentation view.
 * @param selector What {@code view.close} takes: a file's path, a text view's label, or a
 *     documentation view's function name.
 * @param tokens Roughly what holding it costs you, in tokens.
 * @param region The line window a paged file view covers; empty for a whole-file view and for text
 *     views.
 */
public record OpenView(ViewKind kind, String selector, int tokens, Optional<ViewRegion> region) {
}
