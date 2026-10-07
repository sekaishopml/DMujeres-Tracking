import { useMemo, useRef, useState } from 'react';
import type { MouseEvent as EventoRaton, ReactNode } from 'react';
import { CategoryScale, Chart as ChartJS, Filler, LineElement, LinearScale, PointElement } from 'chart.js';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { Hueco } from '@contratos';
import { bateria, duracion, GUION, velocidad } from '@/dominio/formatoBase';
import { FastForward, Maximize2, Minimize2, SkipBack, SkipForward } from 'lucide-react';
import Icono from './Icono';
import { colorToken, useTema } from '@/lib/tema';
import { etiquetaVisita } from '@/dominio/dia';
import { etiquetaCorte } from './globos';
import {
  horaCorta,
  indiceBateriaConocida,
  duracionCorta,
  indicePorInstante,
  milisegundos,
  serieBateria,
} from '@/dominio/replay';
import type { Microparada, Parada } from '@/dominio/replay';
import {
  ANCHO_EJE_BATERIA_PX,
  ANCHO_EJE_VELOCIDAD_PX,
  VELOCIDADES,
  indiceCercano,
  CLASE_ESTADO,
  ETIQUETA_ESTADO_PUNTO,
  OPCIONES_BATERIA,
} from './reproductorComun';
import {
  useReproductor,
} from './contextoReproductor';


// Chart.js exige registrar las piezas que se dibujan. El gráfico del
// reproductor es una línea con relleno, sin ejes, sin leyenda y sin tooltip:
// solo se registran escala, línea, punto y relleno.
ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler);


// Gráfico de la franja inferior: batería con un punto en la posición actual.
// Ampliado suma la velocidad en su propio eje. Las paradas se marcan en la
// línea de tiempo, no aquí.
function GraficoBateria({ ampliada }: { ampliada: boolean }) {
  const { posiciones, indice, pausar, mover } = useReproductor();
  const [bajoCursor, setBajoCursor] = useState<{ indice: number; x: number } | null>(null);
  const serie = useMemo(() => serieBateria(posiciones), [posiciones]);
  const velocidades = useMemo(
    () => posiciones.map((p) => (p.velocidadKmh != null && Number.isFinite(p.velocidadKmh) ? p.velocidadKmh : null)),
    [posiciones],
  );
  const instantes = useMemo(() => posiciones.map((p) => milisegundos(p.registradoEn)), [posiciones]);
  const hayBateria = useMemo(() => serie.some((valor) => valor != null), [serie]);
  const tema = useTema((e) => e.tema);

  // Eje X en tiempo real: una parada de horas ocupa su ancho verdadero, igual
  // que en la pista de tiempo de abajo.
  const datos = useMemo<ChartData<'line', { x: number; y: number | null }[]>>(() => {
    const linea = colorToken('marino-600');
    const relleno = tema === 'oscuro' ? 'rgba(147, 176, 214, .12)' : 'rgba(10, 37, 64, .1)';
    const indicePunto = indiceBateriaConocida(serie, indice);
    const punto = instantes[indicePunto];
    const conjuntos: ChartData<'line', { x: number; y: number | null }[]>['datasets'] = [
      {
        data: serie.map((valor, i) => ({ x: instantes[i], y: valor })),
        borderColor: linea,
        backgroundColor: relleno,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        spanGaps: true,
        yAxisID: 'y',
      },
      {
        data: punto != null ? [{ x: punto, y: serie[indicePunto] }] : [],
        borderColor: linea,
        backgroundColor: linea,
        pointRadius: 3.5,
        pointHoverRadius: 3.5,
        showLine: false,
        yAxisID: 'y',
      },
    ];
    if (ampliada) {
      conjuntos.push({
        data: velocidades.map((valor, i) => ({ x: instantes[i], y: valor })),
        borderColor: colorToken('movimiento'),
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        spanGaps: false,
        yAxisID: 'velocidad',
      });
    }
    return { datasets: conjuntos };
  }, [serie, velocidades, instantes, indice, tema, ampliada]);

  const opciones = useMemo<ChartOptions<'line'>>(() => {
    const ticks = { font: { size: 10 }, color: colorToken('texto-3') };
    return {
      ...OPCIONES_BATERIA,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      parsing: false,
      onClick: (_evento, elementos) => {
        const elemento = elementos.find((e) => e.datasetIndex === 0);
        if (!elemento) return;
        pausar();
        mover(elemento.index);
      },
      onHover: (evento, elementos) => {
        const destino = evento.native?.target as HTMLElement | null;
        const elemento = elementos.find((e) => e.datasetIndex === 0);
        if (destino) destino.style.cursor = elemento ? 'pointer' : '';
        setBajoCursor(elemento ? { indice: elemento.index, x: elemento.element.x } : null);
      },
      scales: {
        x: { type: 'linear', display: false, min: instantes[0], max: instantes[instantes.length - 1] },
        y: ampliada
          ? {
              display: true,
              min: 0,
              max: 100,
              ticks: { ...ticks, stepSize: 50, callback: (v) => `${v}%` },
              grid: { color: colorToken('borde') },
              border: { display: false },
              // Ancho fijo de los ejes: la pista de tiempo de abajo usa los
              // mismos márgenes (replay.css) y así cada parada queda debajo
              // de su tramo de la gráfica.
              afterFit: (escala) => {
                escala.width = ANCHO_EJE_BATERIA_PX;
              },
            }
          : { display: false, min: 0, max: 100 },
        velocidad: {
          display: ampliada,
          position: 'right',
          min: 0,
          suggestedMax: 40,
          ticks: { ...ticks, maxTicksLimit: 3, callback: (v) => `${v} km/h` },
          grid: { display: false },
          border: { display: false },
          afterFit: (escala) => {
            if (ampliada) escala.width = ANCHO_EJE_VELOCIDAD_PX;
          },
        },
      },
    };
  }, [mover, pausar, ampliada, instantes]);
  if (!hayBateria) return null;
  const bajo = bajoCursor ? posiciones[bajoCursor.indice] : null;
  const valorBajo = bajoCursor ? serie[bajoCursor.indice] : null;
  return (
    <div className="replay-bateria" onMouseLeave={() => setBajoCursor(null)}>
      <Line data={datos} options={opciones} />
      {bajo && valorBajo != null && bajoCursor && (
        <span className="bateria-etiqueta" style={{ left: bajoCursor.x }} role="status">
          <strong>{Math.round(valorBajo)}%</strong> · {horaCorta(bajo.registradoEn)}
          {ampliada && bajo.velocidadKmh != null && ` · ${velocidad(bajo.velocidadKmh)}`}
        </span>
      )}
    </div>
  );
}


