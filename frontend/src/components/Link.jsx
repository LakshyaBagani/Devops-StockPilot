import { navigate } from '../router.js'

// A real <a href>, so middle-click, cmd/ctrl-click and "open in new tab" keep working;
// only unmodified left clicks are routed in-app.
export function Link({ to, replace = false, state, onClick, children, ...rest }) {
  function handleClick(event) {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target === '_blank'
    ) {
      return
    }
    event.preventDefault()
    navigate(to, { replace, state })
  }

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
}
