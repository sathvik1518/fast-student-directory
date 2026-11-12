import type { IndexedStudent } from "./records";
import type { Values } from "./fieldSchema";

export type SortOrder = "none" | "asc" | "desc";
export type Filter = { query: string; className: string; sort: SortOrder; problemsOnly: boolean };

export const NO_FILTER: Filter = { query: "", className: "", sort: "none", problemsOnly: false };

/** Form values (checked already) -> the Filter the list understands. Anything unexpected falls back to 'no filter'. */
export function filterFromValues(values: Values): Filter {
  const { query, className, sort, problemsOnly } = values;
  return {
    query: typeof query === "string" ? query : "",
    className: typeof className === "string" ? className : "",
    sort: sort === "asc" || sort === "desc" ? sort : "none",
    problemsOnly: problemsOnly === true,
  };
}

/** Search + class + broken-only + sort. Pure: the input list is never changed. */
export function applyFilter(students: readonly IndexedStudent[], filter: Filter): IndexedStudent[] {
  const query = filter.query.trim().toLowerCase().replace(/\s+/g, " ");
  let result = students.filter((s) => {
    if (query !== "" && !s.nameKey.includes(query)) return false;
    if (filter.className !== "" && s.raw.class_name !== filter.className) return false;
    if (filter.problemsOnly && s.problem === null) return false;
    return true;
  });
  if (filter.sort !== "none") {
    const direction = filter.sort === "asc" ? 1 : -1;
    result = result.sort((a, b) => {
      if (a.scoreValue === null || b.scoreValue === null) {
        return a.scoreValue === b.scoreValue ? 0 : a.scoreValue === null ? 1 : -1; // a score that is not a number goes last either way
      }
      return (a.scoreValue - b.scoreValue) * direction;
    });
  }
  return result;
}
