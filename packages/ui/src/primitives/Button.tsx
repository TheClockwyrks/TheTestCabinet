import type { ComponentProps } from "react";
import styles from "./Button.module.scss";
import { controlClass } from "./controlClass";

/**
 * `primary` is the one filled button a form has; `secondary` an outlined action;
 * `danger` a destructive one, which takes the negative cue on hover; `link` a
 * text-only action with no box.
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "link";

/** `small` is the uppercase affordance a form's side actions wear. */
export type ButtonSize = "regular" | "small";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * A button. Its `type` defaults to `button`, so a button inside a form submits
 * only when it says `type="submit"`.
 */
export function Button({
  variant = "secondary",
  size = "regular",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={controlClass(
        styles.button,
        styles[variant],
        size === "small" && styles.small,
        className,
      )}
      {...rest}
    />
  );
}

/** The classes a non-button element (a link) wears to look like a button. */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "regular",
  className?: string,
): string {
  return controlClass(
    styles.button,
    styles[variant],
    size === "small" && styles.small,
    className,
  );
}
