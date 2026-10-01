# Panel

Panel web de DMujeres Tracking. Sirve para auditar la jornada de cada
persona: a qué hora la empezó, por dónde anduvo, dónde se detuvo, cuándo se
quedó sin batería y cuándo la cerró.

Está hecho con React 19, Vite, TypeScript, Tailwind CSS 4, TanStack Query,
React Router, MapLibre y Chart.js.

## Compilar

```bash
npm ci
npx tsc -b --noEmit
npx vite build
```

El resultado queda en `dist/` y lo sirve el servicio `dmj-panel`. En cada
entrega se sube la versión en `package.json`.

## Cómo está organizado

- `src/paginas`: una página por pantalla del menú.
- `src/componentes/marco`: el menú lateral y la barra de arriba. El título de
  cada página sale de `navegacion.ts`; para poner filtros o botones en la
  barra se usa `<AccionesPagina>`.
- `src/componentes/ui`: botones, tarjetas, tablas, campos, diálogos y demás
  piezas comunes.
- `src/componentes/mapa`: el mapa base (satélite, híbrido, OSM).
- `src/dominio`: la lógica que no es de pantalla: consultas a la API, estados,
  formatos de fecha y distancia, recorrido y bitácora de la jornada.
- `src/estilos/index.css`: colores y medidas.
- `@contratos` apunta a los tipos compartidos de `compartido/tipos`.

## Estilo

- Claro y ordenado: fondo gris claro, tarjetas blancas con borde suave,
  textos en azul marino. Títulos y cifras en Poppins.
- El magenta de DMujeres solo para la acción principal, lo seleccionado y lo
  activo.
- Un color por estado, igual en chips, mapa y gráficos: en movimiento
  (verde), detenido (azul), sin señal (ámbar), deshabilitado (gris) y
  problema (rojo).
- Las personas se muestran con sus iniciales, nunca con foto.
- Si falta un dato se muestra "—"; nunca se inventa.
- Tiene que poder usarse en un teléfono de 360 px de ancho.
