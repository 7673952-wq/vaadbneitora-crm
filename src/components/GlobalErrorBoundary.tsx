import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error: Error | null };

export class GlobalErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[GlobalErrorBoundary]", error, info);
  }

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center space-y-4 rounded-xl border border-border p-8 shadow-sm">
            <h1 className="text-xl font-semibold">משהו השתבש</h1>
            <p className="text-muted-foreground text-sm">אנא רענן את הדף ונסה שוב.</p>
            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground/70 break-words">{this.state.error.message}</p>
            )}
            <button
              onClick={this.handleReload}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90"
            >
              רענן
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default GlobalErrorBoundary;
