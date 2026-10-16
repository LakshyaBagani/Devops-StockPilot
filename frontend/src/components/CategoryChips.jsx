import { CATEGORIES } from '../config.js'

// Rectangular filter chips (3px corners, never pills): one row that scrolls sideways on phones and
// wraps from 640px. '' means all categories.
export function CategoryChips({ value, onChange }) {
  const chips = [{ value: '', label: 'All' }, ...CATEGORIES]
  return (
    <div className="sp-chips sp-stock-chips" role="group" aria-label="Category">
      {chips.map((chip) => (
        <button
          key={chip.value || 'all'}
          type="button"
          className="sp-chip"
          aria-pressed={value === chip.value}
          onClick={() => onChange(chip.value)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