// Mandos del reproductor: transporte (play/pausa, seguir, paso a paso) y
// velocidades, como dos grupos que la rejilla de la franja ubica: compacta,
// en una fila sobre la pista; ampliada, a los lados de la pista.
function ControlesReplay() {
  const {
    posiciones,
    indice,
    reproduciendo,
    velocidad: velocidadReproduccion,
    seguir,
    alternar,
    alternarSeguir,
    moverPunto,
    cambiarVelocidad,
    irAParada,
    saltarEsperas,
    alternarSaltarEsperas,
    paradas,
  } = useReproductor();
  const unico = posiciones.length < 2;
  return (
    <>
      <div className="replay-transporte">
      <button
        type="button"
        className="suave icono-solo"
        onClick={alternar}
        disabled={unico}
        title={reproduciendo ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
        aria-label={reproduciendo ? 'Pausar' : 'Reproducir'}
      >
        <Icono nombre={reproduciendo ? 'pausa' : 'play'} />
      </button>
      <button
        type="button"
        className={`suave icono-solo${seguir ? ' seguir-activo' : ''}`}
        onClick={alternarSeguir}
        disabled={unico}
        title={seguir ? 'Dejar de seguir el punto' : 'Seguir el punto en el mapa'}
        aria-label={seguir ? 'Dejar de seguir el punto' : 'Seguir el punto en el mapa'}
        aria-pressed={seguir}
      >
        <Icono nombre="enVivo" />
      </button>
      <button
        type="button"
        className="suave icono-solo"
        onClick={() => moverPunto(-1)}
        disabled={unico || indice <= 0}
        title="Punto anterior (←)"
        aria-label="Punto anterior"
      >
        <span className="voltear">
          <Icono nombre="flecha" />
        </span>
      </button>
      <button
        type="button"
        className="suave icono-solo"
        onClick={() => moverPunto(1)}
        disabled={unico || indice >= posiciones.length - 1}
        title="Punto siguiente (→)"
        aria-label="Punto siguiente"
      >
        <Icono nombre="flecha" />
      </button>
      <span className="transporte-separador" aria-hidden="true" />
      <button
        type="button"
        className="suave icono-solo"
        onClick={() => irAParada(-1)}
        disabled={unico || paradas.length === 0}
        title="Parada anterior (P)"
        aria-label="Parada anterior"
      >
        <SkipBack size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="suave icono-solo"
        onClick={() => irAParada(1)}
        disabled={unico || paradas.length === 0}
        title="Parada siguiente (N)"
        aria-label="Parada siguiente"
      >
        <SkipForward size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`suave icono-solo${saltarEsperas ? ' seguir-activo' : ''}`}
        onClick={alternarSaltarEsperas}
        disabled={unico}
        title={saltarEsperas ? 'Las paradas pasan rápido al reproducir (clic para verlas a tiempo real)' : 'Pasar rápido las paradas y los cortes de señal'}
        aria-label="Pasar rápido las paradas y los cortes de señal"
        aria-pressed={saltarEsperas}
      >
        <FastForward size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      </div>
      <div className="velocidades">
        {VELOCIDADES.map((valor) => (
          <button
            key={valor}
            type="button"
            className={`suave${velocidadReproduccion === valor ? ' velocidad-activa' : ''}`}
            onClick={() => cambiarVelocidad(valor)}
            title={`Velocidad ${valor}× (teclas + y -)`}
            aria-pressed={velocidadReproduccion === valor}
          >
            {valor}×
          </button>
        ))}
      </div>
    </>
  );
}

