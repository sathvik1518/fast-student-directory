import { describe, expect, it } from "vitest";
import settingsFile from "./filter-fields.json";
import { buildValuesSchema, defaultValues, parseFieldSettings, parseValues, type FieldSetting } from "./fieldSchema";

const text = { name: "query", type: "text", label: "Search", maxLength: 20 };
const select = { name: "sort", type: "select", label: "Sort", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
const check = { name: "flag", type: "checkbox", label: "Flag" };

function fields(input: unknown): FieldSetting[] {
  const r = parseFieldSettings(input);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.fields;
}

describe("the shipped settings file", () => {
  it("passes the check", () => expect(parseFieldSettings(settingsFile).ok).toBe(true));
  it("has the four fields in order", () => expect(fields(settingsFile).map((f) => [f.name, f.type])).toEqual([["query", "text"], ["className", "select"], ["sort", "select"], ["problemsOnly", "checkbox"]]));
  it("lists all 15 classes plus 'all classes'", () => {
    const cls = fields(settingsFile).find((f) => f.name === "className");
    expect(cls?.type === "select" && cls.options.length).toBe(16);
  });
  it("search is limited to 50 characters", () => expect(fields(settingsFile)[0]).toMatchObject({ maxLength: 50 }));
});

describe("a bad settings list is refused, with a plain reason", () => {
  const cases: [string, unknown, RegExp][] = [
    ["not a list", { name: "x" }, /settings/],
    ["an empty list", [], /needs at least one field/],
    ["unknown type", [{ ...text, type: "date" }], /settings\[0\]/],
    ["missing type", [{ name: "q", label: "Q" }], /settings\[0\]/],
    ["select with no options", [{ ...select, options: [] }], /needs at least 2 options/],
    ["select with one option", [{ ...select, options: [{ value: "a", label: "A" }] }], /needs at least 2 options/],
    ["select without options at all", [{ name: "s", type: "select", label: "S" }], /options/],
    ["duplicate option values", [{ ...select, options: [{ value: "a", label: "A" }, { value: "a", label: "Again" }] }], /option values must all be different/],
    ["option without a label", [{ ...select, options: [{ value: "a", label: "" }, { value: "b", label: "B" }] }], /must not be empty/],
    ["duplicate field names", [text, { ...select, name: "query" }], /field names must all be different/],
    ["a name with a space", [{ ...text, name: "my field" }], /must start with a letter/],
    ["a name that starts with a digit", [{ ...text, name: "1st" }], /must start with a letter/],
    ["an empty label", [{ ...text, label: "   " }], /must not be empty/],
    ["text without maxLength", [{ name: "q", type: "text", label: "Q" }], /maxLength/],
    ["maxLength zero", [{ ...text, maxLength: 0 }], /settings\[0\]\.maxLength/],
    ["maxLength 1.5", [{ ...text, maxLength: 1.5 }], /maxLength/],
    ["maxLength 201", [{ ...text, maxLength: 201 }], /maxLength/],
    ["maxLength as text", [{ ...text, maxLength: "20" }], /maxLength/],
    ["an extra unknown key", [{ ...text, colour: "red" }], /settings\[0\]/],
    ["checkbox with options", [{ ...check, options: [] }], /settings\[0\]/],
    ["a null in the list", [null], /settings\[0\]/],
  ];
  it.each(cases)("%s", (_name, input, pattern) => {
    const r = parseFieldSettings(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join("\n")).toMatch(pattern);
  });

  it("reports the position of the bad field", () => {
    const r = parseFieldSettings([text, check, { ...select, options: [] }]);
    expect(!r.ok && r.problems[0]).toMatch(/^settings\[2\]\.options:/);
  });
  it("reports several problems together", () => {
    const r = parseFieldSettings([{ ...text, maxLength: 0 }, { ...select, options: [] }]);
    expect(!r.ok && r.problems.length).toBeGreaterThanOrEqual(2);
  });
  it("never throws, whatever it is given", () => {
    for (const input of [undefined, null, 5, "x", [[]], [undefined]]) expect(() => parseFieldSettings(input)).not.toThrow();
  });
});

describe("defaultValues", () => {
  it("text is empty, select is the first option, checkbox is off", () => expect(defaultValues(fields([text, select, check]))).toEqual({ query: "", sort: "a", flag: false }));
});

describe("values are checked before they are used", () => {
  const f = fields([text, select, check]);
  it("accepts good values", () => expect(parseValues(f, { query: "ab", sort: "b", flag: true })).toEqual({ ok: true, values: { query: "ab", sort: "b", flag: true } }));
  it("accepts text exactly at the limit and refuses one more", () => {
    expect(parseValues(f, { query: "x".repeat(20), sort: "a", flag: false }).ok).toBe(true);
    const r = parseValues(f, { query: "x".repeat(21), sort: "a", flag: false });
    expect(r).toMatchObject({ ok: false, field: "query" });
    expect(!r.ok && r.message).toBe("Search: at most 20 characters");
  });
  it("refuses a select value that is not an option", () => {
    const r = parseValues(f, { query: "", sort: "z", flag: false });
    expect(r).toMatchObject({ ok: false, field: "sort", message: "Sort: choose one of the listed options" });
  });
  it("refuses the wrong type", () => {
    expect(parseValues(f, { query: 5, sort: "a", flag: false })).toMatchObject({ ok: false, field: "query" });
    expect(parseValues(f, { query: "", sort: "a", flag: "yes" })).toMatchObject({ ok: false, field: "flag" });
  });
  it("refuses a field the settings do not know", () => expect(parseValues(f, { query: "", sort: "a", flag: false, hack: "1" }).ok).toBe(false));
  it("refuses a missing field", () => expect(parseValues(f, { query: "", sort: "a" })).toMatchObject({ ok: false, field: "flag" }));
  it("the schema is built from the same settings (different settings, different rules)", () => {
    const tight = fields([{ ...text, maxLength: 3 }]);
    expect(parseValues(tight, { query: "abcd" }).ok).toBe(false);
    expect(buildValuesSchema(tight).safeParse({ query: "abc" }).success).toBe(true);
  });
});
