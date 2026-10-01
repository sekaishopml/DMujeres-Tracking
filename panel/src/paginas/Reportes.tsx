import { useState } from 'react';
import { Segmentado } from '@/componentes/ui/Segmentado';
import Cronograma from '@/componentes/reportes/Cronograma';
import Recorridos from '@/componentes/reportes/Recorridos';

type Vista = 'cronograma' | 'recorridos';
const VISTAS = [
  { valor: 'cronograma', etiqueta: 'Cronograma de actividades' },
  { valor: 'recorridos', etiqueta: 'Recorridos' },
] as const;

// Reportes: el cronograma que carga cada persona en la app (auditado contra su
// recorrido) y, aparte, las métricas de viajes, paradas y distancias.
export default function Reportes() {
  const [vista, setVista] = useState<Vista>('cronograma');
  return (
    <div className="space-y-4">
      <Segmentado opciones={VISTAS} valor={vista} alCambiar={setVista} />
      {vista === 'cronograma' ? <Cronograma /> : <Recorridos />}
    </div>
  );
}
