import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import '@/lib/tema';
import './estilos/index.css';

// Caché de consultas: las vistas vivas sondean por su cuenta (sin ráfagas al
// volver el foco); las respuestas pesadas (replay, reportes) se conservan
// 10 min al navegar. Un reintento; el 401 lo resuelve el cliente API.
const consultas = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 4_000, gcTime: 10 * 60_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <App />
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ className: 'font-sans' }} />
    </QueryClientProvider>
  </StrictMode>,
);
