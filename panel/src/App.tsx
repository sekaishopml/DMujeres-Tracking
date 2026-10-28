import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Marco from '@/componentes/marco/Marco';
import { PantallaCarga } from '@/componentes/ui/PantallaCarga';
import { cargarPagina } from '@/lib/paginas';

// Cada página baja por separado: el panel abre rápido y el mapa y los
// gráficos solo se descargan donde se usan.
const Login = lazy(() => import('@/paginas/Login'));
const Inicio = lazy(cargarPagina['/']);
const EnVivo = lazy(cargarPagina['/en-vivo']);
const Detalle = lazy(() => import('@/paginas/Detalle'));
const Historial = lazy(cargarPagina['/historial']);
const Replay = lazy(cargarPagina['/replay']);
const Bateria = lazy(cargarPagina['/bateria']);
const Reportes = lazy(cargarPagina['/reportes']);
const Usuarios = lazy(cargarPagina['/usuarios']);
const Grupos = lazy(cargarPagina['/grupos']);
const Geocercas = lazy(cargarPagina['/geocercas']);
const Configuracion = lazy(cargarPagina['/configuracion']);
const Sistema = lazy(cargarPagina['/sistema']);

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PantallaCarga />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Marco />}>
            <Route index element={<Inicio />} />
            <Route path="/en-vivo" element={<EnVivo />} />
            <Route path="/unidad/:id" element={<Detalle />} />
            <Route path="/historial" element={<Historial />} />
            <Route path="/replay" element={<Replay />} />
            <Route path="/bateria" element={<Bateria />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/grupos" element={<Grupos />} />
            <Route path="/geocercas" element={<Geocercas />} />
            <Route path="/clientes" element={<Navigate to="/geocercas" replace />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="/sistema" element={<Sistema />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
