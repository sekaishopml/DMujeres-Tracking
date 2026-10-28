import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  puntoEnPoligono, geocercaDeParada, ordenarLlegadas, ordenarSalidas, resumenVisitas,
  validarFormulario, errorDePuntos, esMismoPunto,
} from '../src/componentes/geocercas/logica.ts';

const cuadro = [[-79.9, -2.2], [-79.89, -2.2], [-79.89, -2.19], [-79.9, -2.19]];
const g = (id, puntos, centro, activo = true) => ({ id, nombre: `G${id}`, tipo: 'casa', puntos, centro, activo });

test('punto dentro y fuera del polígono', () => {
  assert.equal(puntoEnPoligono(-79.895, -2.195, cuadro), true);
  assert.equal(puntoEnPoligono(-79.88, -2.195, cuadro), false);
});

test('la parada toma la geocerca activa más cercana al centro', () => {
  const a = g(1, cuadro, { lon: -79.895, lat: -2.195 });
  const b = g(2, cuadro, { lon: -79.8995, lat: -2.1995 });
  const baja = g(3, cuadro, { lon: -79.8951, lat: -2.1951 }, false);
  const parada = { latitud: -2.1951, longitud: -79.8951 };
  assert.equal(geocercaDeParada(parada, [b, a, baja]).id, 1);
  assert.equal(geocercaDeParada({ latitud: 0, longitud: 0 }, [a]), null);
});

test('llegadas con la última primero, salidas con la primera primero', () => {
  const t = ['2026-10-08T15:00:00Z', '2026-10-08T19:00:00Z', '2026-10-08T12:00:00Z'];
  assert.deepEqual(ordenarLlegadas(t), [t[1], t[0], t[2]]);
  assert.deepEqual(ordenarSalidas(t), [t[2], t[0], t[1]]);
  const r = resumenVisitas({ llegadas: t, salidas: t });
  assert.equal(r.llego, t[1]);
  assert.equal(r.salio, t[2]);
  assert.equal(resumenVisitas({ llegadas: [], salidas: [] }).llego, null);
});

test('formulario: nombre y quién obligatorios, tipo válido', () => {
  assert.deepEqual(validarFormulario({ nombre: 'Casa Ana', quien: 'Luis', tipo: 'casa' }), {});
  const e = validarFormulario({ nombre: '  ', quien: '', tipo: 'x' });
  assert.ok(e.nombre && e.quien && e.tipo);
});

test('polígono: mínimo 3 puntos y con área', () => {
  assert.ok(errorDePuntos(cuadro.slice(0, 2)));
  assert.ok(errorDePuntos([[0, 0], [1, 1], [2, 2]]));
  assert.equal(errorDePuntos(cuadro), null);
});

test('clic repetido sobre el mismo punto', () => {
  assert.equal(esMismoPunto({ x: 10, y: 10 }, { x: 12, y: 11 }, 4), true);
  assert.equal(esMismoPunto({ x: 10, y: 10 }, { x: 30, y: 11 }, 4), false);
});

test('domicilio: primera salida, última llegada y las veces que volvió', async () => {
  const { resumenDomicilio } = await import('../src/componentes/geocercas/logica.ts');
  const t = (h) => `2026-10-10T${h}:00.000Z`;
  const visitas = [
    { llegada: t('12:30'), salida: t('12:40'), duracionMin: 10 },
    { llegada: t('17:31'), salida: t('18:20'), duracionMin: 49 },
    { llegada: t('22:56'), salida: null, duracionMin: null },
  ];
  const r = resumenDomicilio({ llegadas: [t('22:56'), t('17:31'), t('12:30')], salidas: [t('12:40'), t('18:20')], visitas });
  assert.equal(r.salio, t('12:40'));
  assert.equal(r.llego, t('22:56'));
  assert.deepEqual(r.regresos.map((x) => x.llegada), [t('17:31'), t('22:56')]);
  // Salió y no volvió: no hay llegada que mostrar.
  const solo = resumenDomicilio({ llegadas: [t('12:30')], salidas: [t('12:40')], visitas: visitas.slice(0, 1) });
  assert.equal(solo.llego, null);
  assert.equal(solo.regresos.length, 0);
});

test('el GPS que salta a la calle dentro de una parada en casa no cuenta como salida', async () => {
  const { visitasSegunParadas } = await import('../src/componentes/geocercas/logica.ts');
  const casa = { id: 7, activo: true, puntos: [[-79.9, -2.2], [-79.899, -2.2], [-79.899, -2.199], [-79.9, -2.199]], centro: { lon: -79.8995, lat: -2.1995 } };
  const v = {
    geocercaId: 7, nombre: 'CASA', tipo: 'casa',
    llegadas: ['2026-10-15T10:03:00Z'], salidas: ['2026-10-15T09:57:00Z'],
    visitas: [
      { llegada: null, salida: '2026-10-15T09:57:00Z', duracionMin: null },
      { llegada: '2026-10-15T10:03:00Z', salida: null, duracionMin: null },
    ],
  };
  const parada = { inicio: '2026-10-15T05:01:00Z', fin: '2026-10-15T22:06:00Z', latitud: -2.1995, longitud: -79.8995 };
  const unida = visitasSegunParadas(v, [parada], [casa]);
  assert.deepEqual(unida.visitas, [{ llegada: null, salida: null, duracionMin: null }]);
  assert.deepEqual(unida.salidas, []);
  // Si la parada se cortó (salió de verdad), quedan las dos.
  assert.equal(visitasSegunParadas(v, [{ ...parada, fin: '2026-10-15T09:58:00Z' }], [casa]).visitas.length, 2);
});

