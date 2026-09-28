import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import './index.css'
import { CardDrawerProvider } from './lib/card-drawer.tsx'
import { ToastProvider } from './lib/toast.tsx'
import { router } from './routes.tsx'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CardDrawerProvider>
          <RouterProvider router={router} />
        </CardDrawerProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
