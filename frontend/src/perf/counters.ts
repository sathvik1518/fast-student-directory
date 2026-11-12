/** Counts how many times parts of the page render. Used to measure speed changes. One integer add: free.
 *  Add ?perf to the address to read the numbers in the console:  window.__perf.get() */
const counts: Record<string, number> = {};

export function bump(name: string): void {
  counts[name] = (counts[name] ?? 0) + 1;
}

export function resetCounts(): void {
  for (const key of Object.keys(counts)) delete counts[key];
}

export function getCounts(): Record<string, number> {
  return { ...counts };
}

declare global {
  interface Window {
    __perf?: { get: () => Record<string, number>; reset: () => void };
  }
}

if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("perf")) {
  window.__perf = { get: getCounts, reset: resetCounts };
}
