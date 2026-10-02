# DMujeres Tracking

Sistema para seguir la jornada de trabajo del personal de campo de DMujeres.
Cada persona lleva en su teléfono una app que registra por dónde anduvo, sus
actividades del día y el estado del teléfono. Quien tiene iPhone usa Traccar
Client, y el servidor se encarga de su jornada. Desde el panel web se ve en
vivo dónde está cada una, se repasa el recorrido de cualquier jornada y se
sacan reportes.

## Qué hay en este repositorio

- `app/`: la app Android que usan las personas en la calle.
- `panel/`: el panel web (React) que usa la oficina.
- `servidor/api`: la API que consume el panel.
- `servidor/tracking`: recibe los puntos y avisos que mandan los teléfonos.
- `servidor/recuperacion`: si un teléfono deja de reportar en plena jornada,
  le manda una notificación para despertarlo.
- `servidor/ruteo`: dibuja por las calles los tramos en que el teléfono no
  mandó puntos.
- `servidor/web`: sirve el panel ya compilado.
- `base-de-datos/`: el esquema de PostgreSQL y sus migraciones.
- `compartido/`: los tipos y el contrato de la API que usan el panel y el
  servidor.
- `infraestructura/`: servicios de systemd, nginx y la base en Docker.
- `scripts/`: publicar la app, respaldar la base y revisar que todo funcione.
- `docs/`: la documentación.

## Cómo está montado hoy

Todo corre en un solo servidor Ubuntu:

- Panel: http://68.168.20.219:8999 (también por el puerto 80).
- Los teléfonos Android hablan con el puerto 999 (nginx), que pasa sus datos
  al servicio de tracking (puerto 5055) y les entrega las actualizaciones. Los
  iPhone mandan sus puntos directo al 5055.
- La API escucha en el 8081 y el ruteo en el 8992, los dos solo por dentro.
- La base es PostgreSQL 18 con TimescaleDB, en Docker, en 127.0.0.1:5443.

## Por dónde empezar

- [Cómo funciona](docs/como-funciona.md): el recorrido de un punto desde el
  teléfono hasta el panel.
- [Instalar el servidor](docs/instalar-servidor.md): montar todo desde cero.
- [El día a día](docs/dia-a-dia.md): publicar una versión de la app, revisar
  el servidor, respaldos y qué hacer si algo falla.
- [La app Android](docs/app-android.md): cómo se compila y cómo se actualiza
  en los teléfonos.
- [Curso de SQL](docs/curso-sql-consola.md): cómo consultar la base desde la
  consola de Sistema, desde cero.
- [Próximos cambios](docs/proximos-cambios.md): lo que está pendiente.

## Requisitos

Node 24, Docker, nginx y Java 17 en el servidor. Para compilar la app hace
falta el SDK de Android y las llaves de firma, que no están en el repositorio
(ver [La app Android](docs/app-android.md)).

## Licencia

Parte del código de la app viene de un cliente de código abierto con licencia
Apache 2.0. Por eso se conservan `app/LICENSE.txt` y los avisos de copyright en
esos archivos.
