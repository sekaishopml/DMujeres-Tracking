import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { CLAVE_FLOTA } from '@/dominio/datos';
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
// La flota la usan casi todas las secciones: se reusa 20 s al navegar (el
// canal en vivo la marca vieja apenas cambia algo).
consultas.setQueryDefaults(CLAVE_FLOTA, { staleTime: 20_000 });

// Tras publicar una versión nueva, una pestaña abierta pide trozos que ya no
// existen: se recarga una vez (no en bucle) para tomar la versión nueva.
window.addEventListener('vite:preloadError', (evento) => {
  try {
    if (sessionStorage.getItem('recargaVersion') === '1') return;
    sessionStorage.setItem('recargaVersion', '1');
    evento.preventDefault();
    window.location.reload();
  } catch {
    // Sin sessionStorage queda el aviso de la sección.
  }
});
window.addEventListener('load', () => {
  try {
    setTimeout(() => sessionStorage.removeItem('recargaVersion'), 10_000);
  } catch {
    // Nada que limpiar.
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <App />
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ className: 'font-sans' }} />
    </QueryClientProvider>
  </StrictMode>,
);
