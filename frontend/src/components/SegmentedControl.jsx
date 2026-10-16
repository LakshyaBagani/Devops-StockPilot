// Native radios in one track, so arrow keys work without extra code; the choice is filled green.
export function SegmentedControl({ name, legend, options, value, onChange, showLegend = false }) {
  const selected = options.find((option) => option.value === value)
  const helpId = `${name}-help`
  return (
    <fieldset className="sp-segmented" aria-describedby={selected?.help ? helpId : undefined}>
      <legend className={showLegend ? 'sp-label' : 'visually-hidden'}>{legend}</legend>
      <div className="sp-segmented-track">
        {options.map((option) => (
          <label key={option.value} className="sp-segment">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {selected?.help && (
        <p id={helpId} className="sp-hint">
          {selected.help}
        </p>
      )}
    </fieldset>
  )
}
