-- 004: la app manda la velocidad en nudos y el receptor la guardaba como si
-- fuera km/h (quedaba a la mitad). Corrige lo ya guardado una sola vez; una
-- marca en atributos impide aplicarla dos veces.
UPDATE tracking.dmt_posicion
SET velocidad_kmh = velocidad_kmh * 1.852,
    atributos = atributos || '{"velocidadCorregida": "nudos_a_kmh"}'::jsonb,
    actualizado_en = now()
WHERE protocolo = 'lote'
  AND velocidad_kmh IS NOT NULL
  AND NOT (atributos ? 'velocidadCorregida');