// Qué hay bajo el cursor en la pista: una parada, una microparada, un corte
// de señal o solo la hora.
type MarcaPista =
  | { tipo: 'parada'; indice: number; parada: Parada }
  | { tipo: 'micro'; micro: Microparada }
  | { tipo: 'hueco'; hueco: Hueco; indiceParada: number | null }
  | { tipo: 'hora' };

// Holgura en píxeles para acertar una microparada, que en la pista es una
// raya de 3 px.
const TOLERANCIA_MICRO_PX = 5;
// Margen de la pista a cada lado: medio pulgar del slider (12 px). El pulgar
// recorre [6 px, ancho - 6 px] y las marcas se dibujan en ese mismo tramo.
const MARGEN_PISTA_PX = 6;

// Pista de tiempo: el slider con su riel propio, donde se leen las paradas
// (bloques numerados como en la lista), las microparadas (rayas) y los cortes
// de señal (punteado). Al pasar el cursor, un globo dice qué hay en ese
// instante; al pulsar una parada o microparada se selecciona y el mapa vuela
// hasta ella, igual que desde la lista.
function PistaTiempo({ ampliada }: { ampliada: boolean }) {
  const {
    posiciones,
    huecos,
    paradas,
    microparadas,
    paradaSeleccionada,
    punto,
    sliderRef,
    mover,
    pausar,
    seleccionarParada,
    resumen,
  } = useReproductor();
  const [bajo, setBajo] = useState<{ fraccion: number; instante: number; marca: MarcaPista } | null>(null);
  const primera = posiciones[0] ?? null;
  const ultima = posiciones[posiciones.length - 1] ?? null;
  const inicio = primera ? milisegundos(primera.registradoEn) : 0;
  const fin = ultima ? milisegundos(ultima.registradoEn) : 0;
  const total = Math.max(0, fin - inicio);
  const pct = (instante: number) => (total > 0 ? Math.min(Math.max(((instante - inicio) / total) * 100, 0), 100) : 0);
  const ahora = punto ? milisegundos(punto.registradoEn) : null;

  function marcaEn(instante: number, anchoUtil: number): MarcaPista {
    const indice = paradas.findIndex((p) => milisegundos(p.inicio) <= instante && instante <= milisegundos(p.fin));
    // Un corte de señal dentro de una parada (el teléfono no reportó mientras
    // estaba ahí) se dice primero: es lo que se busca al auditar la cobertura.
    const hueco = huecos.find((h) => milisegundos(h.desde) <= instante && instante <= milisegundos(h.hasta));
    if (hueco) return { tipo: 'hueco', hueco, indiceParada: indice >= 0 ? indice : null };
    if (indice >= 0) return { tipo: 'parada', indice, parada: paradas[indice] };
    const tolerancia = anchoUtil > 0 ? (TOLERANCIA_MICRO_PX / anchoUtil) * total : 0;
    const micro = microparadas.find(
      (m) => milisegundos(m.inicio) - tolerancia <= instante && instante <= milisegundos(m.fin) + tolerancia,
    );
    if (micro) return { tipo: 'micro', micro };
    return { tipo: 'hora' };
  }

  function alMover(evento: EventoRaton<HTMLDivElement>) {
    // La interfaz tiene zoom (--zoom-ui): la caja y el cursor vienen en píxeles
    // de pantalla y el margen en píxeles de diseño, así que se escala. El globo
    // se ubica por proporción.
    const caja = evento.currentTarget.getBoundingClientRect();
    const escala = evento.currentTarget.offsetWidth > 0 ? caja.width / evento.currentTarget.offsetWidth : 1;
    const margen = MARGEN_PISTA_PX * escala;
    const anchoUtil = caja.width - margen * 2;
    if (anchoUtil <= 0 || total <= 0) return;
    const fraccion = Math.min(Math.max((evento.clientX - caja.left - margen) / anchoUtil, 0), 1);
    const instante = inicio + fraccion * total;
    setBajo({ fraccion, instante, marca: marcaEn(instante, anchoUtil) });
  }

  // Soltar después de arrastrar la barra también dispara un "click": solo
  // cuenta como clic si el puntero casi no se movió.
  const inicioPulsacion = useRef<number | null>(null);
  function alPulsar(evento: EventoRaton<HTMLDivElement>) {
    const desde = inicioPulsacion.current;
    inicioPulsacion.current = null;
    if (desde == null || Math.abs(evento.clientX - desde) > 4) return;
    // Llevar el mapa a la parada solo con la franja ampliada: en la compacta un
    // clic en la barra solo mueve el reloj.
    if (!ampliada) return;
    const marca = bajo?.marca;
    if (marca?.tipo === 'parada' || (marca?.tipo === 'hueco' && marca.indiceParada != null)) {
      const indice = marca.tipo === 'parada' ? marca.indice : marca.indiceParada!;
      const parada = paradas[indice];
      seleccionarParada(indice, parada.latitud, parada.longitud, milisegundos(parada.inicio));
    } else if (marca?.tipo === 'micro') {
      const { micro } = marca;
      seleccionarParada(null, micro.latitud, micro.longitud, milisegundos(micro.inicio));
    }
  }

  // Un solo globo, siempre con la misma forma: arriba lo que marcaba el
  // teléfono en esa hora (igual que al pasar por la línea del mapa) y, si hay
  // algo ahí, abajo qué es. Así no cambia de color ni de tamaño al pasar de una
  // parada a la raya de al lado.
  function textoGlobo(marca: MarcaPista, instante: number): ReactNode {
    const fix = posiciones.length > 0 ? posiciones[indiceCercano(posiciones, instante)] : null;
    const rol = (indice: number) => (resumen ? etiquetaVisita(resumen.numeroVisita[indice]) : null);
    let detalle: ReactNode = null;
    switch (marca.tipo) {
      case 'parada':
        detalle = (
          <>
            {rol(marca.indice) ? `${rol(marca.indice)} · ` : ''}Parada {marca.indice + 1} · {horaCorta(marca.parada.inicio)} –{' '}
            {horaCorta(marca.parada.fin)} · {duracion(marca.parada.duracionMin * 60)}
            {marca.parada.direccion && <span className="globo-linea">{marca.parada.direccion}</span>}
          </>
        );
        break;
      case 'micro':
        detalle = (
          <>
            Microparada · {horaCorta(marca.micro.inicio)} · {duracionCorta(marca.micro.duracionS)}
          </>
        );
        break;
      case 'hueco':
        detalle = (
          <>
            {etiquetaCorte(marca.hueco.motivo)} · {horaCorta(marca.hueco.desde)} –{' '}
            {horaCorta(marca.hueco.hasta)} · {duracion(marca.hueco.duracionSegundos)}
          </>
        );
        break;
      default:
        break;
    }
    return (
      <>
        <strong>{horaCorta(new Date(instante).toISOString())}</strong>
        {fix && ` · ${velocidad(fix.velocidadKmh)} · ${bateria(fix.bateriaPct)}`}
        {detalle && <span className="globo-linea">{detalle}</span>}
      </>
    );
  }

  return (
    <div className="replay-pista">
      {ampliada && <span className="pista-hora">{horaCorta(primera?.registradoEn)}</span>}
      <div
        className={`pista-riel${ampliada && bajo && bajo.marca.tipo !== 'hora' ? ' sobre-marca' : ''}`}
        onMouseMove={alMover}
        onMouseLeave={() => setBajo(null)}
        onMouseDown={(evento) => {
          inicioPulsacion.current = evento.clientX;
        }}
        onClick={alPulsar}
      >
        <div className="pista-marcas" aria-hidden="true">
          <span className="pista-base" />
          <span className="pista-progreso" />
          {huecos.map((h, i) => (
            <span
              key={`h${i}`}
              className="pista-hueco"
              style={{ left: `${pct(milisegundos(h.desde))}%`, width: `${pct(milisegundos(h.hasta)) - pct(milisegundos(h.desde))}%` }}
            />
          ))}
          {paradas.map((p, i) => {
            const desde = milisegundos(p.inicio);
            const hasta = milisegundos(p.fin);
            const enCurso = ahora != null && desde <= ahora && ahora <= hasta;
            return (
              <span
                key={`p${i}`}
                className={`pista-parada${paradaSeleccionada === i ? ' activa' : ''}${enCurso ? ' en-curso' : ''}`}
                style={{ left: `${pct(desde)}%`, width: `${pct(hasta) - pct(desde)}%` }}
              />
            );
          })}
          {microparadas.map((m, i) => (
            <span key={`m${i}`} className="pista-micro" style={{ left: `${pct(milisegundos(m.inicio))}%` }} />
          ))}
        </div>
        <input
          ref={sliderRef}
          type="range"
          className="replay-slider"
          min={0}
          max={total}
          defaultValue={0}
          disabled={posiciones.length < 2}
          aria-label="Posición del recorrido"
          onChange={(evento) => {
            pausar();
            mover(indicePorInstante(posiciones, inicio + Number(evento.target.value)));
          }}
        />
        {bajo && (
          <span
            className="pista-globo"
            style={{ left: `calc(${MARGEN_PISTA_PX}px + ${bajo.fraccion} * (100% - ${MARGEN_PISTA_PX * 2}px))` }}
            role="status"
          >
            {textoGlobo(bajo.marca, bajo.instante)}
          </span>
        )}
      </div>
      {ampliada && <span className="pista-hora">{horaCorta(ultima?.registradoEn)}</span>}
    </div>
  );
}

