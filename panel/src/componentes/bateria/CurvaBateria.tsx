import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { CategoryScale, Chart, Filler, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import type { ChartData, ChartOptions } from 'chart.js';
import type { MuestraBateria } from '@contratos';
import { fechaHora, hora } from '@/dominio/formatoBase';
import { cn } from '@/lib/cn';
import { colorToken, useTema } from '@/lib/tema';

Chart.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler);


// Curva de batería en marino; los tramos con el cargador conectado se pintan
// en verde (movimiento) para que se vea cuándo cargó el teléfono.
export function CurvaBateria({
  muestras,
  etiqueta = 'fechaHora',
  className,
}: {
  muestras: MuestraBateria[];
  etiqueta?: 'hora' | 'fechaHora';
  className?: string;
}) {
  // Paleta desde los tokens del tema vigente (se recalcula al cambiarlo).
  const tema = useTema((e) => e.tema);
  const { MARINO, CARGA, relleno, rejilla, borde, textoEje } = useMemo(
    () => ({
      MARINO: colorToken('marino-600'),
      CARGA: colorToken('movimiento'),
      relleno: tema === 'oscuro' ? 'rgba(147, 176, 214, 0.10)' : 'rgba(23, 54, 93, 0.08)',
      rejilla: colorToken('borde'),
      borde: colorToken('borde-fuerte'),
      textoEje: colorToken('texto-3'),
    }),
    [tema],
  );
  const conValor = useMemo(() => muestras.filter((m) => m.bateriaPct != null), [muestras]);
  const hayCarga = conValor.some((m) => m.cargando);

  const datos: ChartData<'line'> = useMemo(
    () => ({
      labels: conValor.map((m) => (etiqueta === 'hora' ? hora(m.registradoEn) : fechaHora(m.registradoEn))),
      datasets: [
        {
          label: 'Batería',
          data: conValor.map((m) => m.bateriaPct),
          borderColor: MARINO,
          backgroundColor: relleno,
          fill: true,
          tension: 0.25,
          pointBackgroundColor: conValor.map((m) => (m.cargando ? CARGA : MARINO)),
          pointBorderColor: conValor.map((m) => (m.cargando ? CARGA : MARINO)),
          segment: {
            borderColor: (ctx) => (conValor[ctx.p1DataIndex]?.cargando ? CARGA : MARINO),
          },
        },
      ],
    }),
    [conValor, etiqueta, MARINO, CARGA, relleno],
  );

  const opciones: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => `${v}%`, color: textoEje, font: { size: 11 } },
          grid: { color: rejilla },
          border: { color: borde },
        },
        x: {
          ticks: { maxTicksLimit: 8, autoSkip: true, color: textoEje, font: { size: 11 } },
          grid: { display: false },
          border: { color: borde },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.parsed.y}%${conValor[item.dataIndex]?.cargando ? ' · cargando' : ''}`,
          },
        },
      },
      elements: { line: { borderWidth: 2 }, point: { radius: 2, hitRadius: 8 } },
    }),
    [conValor, rejilla, borde, textoEje],
  );

  return (
    <div className={className}>
      <div className={cn('h-64 w-full')}>
        <Line data={datos} options={opciones} />
      </div>
      {hayCarga && (
        <p className="mt-2 flex items-center gap-2 text-[11.5px] text-texto-2">
          <span className="h-0.5 w-5 rounded bg-movimiento" /> Tramos con el cargador conectado
        </p>
      )}
    </div>
  );
}
