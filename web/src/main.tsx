import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth';
import { AppShell, RequireRole } from './components/app-shell';
import { ApiError } from './lib/api';
import { AlertsPage } from './pages/alerts-page';
import { LoginPage } from './pages/login-page';
import { OrdersPage } from './pages/orders-page';
import { ProductsPage } from './pages/products-page';
import { StockPage } from './pages/stock-page';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Retry only what might succeed on retry (network/5xx), never 4xx.
      retry: (count, error) => count < 2 && (!(error instanceof ApiError) || error.retryable),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppShell />}>
              <Route path="/stock" element={<StockPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route
                path="/products"
                element={
                  <RequireRole role="ADMIN">
                    <ProductsPage />
                  </RequireRole>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/stock" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
