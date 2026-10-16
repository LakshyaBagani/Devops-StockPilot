import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Geist and Geist Mono from the pinned @fontsource packages, declared woff2-only in fonts.css.
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/legacy.css'
import './styles/pages/stock.css'
import './styles/pages/record.css'
import './styles/pages/ledger.css'
import './styles/pages/products.css'
import './styles/pages/detail.css'
import './styles/pages/planner.css'
import './styles/theme.css'
import './styles/shell.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
