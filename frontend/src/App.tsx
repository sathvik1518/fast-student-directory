import { Directory } from "./directory/Directory";
import { ErrorBoundary } from "./directory/ErrorBoundary";
import { parseListMode } from "./directory/StudentList";

/** The outermost boundary: whatever goes wrong inside, the person still gets a message and a way out, never a white page. */
export function App() {
  return (
    <ErrorBoundary
      fallback={() => (
        <main className="page">
          <div className="problem" role="alert">
            <p>Something went wrong and the directory cannot be shown.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </main>
      )}
    >
      <Directory listMode={parseListMode(window.location.search)} />
    </ErrorBoundary>
  );
}
