import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Annotation, SchematicDocument } from "@icm/model";

import { ToggleActionButton } from "../../components/toggle-action-button";
import { ColorOverrideControl } from "./color-override-control";
import type { CanvasPropertyField } from "./component-property-fields";
import { PropertyDisclosure } from "./property-disclosure";
import {
  commitPropertyInput,
  handlePropertyInputKeyDown,
} from "./property-input-commit";
import { RoutePropertyCodeEditor } from "./route-property-code-editor";
import {
  parseRoutePropertyCode,
  routePropertyCodeValue,
  serializeRoutePropertyCode,
  ROUTE_PROPERTY_FIELDS,
  type RoutePropertyCodeValue,
} from "./route-property-code";

type Route = SchematicDocument["routes"][number];

function field(path: string): CanvasPropertyField | undefined {
  return ROUTE_PROPERTY_FIELDS.find((candidate) => candidate.path === path);
}

/** One labelled select per choice field, so the form and the JSON agree. */
function ChoiceField({
  path,
  ariaLabel,
  value,
  onChange,
}: {
  path: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const definition = field(path);
  if (!definition) return null;
  return (
    <label title={definition.help}>
      {definition.label}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {(definition.options ?? []).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The default Route property surface: the Net name and scope the wire claims,
 * and how it is drawn. It edits the same {@link RoutePropertyCodeValue} the
 * code editor edits and commits through the same apply function, with the JSON
 * underneath as the exact-editing escape hatch.
 */
export function RoutePropertyForm({
  document,
  route,
  netLabel,
  defaultColor,
  onApply,
  actions,
}: {
  document: SchematicDocument;
  route: Route;
  netLabel: Annotation | null;
  defaultColor: string;
  onApply(value: RoutePropertyCodeValue): { ok: boolean; message?: string };
  actions?: ReactNode;
}) {
  const value = useMemo(
    () => routePropertyCodeValue(document, route, netLabel),
    [document, route, netLabel],
  );
  const baseline = useMemo(() => serializeRoutePropertyCode(value), [value]);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setMessage(null), [baseline]);

  const commit = (next: RoutePropertyCodeValue): boolean => {
    const source = serializeRoutePropertyCode(next);
    if (source === baseline) return true;
    // Validate through the code surface's own parser rather than a second set
    // of rules: one value type, one vocabulary of errors, one apply function.
    const parsed = parseRoutePropertyCode(source);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return false;
    }
    const result = onApply(parsed.value);
    setMessage(
      result.ok ? null : (result.message ?? "Route edit was rejected"),
    );
    return result.ok;
  };
  const commitAppearance = (
    patch: Partial<RoutePropertyCodeValue["appearance"]>,
  ): boolean =>
    commit({ ...value, appearance: { ...value.appearance, ...patch } });

  const named = value.net.name !== "";
  const key = `${route.id}-${document.revision}`;

  return (
    <>
      <PropertyDisclosure title="Net" ariaLabel="Route net" defaultOpen>
        <label title="Naming a wire claims the Net for every wire it reaches.">
          Net name
          <input
            dir="auto"
            key={`${key}-net-name`}
            aria-label="Net name"
            defaultValue={value.net.name}
            onBlur={(event) =>
              commitPropertyInput(event, value.net.name, (raw) =>
                commit({ ...value, net: { ...value.net, name: raw } }),
              )
            }
            onKeyDown={(event) =>
              handlePropertyInputKeyDown(event, value.net.name)
            }
          />
        </label>
        {named ? (
          <ChoiceField
            path="net.scope"
            ariaLabel="Net scope"
            value={value.net.scope}
            onChange={(scope) =>
              commit({
                ...value,
                net: { ...value.net, scope: scope as "local" | "global" },
              })
            }
          />
        ) : (
          // Scope belongs to a name claim; an unnamed wire has none to scope.
          <small>Name the Net to choose whether it crosses Cells.</small>
        )}
      </PropertyDisclosure>
      <PropertyDisclosure
        title="Appearance"
        ariaLabel="Route appearance"
        defaultOpen
      >
        <ColorOverrideControl
          label={field("appearance.color")?.label ?? "Wire color"}
          value={
            value.appearance.color === "auto"
              ? undefined
              : value.appearance.color
          }
          fallback={defaultColor}
          onChange={(color) =>
            commitAppearance({
              color: color ? (color as `#${string}`) : "auto",
            })
          }
        />
        <ChoiceField
          path="appearance.lineStyle"
          ariaLabel="Wire line style"
          value={value.appearance.lineStyle}
          onChange={(lineStyle) =>
            commitAppearance({
              lineStyle:
                lineStyle as RoutePropertyCodeValue["appearance"]["lineStyle"],
            })
          }
        />
        <ChoiceField
          path="appearance.directionArrow"
          ariaLabel="Wire direction arrow"
          value={value.appearance.directionArrow}
          onChange={(directionArrow) =>
            commitAppearance({
              directionArrow:
                directionArrow as RoutePropertyCodeValue["appearance"]["directionArrow"],
            })
          }
        />
        <ToggleActionButton
          label={field("appearance.lineJump")?.label ?? "Hop over crossings"}
          pressed={value.appearance.lineJump}
          help={field("appearance.lineJump")?.help}
          onToggle={(lineJump) => commitAppearance({ lineJump })}
        />
      </PropertyDisclosure>
      {actions}
      <PropertyDisclosure
        title="Code (JSON)"
        ariaLabel="Route property code"
        mountWhenOpen
      >
        <RoutePropertyCodeEditor
          document={document}
          route={route}
          netLabel={netLabel}
          defaultColor={defaultColor}
          onApply={onApply}
          title="JSON"
        />
      </PropertyDisclosure>
      {message ? (
        <div className="component-property-code-status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}
    </>
  );
}
