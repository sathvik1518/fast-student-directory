import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { takeConsoleErrors } from "../test/setup";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error("boom");
  return <p>fine</p>;
}

describe("ErrorBoundary", () => {
  it("shows the children when nothing is wrong", () => {
    render(<ErrorBoundary fallback={() => <p>fallback</p>}><Bomb explode={false} /></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("shows the fallback when a child throws while rendering, and the page around it still works", () => {
    render(
      <div>
        <p>outside</p>
        <ErrorBoundary fallback={(e) => <p>fallback: {e.message}</p>}><Bomb explode /></ErrorBoundary>
        <ErrorBoundary fallback={() => <p>other fallback</p>}><Bomb explode={false} /></ErrorBoundary>
      </div>,
    );
    expect(takeConsoleErrors().length).toBeGreaterThan(0); // React still reports it: the error is shown AND logged, never swallowed
    expect(screen.getByText("outside")).toBeInTheDocument();
    expect(screen.getByText("fallback: boom")).toBeInTheDocument();
    expect(screen.getByText("fine")).toBeInTheDocument();
    expect(screen.queryByText("other fallback")).not.toBeInTheDocument();
  });

  it("calls onError exactly once per error", () => {
    const onError = vi.fn();
    render(<ErrorBoundary fallback={() => <p>x</p>} onError={onError}><Bomb explode /></ErrorBoundary>);
    takeConsoleErrors();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "boom" });
  });

  it("tries again when resetKey changes (the record was fixed)", () => {
    const { rerender } = render(<ErrorBoundary resetKey="v1" fallback={() => <p>fallback</p>}><Bomb explode /></ErrorBoundary>);
    takeConsoleErrors();
    expect(screen.getByText("fallback")).toBeInTheDocument();
    rerender(<ErrorBoundary resetKey="v2" fallback={() => <p>fallback</p>}><Bomb explode={false} /></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("stays on the fallback when resetKey does NOT change", () => {
    const { rerender } = render(<ErrorBoundary resetKey="v1" fallback={() => <p>fallback</p>}><Bomb explode /></ErrorBoundary>);
    takeConsoleErrors();
    rerender(<ErrorBoundary resetKey="v1" fallback={() => <p>fallback</p>}><Bomb explode={false} /></ErrorBoundary>);
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });

  it("turns a thrown non-Error (a string) into an Error", () => {
    function Throws(): never {
      throw "just text"; // eslint-disable-line no-throw-literal
    }
    render(<ErrorBoundary fallback={(e) => <p>{e instanceof Error ? e.message : "not an error"}</p>}><Throws /></ErrorBoundary>);
    takeConsoleErrors();
    expect(screen.getByText("just text")).toBeInTheDocument();
  });

  it("does NOT catch an error thrown in a click handler (that needs try/catch)", async () => {
    const seen: string[] = [];
    const listener = (event: ErrorEvent) => {
      seen.push(event.message);
      event.preventDefault();
    };
    window.addEventListener("error", listener);
    function Button() {
      const [n, setN] = useState(0);
      return <button onClick={() => { setN(n + 1); throw new Error("handler broke"); }}>click {n}</button>;
    }
    render(<ErrorBoundary fallback={() => <p>fallback</p>}><Button /></ErrorBoundary>);
    await userEvent.click(screen.getByRole("button"));
    window.removeEventListener("error", listener);
    takeConsoleErrors();
    expect(screen.queryByText("fallback")).not.toBeInTheDocument(); // the boundary did not fire
    expect(seen.join(" ")).toContain("handler broke"); // the error went to the window instead
  });
});
