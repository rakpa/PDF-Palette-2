import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time exceptions on the heavy paths — WASM, workers, OCR,
 * PDF parsing — that would otherwise drop the whole app to a blank page.
 * Keyed by route in App.tsx, so navigating away clears the error.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled error in PDF Palette:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="max-w-md text-muted-foreground">
            This tool hit an unexpected error, often caused by a file that's too large or
            unusual for your browser to process. Try another file, or head back and pick a
            different tool.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => window.location.assign("/")}>
              Back to home
            </Button>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
