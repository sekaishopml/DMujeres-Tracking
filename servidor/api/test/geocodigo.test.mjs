// Lógica pura del geocodificador (sin red): composición, validación de
// distancia y clave de caché. Ejecutar: node24 --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claveDeCache, distanciaAlResultado, nivelDePrecision, resolverDatos } from '../src/geocodigo.js';

const calle = {
  category: 'highway',
  name: '10° Pasaje 33 NO',
  lat: '-2.0921', lon: '-79.9209',
  boundingbox: ['-2.0925', '-2.0918', '-79.9212', '-79.9206'],
  address: { road: '10° Pasaje 33 NO', house_number: '12', residential: 'Mucho lote I - Etapa 5', suburb: 'Mucho Lote I', city: 'Guayaquil', state: 'Guayas', country: 'Ecuador' },
};

test('precisión buena: calle, número, barrio y ciudad sin estado ni país', () => {
  const r = resolverDatos(calle, -2.0922, -79.9209, 10);
  assert.equal(r.direccion, '10° Pasaje 33 NO 12, Mucho Lote I, Guayaquil');
  assert.equal(r.aproximada, false);
});

test('precisión mala: "Cerca de" barrio y ciudad, sin calle ni número', () => {
  const r = resolverDatos(calle, -2.0922, -79.9209, 150);
  assert.equal(r.aproximada, true);
  assert.equal(r.direccion, 'Cerca de Mucho Lote I, Guayaquil');
});

test('calle sin nombre: el suburb no se presenta como calle y la dirección es aproximada', () => {
  const r = resolverDatos(
    { category: 'highway', name: '', boundingbox: ['-2.1', '-2.0', '-79.93', '-79.92'], address: { suburb: 'Terminal Portuario Guayaquil - TPG', city: 'Guayaquil' } },
    -2.05, -79.925, 12,
  );
  assert.equal(r.direccion, 'Cerca de Terminal Portuario Guayaquil - TPG, Guayaquil');
});

test('barrio repetido ("Barrio Cuba" / "Cuba") se muestra una sola vez', () => {
  const r = resolverDatos({ category: 'highway', address: { road: 'Calle 44 SE', quarter: 'Barrio Cuba', suburb: 'Cuba', city: 'Guayaquil' } }, NaN, NaN, null);
  assert.equal(r.direccion, 'Calle 44 SE, Barrio Cuba, Guayaquil');
});

test('nombre de lugar solo con fix bueno y a pocos metros', () => {
  const farmacia = { category: 'amenity', name: 'Farmacia Sana Sana', lat: '-2.2000', lon: '-79.9000', address: { road: 'Av. 9 de Octubre', suburb: 'Centro', city: 'Guayaquil' } };
  assert.match(resolverDatos(farmacia, -2.20001, -79.90001, 8).direccion, /^Farmacia Sana Sana, Av\. 9 de Octubre/);
  assert.doesNotMatch(resolverDatos(farmacia, -2.20001, -79.90001, 60).direccion, /Farmacia/);
  assert.doesNotMatch(resolverDatos(farmacia, -2.2005, -79.9000, 8).direccion, /Farmacia/); // ~55 m
});

test('resultado lejano (más de 60 m + precisión): se descarta la calle', () => {
  const r = resolverDatos(calle, -2.0990, -79.9209, 10);
  assert.equal(r.aproximada, true);
  assert.doesNotMatch(r.direccion, /Pasaje/);
});

test('distancia a la caja: 0 dentro, positiva fuera', () => {
  assert.equal(distanciaAlResultado(-2.0921, -79.9209, calle), 0);
  const fuera = distanciaAlResultado(-2.0935, -79.9209, calle);
  assert.ok(fuera > 100 && fuera < 130);
});

test('clave de caché: 4 decimales y nivel de precisión', () => {
  assert.equal(claveDeCache(-2.09214, -79.92094, 10), claveDeCache(-2.09211, -79.92091, 5));
  assert.notEqual(claveDeCache(-2.0921, -79.9209, 10), claveDeCache(-2.0921, -79.9209, 200));
  assert.equal(nivelDePrecision(null), 'n');
});
