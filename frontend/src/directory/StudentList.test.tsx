import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { giveScrollerASize, makeStudents } from "../test/fixtures";
import { indexStudents } from "./records";
import { LIST_MODES, parseListMode, StudentList, type ListMode } from "./StudentList";

describe("parseListMode", () => {
  it("defaults to virtual", () => {
    expect(parseListMode("")).toBe("virtual");
    expect(parseListMode("?perf")).toBe("virtual");
  });
  it.each(LIST_MODES)("understands ?list=%s", (mode) => expect(parseListMode(`?list=${mode}`)).toBe(mode));
  it.each([["?list=banana"], ["?list="], ["?list=PLAIN"], ["?list=plain%20"], ["?lists=plain"]])("falls back to virtual for %s", (q) => expect(parseListMode(q)).toBe("virtual"));
  it("works next to other parameters", () => expect(parseListMode("?perf&list=memo")).toBe("memo"));
});

describe("StudentList", () => {
  it.each(LIST_MODES)("draws something for %s", (mode) => {
    giveScrollerASize();
    render(<StudentList mode={mode} students={indexStudents(makeStudents(20))} selectedId={null} onSelect={() => {}} scrollResetKey="" />);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(5);
  });
  it("an unknown mode fails loudly instead of drawing nothing", () => {
    expect(() => render(<StudentList mode={"nope" as ListMode} students={[]} selectedId={null} onSelect={() => {}} scrollResetKey="" />)).toThrow("Unhandled list mode: nope");
    // React logs the error it re-throws.
    // (the setup file would fail the test if we did not account for it)
    return import("../test/setup").then((m) => m.takeConsoleErrors());
  });
});
