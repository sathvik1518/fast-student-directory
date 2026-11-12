import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { takeConsoleErrors } from "../test/setup";
import { ErrorBoundary } from "./ErrorBoundary";
import { BrokenRecordError, indexStudents } from "./records";
import { StudentCard } from "./StudentCard";

const [good] = indexStudents([{ id: 3, name: "Diya Goud", class_name: "7B", score: 91 }]);
const [bad] = indexStudents([{ id: 9, name: "X", class_name: "7B", score: "absent" }]);

describe("StudentCard", () => {
  it("shows the student's details and the score band", () => {
    render(<StudentCard student={good!} onClose={() => {}} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Diya Goud");
    expect(screen.getByText("Student number").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("Class").nextElementSibling).toHaveTextContent("7B");
    expect(screen.getByText("Score").nextElementSibling).toHaveTextContent("91 (Excellent)");
  });
  it("Close calls onClose", async () => {
    const onClose = vi.fn();
    render(<StudentCard student={good!} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("a broken record throws a BrokenRecordError that a boundary can catch", () => {
    let caught: Error | undefined;
    render(
      <ErrorBoundary fallback={(e) => <p>fallback</p>} onError={(e) => (caught = e)}>
        <StudentCard student={bad!} onClose={() => {}} />
      </ErrorBoundary>,
    );
    takeConsoleErrors();
    expect(caught).toBeInstanceOf(BrokenRecordError);
    expect(caught).toMatchObject({ studentId: 9, problem: "the score is not a number" });
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });
});
