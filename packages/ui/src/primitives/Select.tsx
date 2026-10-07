import type { ComponentProps } from "react";
import styles from "./Select.module.scss";
import { controlClass } from "./controlClass";

export type SelectProps = ComponentProps<"select">;

/**
 * A dropdown. The native appearance is stripped and the chevron is our own, so a
 * dropdown reads identically in every browser engine.
 */
export function Select({ className, ...rest }: SelectProps) {
  return (
    <select className={controlClass(styles.select, className)} {...rest} />
  );
}
