import { useState, type ReactNode } from "react";

export function PropertyDisclosure({
  title,
  summary,
  defaultOpen = false,
  mountWhenOpen = false,
  ariaLabel,
  role = "group",
  className,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  /**
   * Keep a costly body (a code editor, say) out of the tree until the reader
   * asks for it. It stays mounted afterwards, so a draft survives collapsing.
   */
  mountWhenOpen?: boolean;
  ariaLabel?: string;
  role?: "group" | "region";
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen || !mountWhenOpen);
  return (
    <details
      className={["property-details", "property-disclosure", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel ?? title}
      role={role}
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) setMounted(true);
      }}
    >
      <summary>
        <span>{title}</span>
        {summary === undefined ? null : <small>{summary}</small>}
      </summary>
      <div className="property-disclosure-body">
        {mounted ? children : null}
      </div>
    </details>
  );
}
