// Loading, empty and error blocks shared by every page.

// Placeholder rows shaped like the rows they stand in for (a name and a figure).
export function Skeleton({ rows = 4 }) {
  return (
    <div className="sp-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="sp-skeleton-row" />
      ))}
    </div>
  )
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="sp-empty">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action && <div className="sp-empty-action">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="sp-error-state" role="alert">
      <h2>Couldn&rsquo;t load this</h2>
      <p>{error?.message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" className="sp-btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
