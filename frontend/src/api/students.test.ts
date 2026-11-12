import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStudents } from "./students";

function answer(body: unknown, init: ResponseInit & { raw?: string } = {}): Response {
  return new Response(init.raw ?? JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}
function stub(fn: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fn));
}
afterEach(() => vi.unstubAllGlobals());

describe("fetchStudents", () => {
  it("asks for /api/students and returns the rows", async () => {
    stub(async () => answer([{ id: 1, name: "A", class_name: "6A", score: 5 }]));
    const result = await fetchStudents();
    expect(result.students).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/students", { signal: undefined });
  });
  it("reads the query count from the header", async () => {
    stub(async () => answer([], { headers: { "X-Query-Count": "1" } }));
    expect((await fetchStudents()).queryCount).toBe(1);
  });
  it.each([["abc"], ["-1"], ["1.5"], [""], ["1e3"]])("ignores a query count of %j", async (value) => {
    stub(async () => answer([], { headers: { "X-Query-Count": value } }));
    expect((await fetchStudents()).queryCount).toBeNull();
  });
  it("no header means null", async () => {
    stub(async () => answer([]));
    expect((await fetchStudents()).queryCount).toBeNull();
  });
  it("passes the abort signal on", async () => {
    stub(async () => answer([]));
    const controller = new AbortController();
    await fetchStudents(controller.signal);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
  });
  it("a network failure becomes a readable message", async () => {
    stub(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchStudents()).rejects.toThrow("Cannot reach the server. Is it running?");
  });
  it("an abort is passed through unchanged, not turned into a message", async () => {
    stub(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(fetchStudents()).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each([[404], [500], [503]])("status %i says the status", async (status) => {
    stub(async () => new Response("x", { status }));
    await expect(fetchStudents()).rejects.toThrow(`The server answered ${status}.`);
  });
  it("text that is not JSON is refused", async () => {
    stub(async () => answer(null, { raw: "<html>oops</html>" }));
    await expect(fetchStudents()).rejects.toThrow("not a student list");
  });
  it.each([[{ students: [] }], ["text"], [5], [null]])("JSON that is not a list (%j) is refused", async (body) => {
    stub(async () => answer(body));
    await expect(fetchStudents()).rejects.toThrow("not a student list");
  });
  it("a list with broken rows is still returned whole (each row is checked later)", async () => {
    stub(async () => answer([{ id: 1, name: null }, "junk", 5]));
    expect((await fetchStudents()).students).toHaveLength(3);
  });
});
