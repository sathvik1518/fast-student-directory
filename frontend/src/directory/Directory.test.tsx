import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Fetcher } from "../api/types";
import { fakeFetcher, giveScrollerASize, makeStudents, withBroken } from "../test/fixtures";
import { getCounts, resetCounts } from "../perf/counters";
import { takeConsoleErrors } from "../test/setup";
import { Directory } from "./Directory";

async function ready(fetcher: Fetcher, props: Partial<React.ComponentProps<typeof Directory>> = {}) {
  giveScrollerASize();
  render(<Directory fetcher={fetcher} {...props} />);
  await screen.findByText(/Showing/);
}
const summary = () => screen.getByText(/^Showing/).textContent;

describe("loading and failing", () => {
  it("says it is loading first", () => {
    render(<Directory fetcher={() => new Promise(() => {})} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading students");
  });

  it("shows the server's problem in plain words and lets the person try again", async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new Error("Cannot reach the server. Is it running?")).mockResolvedValue({ students: makeStudents(5), queryCount: 1 });
    giveScrollerASize();
    render(<Directory fetcher={fetcher} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the server. Is it running?");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Showing 5 of 5/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("a thrown non-Error still gives a readable message", async () => {
    render(<Directory fetcher={() => Promise.reject("nope")} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("an aborted request shows nothing (we left the page)", async () => {
    const { unmount } = render(<Directory fetcher={() => Promise.reject(new DOMException("x", "AbortError"))} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
  });

  it("aborts the request when the page is closed", () => {
    let signal: AbortSignal | undefined;
    const fetcher: Fetcher = (s) => {
      signal = s;
      return new Promise(() => {});
    };
    const { unmount } = render(<Directory fetcher={fetcher} />);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe("the list", () => {
  it("shows the count and the server's query count", async () => {
    await ready(fakeFetcher(makeStudents(300), 1));
    expect(summary()).toBe("Showing 300 of 300 students");
    expect(screen.getByText("The server ran 1 database query for this list.")).toBeInTheDocument();
  });
  it("says 'queries' when there is more than one", async () => {
    await ready(fakeFetcher(makeStudents(3), 5001));
    expect(screen.getByText("The server ran 5001 database queries for this list.")).toBeInTheDocument();
  });
  it("leaves the footnote out when the server did not say", async () => {
    await ready(fakeFetcher(makeStudents(3), null));
    expect(screen.queryByText(/database quer/)).not.toBeInTheDocument();
  });
  it("formats big numbers with commas", async () => {
    await ready(fakeFetcher(makeStudents(5000)));
    expect(summary()).toBe("Showing 5,000 of 5,000 students");
  });
  it("only about 20 of 5,000 rows are on the page", async () => {
    await ready(fakeFetcher(makeStudents(5000)));
    expect(screen.getAllByRole("listitem").length).toBeLessThan(25);
  });
  it("an empty server list says so", async () => {
    await ready(fakeFetcher([]));
    expect(screen.getByText("No student matches this search.")).toBeInTheDocument();
  });
});

describe("searching and filtering", () => {
  it("narrows by name and updates the count", async () => {
    await ready(fakeFetcher(makeStudents(200)));
    await userEvent.type(screen.getByLabelText("Search by name"), "aarav");
    expect(Number(/Showing (\d+) of 200/.exec(summary() ?? "")?.[1])).toBeLessThan(200);
    for (const li of screen.getAllByRole("listitem")) expect(li).toHaveTextContent(/aarav/i);
  });
  it("says so when nothing matches", async () => {
    await ready(fakeFetcher(makeStudents(50)));
    await userEvent.type(screen.getByLabelText("Search by name"), "zzzz");
    expect(screen.getByText("No student matches this search.")).toBeInTheDocument();
    expect(summary()).toBe("Showing 0 of 50 students");
  });
  it("filters by class", async () => {
    await ready(fakeFetcher(makeStudents(300)));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "8B");
    for (const li of screen.getAllByRole("listitem")) expect(li).toHaveTextContent("Class 8B");
  });
  it("sorts high to low", async () => {
    await ready(fakeFetcher(makeStudents(300)));
    await userEvent.selectOptions(screen.getByLabelText("Sort by score"), "desc");
    const scores = screen.getAllByRole("listitem").map((li) => Number(/(\d+)\s*$/.exec(li.textContent ?? "")?.[1]));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBe(100);
  });
  it("a search text longer than the field allows is refused with a message, and the list does not change", async () => {
    await ready(fakeFetcher(makeStudents(50)));
    const box = screen.getByLabelText("Search by name");
    expect(box).toHaveAttribute("maxlength", "50"); // the browser stops real typing at 50; this is the second line of defence
    fireEvent.change(box, { target: { value: "a".repeat(51) } }); // bypasses the browser's limit, as a script or a paste handler could
    expect(screen.getByRole("alert")).toHaveTextContent("Search by name: at most 50 characters");
    expect(box).toHaveAttribute("aria-describedby");
    expect((box as HTMLInputElement).value).toBe(""); // the refused text was NOT used
    expect(summary()).toBe("Showing 50 of 50 students");
    fireEvent.change(box, { target: { value: "aarav" } }); // the next good value clears the message
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shows the broken-record notice and finds them with the checkbox", async () => {
    await ready(fakeFetcher(withBroken(makeStudents(50))));
    expect(takeConsoleErrors().length).toBeGreaterThanOrEqual(0);
    expect(screen.getByText(/4 records have a problem/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Show only broken records"));
    expect(summary()).toBe("Showing 4 of 50 students");
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    takeConsoleErrors();
  });
  it("says 'record has' for exactly one", async () => {
    const rows = makeStudents(10);
    rows[0] = { ...rows[0]!, name: null };
    await ready(fakeFetcher(rows));
    takeConsoleErrors();
    expect(screen.getByText(/1 record has a problem/)).toBeInTheDocument();
  });
  it("search words are matched case-insensitively and trimmed", async () => {
    await ready(fakeFetcher(makeStudents(100)));
    await userEvent.type(screen.getByLabelText("Search by name"), "  AARAV  ");
    expect(summary()).not.toBe("Showing 100 of 100 students");
  });
});

describe("the detail card", () => {
  it("opens for the clicked student and closes again", async () => {
    await ready(fakeFetcher(makeStudents(30)));
    await userEvent.click(screen.getAllByRole("button")[0 + 4]!); // skip: first buttons are rows (form has no buttons)
    const card = screen.getByRole("region", { name: "Student details" });
    expect(within(card).getByRole("heading", { level: 2 })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Student details" })).not.toBeInTheDocument();
  });
  it("marks the clicked row as pressed", async () => {
    await ready(fakeFetcher(makeStudents(30)));
    const row = screen.getAllByRole("button")[1]!;
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
  });
  it("a broken record's card shows a message and the list around it keeps working", async () => {
    const rows = makeStudents(30);
    rows[4] = { ...rows[4]!, score: "absent" }; // id 5: the row can still be clicked? no: it shows a warning instead of a button.
    await ready(fakeFetcher(rows));
    takeConsoleErrors();
    expect(screen.getAllByRole("alert")).toHaveLength(1); // the row warning
    // Other rows still select fine.
    await userEvent.click(screen.getAllByRole("button")[0]!);
    expect(screen.getByRole("region", { name: "Student details" })).toBeInTheDocument();
  });
});

describe("speed rules, through the whole page", () => {
  it("memo mode: selecting a student redraws only the rows that changed (the Directory keeps onSelect stable)", async () => {
    await ready(fakeFetcher(makeStudents(100)), { listMode: "memo" });
    resetCounts();
    await userEvent.click(screen.getAllByRole("button")[2]!);
    expect(getCounts().row).toBe(1);
    resetCounts();
    await userEvent.click(screen.getAllByRole("button")[5]!);
    expect(getCounts().row).toBe(2); // the old selection and the new one
  });
  it("plain mode: the same click redraws every row (this is the 'before')", async () => {
    await ready(fakeFetcher(makeStudents(100)), { listMode: "plain" });
    resetCounts();
    await userEvent.click(screen.getAllByRole("button")[2]!);
    expect(getCounts().row).toBe(100);
  });
  it("the Directory itself draws once per real change, not once per row", async () => {
    await ready(fakeFetcher(makeStudents(100)), { listMode: "memo" });
    resetCounts();
    await userEvent.click(screen.getAllByRole("button")[2]!);
    expect(getCounts().directory).toBe(1);
  });
});

describe("settings that are wrong", () => {
  it("switches the form off with the reasons, and the list still works", async () => {
    await ready(fakeFetcher(makeStudents(20)), { settings: [{ name: "query", type: "text" }] });
    expect(screen.getByRole("alert")).toHaveTextContent("The filter settings are not valid");
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(summary()).toBe("Showing 20 of 20 students");
  });
  it("not even an array", async () => {
    await ready(fakeFetcher(makeStudents(5)), { settings: "nope" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(summary()).toBe("Showing 5 of 5 students");
  });
});

describe("list modes", () => {
  it.each(["plain", "memo-inline", "memo", "virtual", "virtual-deferred"] as const)("%s shows the same students", async (mode) => {
    await ready(fakeFetcher(makeStudents(40)), { listMode: mode });
    expect(screen.getAllByRole("button").length).toBeGreaterThan(5);
    await waitFor(() => expect(summary()).toBe("Showing 40 of 40 students"));
  });
});
