import { useEffect } from 'react'

import { AppShell } from './components/AppShell.jsx'
import { InventoryEventsProvider } from './components/InventoryEventsProvider.jsx'
import { ToastProvider } from './components/ToastProvider.jsx'
import { matchRoute, tabFor } from './lib/routes.js'
import { LedgerPage } from './pages/LedgerPage.jsx'
import { NotFoundPage } from './pages/NotFoundPage.jsx'
import { PlannerPage } from './pages/PlannerPage.jsx'
import { ProductDetailPage } from './pages/ProductDetailPage.jsx'
import { ProductFormPage } from './pages/ProductFormPage.jsx'
import { ProductsPage } from './pages/ProductsPage.jsx'
import { RecordSheet } from './pages/RecordSheet.jsx'
import { StockPage } from './pages/StockPage.jsx'
import { navigate, useLocation } from './router.js'

function pageFor(route) {
  switch (route.name) {
    case 'stock':
    case 'record':
      return <StockPage />
    case 'ledger':
      return <LedgerPage />
    case 'planner':
      return <PlannerPage />
    case 'products':
      return <ProductsPage />
    case 'productNew':
      return <ProductFormPage />
    // Keyed by id, so moving between products never shows the previous one's data.
    case 'productDetail':
      return <ProductDetailPage key={route.params.id} id={route.params.id} />
    case 'productEdit':
      return <ProductFormPage key={route.params.id} id={route.params.id} />
    default:
      return <NotFoundPage />
  }
}

export default function App() {
  const { pathname, query } = useLocation()
  const route = matchRoute(pathname)
  const sheetOpen = query.get('sheet') === 'record'

  // '/record' is a deep-link alias for the sheet over the stock page.
  useEffect(() => {
    if (route.name === 'record') navigate('/?sheet=record', { replace: true })
  }, [route.name])

  return (
    <ToastProvider>
      <InventoryEventsProvider>
        <AppShell tab={tabFor(route.name)} pageKey={pathname} sheetOpen={sheetOpen}>
          {pageFor(route)}
        </AppShell>
        {sheetOpen && <RecordSheet />}
      </InventoryEventsProvider>
    </ToastProvider>
  )
}
