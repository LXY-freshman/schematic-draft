import { useMemo } from "react";

import type { SchematicDocument } from "@icm/model";

import type {
  ComponentPropertyCodeContext,
  ComponentPropertyCodeValue,
} from "./component-property-code";

type Instance = SchematicDocument["instances"][number];

/**
 * Props shared by the two equivalent component property surfaces. The form and
 * the code editor read the same context and commit through the same
 * {@link ComponentPropertyCodeValue}, so neither owns a private edit path.
 */
export interface ComponentPropertySurfaceProps {
  instance: Instance;
  displayName?: string | null;
  revision: number;
  referenceVisible: boolean | null;
  valueVisible: boolean | null;
  parameterVisibility?: Record<string, boolean>;
  connection?: "cell-pin" | "global" | null;
  netName?: string | null;
  defaultForeground?: string;
  details?: ComponentPropertyCodeContext["details"];
  onApply: (
    value: ComponentPropertyCodeValue,
  ) => { ok: true } | { ok: false; message: string };
}

/** Field availability is value presence; both surfaces must derive it once. */
export function useComponentPropertyCodeContext({
  instance,
  displayName,
  referenceVisible,
  valueVisible,
  parameterVisibility,
  connection,
  netName,
  details,
}: ComponentPropertySurfaceProps): ComponentPropertyCodeContext {
  return useMemo<ComponentPropertyCodeContext>(
    () => ({
      instance,
      ...(displayName !== undefined ? { displayName } : {}),
      referenceVisible,
      valueVisible,
      ...(parameterVisibility ? { parameterVisibility } : {}),
      ...(connection !== undefined ? { connection } : {}),
      ...(netName !== undefined ? { netName } : {}),
      ...(details ? { details } : {}),
    }),
    [
      instance,
      displayName,
      referenceVisible,
      valueVisible,
      parameterVisibility,
      connection,
      netName,
      details,
    ],
  );
}
