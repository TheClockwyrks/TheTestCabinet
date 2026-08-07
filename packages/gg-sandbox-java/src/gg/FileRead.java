package gg;

/**
 * What {@code fs.readFile} returned: a text file's window, or a picture's description.
 *
 * <p>A picture is a different kind of thing from text, so it is a different arm rather than a
 * string that happens to be binary — a program that treats an image as text is caught by the
 * {@code switch} instead of silently writing an empty string somewhere. Image <em>bytes</em> never
 * enter the program: gg attaches the picture to the turn so you can look at it directly, which is
 * worth far more than base64 in a variable.
 *
 * <p>It is a <b>sealed</b> interface, so the compiler knows the two arms are all there are and a
 * {@code switch} over them needs no {@code default}:
 *
 * <pre>{@code
 * switch (fs.readFile("logo.png")) {
 *     case TextFile text -> view.openText("logo", text.contents());
 *     case ImageFile picture -> view.openText("logo", picture.label());
 * }
 * }</pre>
 */
public sealed interface FileRead permits TextFile, ImageFile {
}
