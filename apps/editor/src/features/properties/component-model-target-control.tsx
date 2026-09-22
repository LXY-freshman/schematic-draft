import { useEffect, useRef, useState } from "react";

const CUSTOM_MODEL_OPTION = "__custom_model__";

/**
 * Pick a reviewed model or type one the suggestions do not know about. The
 * caller owns the commit; this control never touches the Document itself.
 */
export function ModelTargetControl({
  instanceId,
  revision,
  value,
  suggestions,
  onChange,
}: {
  instanceId: string;
  revision: number;
  value: string;
  suggestions: readonly string[];
  onChange: (value: string) => void;
}) {
  const current = value.trim();
  const currentIsSuggestion = suggestions.includes(current);
  const currentIsCustom = current !== "" && !currentIsSuggestion;
  const [customMode, setCustomMode] = useState(currentIsCustom);
  const [customDraft, setCustomDraft] = useState(
    currentIsCustom ? current : "",
  );
  const [focusCustom, setFocusCustom] = useState(false);
  const customInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCustomMode(currentIsCustom);
    setCustomDraft(currentIsCustom ? current : "");
    setFocusCustom(false);
  }, [instanceId, revision, current, currentIsCustom]);

  useEffect(() => {
    if (!customMode || !focusCustom) return;
    customInput.current?.focus();
    setFocusCustom(false);
  }, [customMode, focusCustom]);

  const restoreCurrent = (): void => {
    setCustomMode(currentIsCustom);
    setCustomDraft(currentIsCustom ? current : "");
  };
  const commitCustom = (): void => {
    const next = customDraft.trim();
    if (!next) {
      restoreCurrent();
      return;
    }
    onChange(next);
  };

  return (
    <>
      <label>
        Model
        <select
          key={`${instanceId}-${revision}-model-target`}
          aria-label="Component model target"
          value={customMode ? CUSTOM_MODEL_OPTION : current}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === CUSTOM_MODEL_OPTION) {
              setCustomMode(true);
              setCustomDraft(currentIsCustom ? current : "");
              setFocusCustom(true);
              return;
            }
            setCustomMode(false);
            setCustomDraft("");
            onChange(next);
          }}
        >
          <option value="">None</option>
          {suggestions.map((model) => (
            <option value={model} key={model}>
              {model}
            </option>
          ))}
          <option value={CUSTOM_MODEL_OPTION}>Custom…</option>
        </select>
      </label>
      {customMode ? (
        <label>
          Custom model
          <input
            ref={customInput}
            dir="auto"
            aria-label="Custom model name"
            value={customDraft}
            placeholder="Model name"
            onChange={(event) => setCustomDraft(event.currentTarget.value)}
            onBlur={commitCustom}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      ) : null}
    </>
  );
}
