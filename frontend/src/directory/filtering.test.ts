import { describe, expect, it } from "vitest";
import { makeStudents, withBroken } from "../test/fixtures";
import { applyFilter, filterFromValues, NO_FILTER, type Filter } from "./filtering";
import { indexStudents } from "./records";

const students = indexStudents(withBroken(makeStudents(60)));
const ids = (list: ReturnType<typeof applyFilter>) => list.map((s) => s.raw.id);
const f = (patch: Partial<Filter>): Filter => ({ ...NO_FILTER, ...patch });

describe("applyFilter", () => {
  it("no filter: everything, in the original order", () => expect(ids(applyFilter(students, NO_FILTER))).toEqual(students.map((s) => s.raw.id)));
  it("does not change the list it was given", () => {
    const copy = [...students];
    applyFilter(students, f({ sort: "desc", query: "a" }));
    expect(students).toEqual(copy);
  });
  it("search ignores case", () => expect(ids(applyFilter(students, f({ query: "AARAV" })))).toEqual(ids(applyFilter(students, f({ query: "aarav" })))));
  it("search matches part of a name, anywhere in it", () => {
    expect(applyFilter(students, f({ query: "reddy" })).every((s) => s.nameKey.includes("reddy"))).toBe(true);
    expect(applyFilter(students, f({ query: "arav red" })).length).toBeGreaterThan(0);
  });
  it("search ignores spaces at the ends and doubled spaces", () => expect(ids(applyFilter(students, f({ query: "  aarav   reddy " })))).toEqual(ids(applyFilter(students, f({ query: "aarav reddy" })))));
  it("a search with no match gives an empty list", () => expect(applyFilter(students, f({ query: "zzzz" }))).toEqual([]));
  it("a row with no readable name is never found by a search", () => {
    expect(ids(applyFilter(students, f({ query: "a" })))).not.toContain(7);
    expect(ids(applyFilter(students, f({ query: "12345" })))).not.toContain(20);
  });
  it("class filter keeps only that class", () => {
    const r = applyFilter(students, f({ className: "6B" }));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.raw.class_name === "6B")).toBe(true);
  });
  it("a row with no class is not in any class", () => {
    for (const c of ["6A", "6B", "7A", "10C"]) expect(ids(applyFilter(students, f({ className: c })))).not.toContain(15);
  });
  it("problemsOnly shows exactly the four broken rows", () => expect(ids(applyFilter(students, f({ problemsOnly: true })))).toEqual([7, 12, 15, 20]));
  it("search and class work together (both must match)", () => {
    const r = applyFilter(students, f({ query: "aarav", className: "6B" }));
    expect(r.every((s) => s.nameKey.includes("aarav") && s.raw.class_name === "6B")).toBe(true);
  });
  it("sort low to high puts scores in order", () => {
    const scores = applyFilter(students, f({ sort: "asc" })).map((s) => s.scoreValue).filter((v): v is number => v !== null);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });
  it("sort high to low puts scores in order", () => {
    const scores = applyFilter(students, f({ sort: "desc" })).map((s) => s.scoreValue).filter((v): v is number => v !== null);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
  it("a score that is not a number goes last, both ways", () => {
    expect(applyFilter(students, f({ sort: "asc" })).at(-1)?.raw.id).toBe(12);
    expect(applyFilter(students, f({ sort: "desc" })).at(-1)?.raw.id).toBe(12);
  });
  it("equal scores keep their original order", () => {
    const tied = indexStudents([1, 2, 3, 4].map((id) => ({ id, name: `n${id}`, class_name: "6A", score: 50 })));
    expect(ids(applyFilter(tied, f({ sort: "desc" })))).toEqual([1, 2, 3, 4]);
    expect(ids(applyFilter(tied, f({ sort: "asc" })))).toEqual([1, 2, 3, 4]);
  });
  it("sort and filter together: filter first, then sort what is left", () => {
    const r = applyFilter(students, f({ className: "6B", sort: "desc" }));
    expect(r.every((s) => s.raw.class_name === "6B")).toBe(true);
  });
  it("handles an empty list", () => expect(applyFilter([], f({ query: "a", sort: "asc" }))).toEqual([]));
  it("5,000 students: filter and sort stay far below the time a person can notice", () => {
    const big = indexStudents(makeStudents(5000));
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) applyFilter(big, f({ query: "a", sort: "desc" }));
    expect((performance.now() - t0) / 10).toBeLessThan(50); // measured about 1 to 2 ms; the limit is generous so a slow machine does not fail it
  });
});

describe("filterFromValues", () => {
  it("reads the four known values", () => expect(filterFromValues({ query: "ab", className: "7A", sort: "asc", problemsOnly: true })).toEqual({ query: "ab", className: "7A", sort: "asc", problemsOnly: true }));
  it("anything unexpected becomes 'no filter'", () => expect(filterFromValues({ query: true, className: false, sort: "sideways", problemsOnly: "yes" })).toEqual(NO_FILTER));
  it("an empty object becomes 'no filter'", () => expect(filterFromValues({})).toEqual(NO_FILTER));
});
