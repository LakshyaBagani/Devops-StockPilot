// Loading, empty and error blocks shared by every page.

export function Skeleton({ rows = 4 }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-row" />
      ))}
    </div>
  )
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="empty-block">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="error-block" role="alert">
      <h2>Couldn&rsquo;t load this</h2>
      <p>{error?.message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