test('parada con el centro en la calle pero puntos dentro del local queda en la geocerca', async () => {
  const { ubicarEnGeocerca } = await import('../src/componentes/geocercas/logica.ts');
  const mall = { id: 3, activo: true, puntos: [[-79.9, -2.2], [-79.899, -2.2], [-79.899, -2.199], [-79.9, -2.199]], centro: { lon: -79.8995, lat: -2.1995 } };
  const t = (i) => new Date(Date.UTC(2026, 9, 15, 15, i)).toISOString();
  // 3 puntos adentro y 7 en la calle, a 30 m del borde.
  const posiciones = [
    ...[0, 1, 2].map((i) => ({ registradoEn: t(i), latitud: -2.1995, longitud: -79.8995 })),
    ...[3, 4, 5, 6, 7, 8, 9].map((i) => ({ registradoEn: t(i), latitud: -2.1995, longitud: -79.9003 })),
  ];
  const parada = { inicio: t(0), fin: t(9), latitud: -2.1995, longitud: -79.90015 };
  const r = ubicarEnGeocerca(parada, posiciones, [mall]);
  assert.equal(r?.geocerca.id, 3);
  assert.equal(r.parada.longitud, -79.8995);
  // Con un solo punto adentro (un salto del GPS) no cuenta.
  assert.equal(ubicarEnGeocerca(parada, posiciones.slice(2), [mall]), null);
});

test('la llegada a la geocerca es la de la parada si se detuvo antes de que el GPS entrara', async () => {
  const { visitasSegunParadas, geocercasSoloPorParadas } = await import('../src/componentes/geocercas/logica.ts');
  const mall = { id: 3, nombre: 'MALL', tipo: 'cc', activo: true, puntos: [[-79.9, -2.2], [-79.899, -2.2], [-79.899, -2.199], [-79.9, -2.199]], centro: { lon: -79.8995, lat: -2.1995 } };
  const parada = { inicio: '2026-10-15T14:37:00Z', fin: '2026-10-15T15:14:00Z', latitud: -2.1995, longitud: -79.8995 };
  const v = {
    geocercaId: 3, nombre: 'MALL', tipo: 'cc', llegadas: ['2026-10-15T14:50:00Z'], salidas: ['2026-10-15T15:16:00Z'],
    visitas: [{ llegada: '2026-10-15T14:50:00Z', salida: '2026-10-15T15:16:00Z', duracionMin: 26 }],
  };
  const r = visitasSegunParadas(v, [parada], [mall]);
  assert.deepEqual(r.visitas, [{ llegada: '2026-10-15T14:37:00Z', salida: '2026-10-15T15:16:00Z', duracionMin: 39 }]);
  assert.equal(v.visitas[0].llegada, '2026-10-15T14:50:00Z');
  // Sin visita del servidor, la parada es la visita.
  const solo = geocercasSoloPorParadas([], [parada], [mall]);
  assert.deepEqual(solo[0].visitas, [{ llegada: parada.inicio, salida: parada.fin, duracionMin: 37 }]);
  assert.equal(geocercasSoloPorParadas([v], [parada], [mall]).length, 0);
});

// Miriam 23/10, Quicentro Norte: la parada empezaba 5 h antes de la primera
// lectura cerca del centro comercial.
test('Llegó y Salió de la geocerca necesitan lecturas cerca de ella', async () => {
  const { geocercasSoloPorParadas } = await import('../src/componentes/geocercas/logica.ts');
  const mall = { id: 3, nombre: 'MALL', tipo: 'cc', activo: true, puntos: [[-79.9, -2.2], [-79.899, -2.2], [-79.899, -2.199], [-79.9, -2.199]], centro: { lon: -79.8995, lat: -2.1995 } };
  const parada = { inicio: '2026-10-23T18:57:00Z', fin: '2026-10-24T02:10:00Z', latitud: -2.1995, longitud: -79.8995 };
  const lectura = (hora, lon, lat) => ({ registradoEn: hora, latitud: lat, longitud: lon, precisionM: 8 });
  const lecturas = [
    lectura('2026-10-23T19:00:00Z', -79.905, -2.1995), // 550 m al oeste: no cuenta
    lectura('2026-10-24T00:02:00Z', -79.9003, -2.1995), // 30 m del borde: cuenta
    lectura('2026-10-24T01:30:00Z', -79.8995, -2.1995),
    lectura('2026-10-24T02:05:00Z', -79.896, -2.1995), // 330 m al este: no cuenta
  ];
  const [v] = geocercasSoloPorParadas([], [parada], [mall], lecturas);
  assert.deepEqual(v.visitas, [{ llegada: '2026-10-24T00:02:00Z', salida: '2026-10-24T01:30:00Z', duracionMin: 88 }]);
  // Sin lecturas se queda con la parada, como antes.
  assert.equal(geocercasSoloPorParadas([], [parada], [mall])[0].visitas[0].llegada, parada.inicio);
});
