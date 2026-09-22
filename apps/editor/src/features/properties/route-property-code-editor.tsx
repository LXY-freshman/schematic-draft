import { useMemo, type ReactNode } from "react";

import type { Annotation, SchematicDocument } from "@icm/model";

import { AnnotationPropertyCodeEditor } from "./annotation-property-code-editor";
import {
  parseRoutePropertyCode,
  routePropertyCodeAdapter,
  routePropertyCodeValue,
  serializeRoutePropertyCode,
  type RoutePropertyCodeValue,
} from "./route-property-code";

type Route = SchematicDocument["routes"][number];

export function RoutePropertyCodeEditor({
  document,
  route,
  netLabel,
  defaultColor,
  onApply,
  actions,
  title = "Route",
}: {
  document: SchematicDocument;
  route: Route;
  netLabel: Annotation | null;
  defaultColor: string;
  onApply(value: RoutePropertyCodeValue): { ok: boolean; message?: string };
  /** Route commands the form keeps beside the sections, not the JSON. */
  actions?: ReactNode;
  /** "JSON" when the form owns the section heading above it. */
  title?: string;
}) {
  const adapter = useMemo(() => routePropertyCodeAdapter(), []);
  const format = (value: RoutePropertyCodeValue) =>
    serializeRoutePropertyCode(value);
  return (
    <AnnotationPropertyCodeEditor
      baseline={format(routePropertyCodeValue(document, route, netLabel))}
      adapter={adapter}
      parse={parseRoutePropertyCode}
      format={format}
      onApply={onApply}
      defaultColor={defaultColor}
      actions={actions}
      title={title}
    />
  );
}
