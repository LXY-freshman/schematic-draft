import type { ReactNode } from "react";

/** The right-hand dock: a Project panel when one is open, else Properties. */
export function EditorRightDock(props: {
  project?: ReactNode;
  properties: ReactNode;
}) {
  return (
    <aside className="editor-right-dock">
      {props.project ?? props.properties}
    </aside>
  );
}
