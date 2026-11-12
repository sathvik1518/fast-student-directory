import { z } from "zod";

/** The filter form is DRAWN from a list of field settings (filter-fields.json). A list written by hand can be wrong,
 *  so it is checked here before anything is drawn from it. */
const fieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, "must start with a letter and use only letters and digits");
const label = z.string().trim().min(1, "must not be empty");

const textField = z.strictObject({
  name: fieldName,
  label,
  type: z.literal("text"),
  placeholder: z.string().optional(),
  maxLength: z.number().int().min(1).max(200),
});

const selectField = z
  .strictObject({
    name: fieldName,
    label,
    type: z.literal("select"),
    options: z.array(z.strictObject({ value: z.string(), label })).min(2, "needs at least 2 options"),
  })
  .refine((f) => new Set(f.options.map((o) => o.value)).size === f.options.length, {
    message: "option values must all be different",
    path: ["options"],
  });

const checkboxField = z.strictObject({ name: fieldName, label, type: z.literal("checkbox") });

export const fieldSettingsSchema = z
  .array(z.discriminatedUnion("type", [textField, selectField, checkboxField]))
  .min(1, "needs at least one field")
  .refine((fields) => new Set(fields.map((f) => f.name)).size === fields.length, { message: "field names must all be different" });

export type FieldSetting = z.infer<typeof fieldSettingsSchema>[number];
export type Values = Record<string, string | boolean>;

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "settings";
  return "settings" + path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("");
}

export type SettingsResult = { ok: true; fields: FieldSetting[] } | { ok: false; problems: string[] };

/** Checks the settings list. Never throws: a bad list gives a list of plain-words problems instead. */
export function parseFieldSettings(input: unknown): SettingsResult {
  const result = fieldSettingsSchema.safeParse(input);
  if (result.success) return { ok: true, fields: result.data };
  return { ok: false, problems: result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`) };
}

export function defaultValues(fields: readonly FieldSetting[]): Values {
  const values: Values = {};
  for (const field of fields) {
    values[field.name] = field.type === "text" ? "" : field.type === "checkbox" ? false : (field.options[0]?.value ?? "");
  }
  return values;
}

/** The rules for what a person may enter, built from the same settings that draw the form. */
export function buildValuesSchema(fields: readonly FieldSetting[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    if (field.type === "text") shape[field.name] = z.string().max(field.maxLength, `at most ${field.maxLength} characters`);
    else if (field.type === "checkbox") shape[field.name] = z.boolean();
    else shape[field.name] = z.enum(field.options.map((o) => o.value) as [string, ...string[]], { error: "choose one of the listed options" });
  }
  return z.strictObject(shape);
}

export type ValuesResult = { ok: true; values: Values } | { ok: false; field: string; message: string };

/** Checks values before they are used. On a problem it names the field and says what is wrong. */
export function parseValues(fields: readonly FieldSetting[], input: unknown): ValuesResult {
  const result = buildValuesSchema(fields).safeParse(input);
  if (result.success) return { ok: true, values: result.data as Values };
  const issue = result.error.issues[0];
  const fieldName = String(issue?.path[0] ?? "");
  const found = fields.find((f) => f.name === fieldName);
  return { ok: false, field: fieldName, message: `${found?.label ?? "Form"}: ${issue?.message ?? "not valid"}` };
}
