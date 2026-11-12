import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { resetCounts } from "../perf/counters";

// React reports problems with console.error. A test must either have none, or take the ones it EXPECTS with takeConsoleErrors()
// (and then say something about them). Anything left over fails the test.
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  resetCounts();
});
afterEach(() => {
  cleanup();
  const left = errorSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" "));
  errorSpy.mockRestore();
  vi.restoreAllMocks();
  expect(left, "console.error was called during the test and the test did not account for it").toEqual([]);
});

/** Returns the console.error messages so far and forgets them. */
export function takeConsoleErrors(): string[] {
  const calls = errorSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" "));
  errorSpy.mockClear();
  return calls;
}
