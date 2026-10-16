import { Component } from 'react'

export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('StockPilot screen crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="sp-error-state" role="alert">
        <h2>This screen crashed</h2>
        <p>The details are in the browser console. Reloading usually fixes it.</p>
        <button type="button" className="sp-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
