import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[UI] Render boundary caught error", {
      label: this.props.label ?? "application",
      error,
      stack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-[22rem] rounded-xl border border-red-400/30 bg-red-950/30 p-6 text-red-100">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-red-300">MX Patrol screen error</p>
        <h2 className="mt-2 text-xl font-black text-white">This panel could not load</h2>
        <p className="mt-2 text-sm text-red-100/80">
          {this.state.error.message || "Unknown screen error"}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg border border-red-300/30 px-4 py-2 text-sm font-bold text-red-100 hover:bg-red-400/10"
        >
          Reload
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
