import type { ComponentProps } from "react";
import styles from "./ControlRow.module.scss";
import { controlClass } from "./controlClass";

/**
 * A control beside its own action, such as a URL beside the button that fetches
 * it. The first child takes the row's spare width, and the row wraps when the two
 * no longer fit, so the action drops under the control instead of squeezing it.
 */
export function ControlRow({ className, ...rest }: ComponentProps<"div">) {
  return <div className={controlClass(styles.row, className)} {...rest} />;
}
