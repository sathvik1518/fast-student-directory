import { Component, type ReactNode } from "react";

export type ErrorBoundaryProps = {
  /** What to show instead of the broken part. */
  fallback: (error: Error) => ReactNode;
  /** When this value changes, the boundary tries its children again (for example, the record was fixed). */
  resetKey?: unknown;
  /** Called once per caught error, so it can be reported. */
  onError?: (error: Error) => void;
  children: ReactNode;
};

type State = { error: Error | null; resetKey: unknown };

/** A boundary stops a render error from climbing up and blanking the page. It catches errors made WHILE RENDERING its children.
 *  It does NOT catch errors in event handlers, in timers, or in async code: those need try/catch. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    if (!Object.is(props.resetKey, state.resetKey)) return { error: null, resetKey: props.resetKey };
    return null;
  }

  override componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
