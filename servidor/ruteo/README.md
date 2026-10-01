# Ruteo

Cuando el teléfono pasa un rato sin mandar puntos (sin señal, por ejemplo),
en el recorrido queda un salto en línea recta. Este servicio calcula por qué
calles es más probable que haya ido, y el panel dibuja ese tramo como
estimado, nunca como GPS registrado.

Usa GraphHopper con el mapa de Ecuador ya importado en
`/opt/graphhopper/graph-cache-8`, y el jar en `/opt/route-service`. Esos
archivos no están en el repositorio. Escucha solo en `127.0.0.1:8992` y lo
consulta la API (`servidor/api/src/ruteo.js`).

## Compilar y arrancar

```bash
bash servidor/ruteo/build.sh
sudo systemctl restart dmj-routing
curl http://127.0.0.1:8992/health
```

## Uso

```
POST /route {"from":[lon,lat],"to":[lon,lat]}
  200 {"points":[[lon,lat],...],"distance":metros,"time":ms}
  400 datos inválidos, 422 sin ruta, 500 error
```

## Cuándo se usa

- Solo para tramos con 45 s o más y 150 m o más entre un punto y el
  siguiente. Por debajo de eso la persona estaba quieta y el ruteo daría
  vueltas que no existen.
- Hasta 4 h por tramo y 200 tramos por recorrido, con 3 s como máximo en
  total. Lo que no entra se dibuja como siempre.
- Los resultados se guardan en memoria 7 días.