// Lectura del instante en curso. Ampliada suma el estado y la parada en la
// que cae, para leer el punto sin mirar el panel.
function LecturaPunto({ ampliada }: { ampliada: boolean }) {
  const { punto, estado, paradas, microparadas } = useReproductor();
  const instante = punto ? milisegundos(punto.registradoEn) : null;
  const enParada =
    ampliada && instante != null
      ? paradas.findIndex((p) => milisegundos(p.inicio) <= instante && instante <= milisegundos(p.fin))
      : -1;
  const enMicro =
    ampliada && instante != null && enParada < 0
      ? microparadas.find((m) => milisegundos(m.inicio) <= instante && instante <= milisegundos(m.fin)) ?? null
      : null;
  return (
    <span className="replay-tiempos">
      <strong>{punto ? horaCorta(punto.registradoEn) : GUION}</strong> · {velocidad(punto?.velocidadKmh)} ·{' '}
      {bateria(punto?.bateriaPct)}
      {ampliada && punto && <span className={`lectura-estado ${CLASE_ESTADO[estado]}`}>{ETIQUETA_ESTADO_PUNTO[estado]}</span>}
      {enParada >= 0 && (
        <span className="lectura-parada">
          Parada {enParada + 1} · {duracion(paradas[enParada].duracionMin * 60)}
        </span>
      )}
      {enMicro && <span className="lectura-parada">Microparada · {duracionCorta(enMicro.duracionS)}</span>}
    </span>
  );
}

// Franja inferior: gráfico con la lectura del punto actual, los controles y la
// línea de tiempo con las paradas. Compacta es un bloque angosto; ampliada
// pone la lectura arriba, el gráfico a todo lo ancho y los controles en una
// fila.
export function LineaTiempoReplay() {
  const [ampliada, setAmpliada] = useState(false);
  return (
    <div className={`replay-linea${ampliada ? ' ampliada' : ''}`}>
      <button
        type="button"
        className="suave icono-solo replay-ampliar"
        onClick={() => setAmpliada((v) => !v)}
        title={ampliada ? 'Reducir' : 'Ampliar'}
        aria-label={ampliada ? 'Reducir la franja' : 'Ampliar la franja'}
        aria-pressed={ampliada}
      >
        {ampliada ? <Minimize2 size={13} strokeWidth={2.2} /> : <Maximize2 size={13} strokeWidth={2.2} />}
      </button>
      <div className="replay-lectura">
        <GraficoBateria ampliada={ampliada} />
        <LecturaPunto ampliada={ampliada} />
      </div>
      <div className="replay-controles">
        <ControlesReplay />
        <PistaTiempo ampliada={ampliada} />
      </div>
    </div>
  );
}
