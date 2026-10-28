# Ruteo

Ajusta a las calles los tramos del recorrido que tienen puntos reales
(`/match`), para que el temblor del GPS no se dibuje punto a punto. Los
huecos sin puntos no se rellenan: quedan como corte, porque el recorrido se
audita y un camino que nadie vio no se dibuja. `/route` sigue disponible pero
la API no lo usa.

Usa GraphHopper con el mapa de Ecuador ya importado en
`/opt/graphhopper/graph-cache-8`, y el jar en `/opt/route-service`. Esos
archivos no están en el repositorio. Escucha solo en `127.0.0.1:8992` y lo
consulta la API (`servidor/api/src/recorrido/ruteo.js`).

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

- `/match` sobre ventanas de puntos reales (hasta 100 puntos o 5 min cada
  una). El ajuste se descarta si se aparta de los puntos.
- 3 s como máximo por recorrido; lo que no entra se dibuja con los puntos
  tal como llegaron.
- Los resultados se guardan en memoria 7 días.
