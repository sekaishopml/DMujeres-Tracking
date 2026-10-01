import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { ResumenDispositivo } from '@contratos';
import { colorToken, useTema } from '@/lib/tema';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const MAX_BARRAS = 12;

// Barras horizontales por persona; la seleccionada (o la de mayor distancia)
// va en magenta y el resto en marino.
export default function GraficoDistancia({
  filas,
  resaltarId,
}: {
  filas: ResumenDispositivo[];
  resaltarId?: string;
}) {
  const ordenadas = [...filas].sort((a, b) => b.distanciaKm - a.distanciaKm).slice(0, MAX_BARRAS);
  const idResaltado = resaltarId || ordenadas[0]?.idPublico;
  // Los colores salen de los tokens del tema: al cambiarlo, el gráfico se
  // vuelve a montar (key) con la paleta nueva.
  const tema = useTema((e) => e.tema);
  const marino = colorToken('marino-500');
  const magenta = colorToken('marca');
  return (
    <div style={{ height: Math.max(120, ordenadas.length * 34 + 30) }}>
      <Bar
        key={tema}
        data={{
          labels: ordenadas.map((f) => f.nombre),
          datasets: [
            {
              label: 'Distancia',
              data: ordenadas.map((f) => Number(f.distanciaKm.toFixed(2))),
              backgroundColor: ordenadas.map((f) => (f.idPublico === idResaltado ? magenta : marino)),
              borderRadius: 4,
              maxBarThickness: 22,
            },
          ],
        }}
        options={{
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c) => ` ${Number(c.parsed.x ?? 0).toLocaleString('es-EC')} km` } },
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { display: false },
              border: { display: false },
              ticks: { callback: (v) => `${v} km`, color: colorToken('texto-3'), font: { size: 11 } },
            },
            y: { grid: { display: false }, border: { display: false }, ticks: { color: colorToken('texto'), font: { size: 12 } } },
          },
        }}
      />
    </div>
  );
}
