import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { giveScrollerASize, makeStudents } from "./test/fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("reads the students from /api/students and shows them", async () => {
    giveScrollerASize();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(makeStudents(25)), { headers: { "X-Query-Count": "1" } })));
    render(<App />);
    expect(await screen.findByText("Showing 25 of 25 students")).toBeInTheDocument();
    expect(screen.getByText("The server ran 1 database query for this list.")).toBeInTheDocument();
  });
  it("shows a readable message when the server is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<App />);
    expect(await screen.findByText("Cannot reach the server. Is it running?")).toBeInTheDocument();
  });
  it("junk entries in the list are shown as broken rows; the good ones still show", async () => {
    giveScrollerASize();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([...makeStudents(10), null, "junk"]))));
    render(<App />);
    expect(await screen.findByText("Showing 12 of 12 students")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
    (await import("./test/setup")).takeConsoleErrors();
  });
  it("a list the page cannot read at all gives a message with a way to try again, never an endless 'Loading'", async () => {
    const rows: unknown[] = [];
    Object.defineProperty(rows, "0", { get() { throw new Error("unreadable"); } });
    rows.length = 1;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers(), json: async () => rows }) as unknown as Response));
    render(<App />);
    expect(await screen.findByText("The server sent a list the page could not read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
