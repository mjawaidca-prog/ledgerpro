'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return this.props.fallback || (
        <div style={{
          padding: 40,
          background: 'var(--surface)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--r-lg)',
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--danger)' }}>Page Error:</strong>
          {'\n\n'}{this.state.error.message}
          {'\n\n'}{this.state.error.stack?.slice(0, 800)}
        </div>
      );
    }
    return this.props.children;
  }
}
