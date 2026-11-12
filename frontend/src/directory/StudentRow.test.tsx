import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getCounts } from "../perf/counters";
import { takeConsoleErrors } from "../test/setup";
import { indexStudents } from "./records";
import { brokenMessage, RowItem } from "./StudentRow";
import { BrokenRecordError } from "./records";

const [good, broken] = indexStudents([
  { id: 1, name: "Aarav Reddy", class_name: "8B", score: 77 },
  { id: 7, name: null, class_name: "8B", score: 77 },
]);

describe("RowItem", () => {
  it("shows name, class and score", () => {
    render(<RowItem student={good!} selected={false} onSelect={() => {}} />);
    const row = screen.getByRole("button");
    expect(row).toHaveTextContent("Aarav Reddy");
    expect(row).toHaveTextContent("Class 8B");
    expect(row).toHaveTextContent("77");
  });
  it("tells the click which student it was", async () => {
    const onSelect = vi.fn();
    render(<RowItem student={good!} selected={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("tells a screen reader which row is selected", () => {
    const { rerender } = render(<RowItem student={good!} selected={false} onSelect={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<RowItem student={good!} selected onSelect={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
  it("a broken record shows a message with its number and the reason, not a crash", () => {
    render(<RowItem student={broken!} selected={false} onSelect={() => {}} />);
    expect(takeConsoleErrors().length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Record #7 can't be shown: the name is missing.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("renders the row once per render and counts it", () => {
    render(<RowItem student={good!} selected={false} onSelect={() => {}} />);
    expect(getCounts().row).toBe(1);
  });
});

describe("brokenMessage", () => {
  it("names the problem for a BrokenRecordError", () => expect(brokenMessage(new BrokenRecordError(3, "the score is not a number"), 3)).toBe("Record #3 can't be shown: the score is not a number."));
  it("is still kind for any other error", () => expect(brokenMessage(new Error("x"), 3)).toBe("Record #3 can't be shown."));
});
