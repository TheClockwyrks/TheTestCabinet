package gg;

import java.util.Optional;

/**
 * A picture's description, as the {@link ImageFile} arm of a read carries it.
 *
 * @param mediaType The IANA media type ({@code image/png}, {@code image/jpeg}, {@code image/gif},
 *     {@code image/webp}).
 * @param label The short format label ({@code PNG}, {@code JPEG}, {@code GIF}, {@code WebP}).
 * @param bytes The file's size in bytes.
 * @param shown Whether the picture is being attached to this turn for you to look at.
 * @param notShownReason Why it is not being shown; empty when {@code shown} is true.
 */
public record ImageFile(String mediaType, String label, int bytes, boolean shown,
        Optional<String> notShownReason) implements FileRead {
}
