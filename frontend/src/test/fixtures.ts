import { vi } from "vitest";
import type { Fetcher, RawStudent, StudentsResult } from "../api/types";

const CLASSES = ["6A", "6B", "6C", "7A", "7B", "7C", "8A", "8B", "8C", "9A", "9B", "9C", "10A", "10B", "10C"];
const FIRST = ["Aarav", "Diya", "Rohan", "Meera", "Karthik", "Ananya", "Teja", "Priya"];
const LAST = ["Reddy", "Goud", "Rao", "Sharma", "Naidu"];

/** n clean students with predictable names, classes and scores (score = 20 + id % 81). */
export function makeStudents(n: number): RawStudent[] {
  return Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    return { id, name: `${FIRST[id % FIRST.length]} ${LAST[id % LAST.length]} ${id}`, class_name: CLASSES[id % CLASSES.length] ?? "6A", score: 20 + (id % 81) };
  });
}

/** The same four kinds of broken row the Python seed makes. */
export function withBroken(students: RawStudent[]): RawStudent[] {
  return students.map((s) => {
    if (s.id === 7) return { ...s, name: null };
    if (s.id === 12) return { ...s, score: "absent" };
    if (s.id === 15) return { ...s, class_name: null };
    if (s.id === 20) return { ...s, name: 12345 };
    return s;
  });
}

export function fakeFetcher(students: RawStudent[], queryCount: number | null = 1): Fetcher {
  return vi.fn(async (): Promise<StudentsResult> => ({ students, queryCount }));
}

/** jsdom has no layout, so every element is 0 x 0 and a virtual list would draw nothing.
 *  The virtual list reads clientHeight / clientWidth, so give the scroll box a real size. Undone after each test (see setup.ts). */
export function giveScrollerASize(height = 480, width = 600): void {
  const sizeOf = (el: HTMLElement, size: number) => (el.classList.contains("scroller") ? size : 0);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return sizeOf(this, height);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return sizeOf(this, width);
  });
}
