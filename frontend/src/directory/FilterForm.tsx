import { useId } from "react";
import type { FieldSetting, Values } from "./fieldSchema";

export type FilterFormProps = {
  fields: readonly FieldSetting[];
  values: Values;
  /** The field that was refused last, and why (shown under that field). */
  error: { field: string; message: string } | null;
  onChange: (name: string, value: string | boolean) => void;
};

/** Draws the form from the settings list. No field is written by hand here. */
export function FilterForm({ fields, values, error, onChange }: FilterFormProps) {
  const prefix = useId();
  return (
    <form className="filters" role="search" aria-label="Filter students" onSubmit={(e) => e.preventDefault()}>
      {fields.map((field) => {
        const id = `${prefix}-${field.name}`;
        const message = error?.field === field.name ? error.message : null;
        const describedBy = message ? `${id}-error` : undefined;
        const value = values[field.name];
        return (
          <div className="field" key={field.name}>
            {field.type === "checkbox" ? (
              <label className="check">
                <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(field.name, e.target.checked)} />
                {field.label}
              </label>
            ) : (
              <>
                <label htmlFor={id}>{field.label}</label>
                {field.type === "text" ? (
                  <input
                    id={id}
                    type="search"
                    autoComplete="off"
                    value={typeof value === "string" ? value : ""}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    aria-describedby={describedBy}
                    onChange={(e) => onChange(field.name, e.target.value)}
                  />
                ) : (
                  <select id={id} value={typeof value === "string" ? value : ""} aria-describedby={describedBy} onChange={(e) => onChange(field.name, e.target.value)}>
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
            {message && (
              <p id={`${id}-error`} className="field-error" role="alert">
                {message}
              </p>
            )}
          </div>
        );
      })}
    </form>
  );
}
