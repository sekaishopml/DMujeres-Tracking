import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Marco from '@/componentes/marco/Marco';
import { PantallaCarga } from '@/componentes/ui/PantallaCarga';

// Cada página baja por separado: el panel abre rápido y el mapa y los
// gráficos solo se descargan donde se usan.
const Login = lazy(() => import('@/paginas/Login'));
const Inicio = lazy(() => import('@/paginas/Inicio'));
const EnVivo = lazy(() => import('@/paginas/EnVivo'));
const Detalle = lazy(() => import('@/paginas/Detalle'));
const Historial = lazy(() => import('@/paginas/Historial'));
const Replay = lazy(() => import('@/paginas/Replay'));
const Bateria = lazy(() => import('@/paginas/Bateria'));
const Reportes = lazy(() => import('@/paginas/Reportes'));
const Usuarios = lazy(() => import('@/paginas/Usuarios'));
const Grupos = lazy(() => import('@/paginas/Grupos'));
const Clientes = lazy(() => import('@/paginas/Clientes'));
const Configuracion = lazy(() => import('@/paginas/Configuracion'));
const Sistema = lazy(() => import('@/paginas/Sistema'));

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
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="/sistema" element={<Sistema />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
