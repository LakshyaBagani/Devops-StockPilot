import { CATEGORIES } from '../config.js'

// Bin-label chips in one horizontally scrolling row; '' means all categories.
export function CategoryChips({ value, onChange }) {
  const chips = [{ value: '', label: 'All' }, ...CATEGORIES]
  return (
    <div className="chip-row" role="group" aria-label="Category">
      {chips.map((chip) => (
        <button
          key={chip.value || 'all'}
          type="button"
          className="bin-chip"
          aria-pressed={value === chip.value}
          onClick={() => onChange(chip.value)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
