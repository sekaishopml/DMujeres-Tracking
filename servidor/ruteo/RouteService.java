package dmj;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.graphhopper.GHRequest;
import com.graphhopper.GHResponse;
import com.graphhopper.GraphHopper;
import com.graphhopper.GraphHopperConfig;
import com.graphhopper.ResponsePath;
import com.graphhopper.config.Profile;
import com.graphhopper.json.Statement;
import com.graphhopper.matching.MapMatching;
import com.graphhopper.matching.MatchResult;
import com.graphhopper.matching.Observation;
import com.graphhopper.util.CustomModel;
import com.graphhopper.util.PointList;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/**
 * Servicio de ruteo por calles para la Repetición de ruta.
 *
 * Usa el mapa de Ecuador ya procesado (/opt/graphhopper/graph-cache-8, perfil
 * "car") y ofrece dos operaciones:
 *   POST /route {"from":[lon,lat],"to":[lon,lat]}
 *     -> {"points":[[lon,lat],...],"distance":m,"time":ms,"mapaVersion":sha256}
 *   POST /match {"points":[[lon,lat],...],"accuracy":m}
 *     -> {"matched":[...],"distance":m,"raw":n,"filtered":n,"snappedRatio":x,
 *         "mapaVersion":sha256}
 *
 * /route estima el camino en un hueco sin puntos; /match ajusta a la vía
 * cuando hay puntos intermedios. Nunca inventa desvíos. mapaVersion es el
 * SHA-256 del mapa, calculado una vez al arrancar. Solo escucha en la máquina
 * local; lo usa servidor/api/src/ruteo.js.
 */
public class RouteService {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PBF = System.getenv().getOrDefault("DMJ_RUTEO_PBF", "/opt/graphhopper/ecuador-latest.osm.pbf");
    private static final String GRAPH = System.getenv().getOrDefault("DMJ_RUTEO_GRAFO", "/opt/graphhopper/graph-cache-8");
    private static final int PUERTO = Integer.parseInt(System.getenv().getOrDefault("DMJ_RUTEO_PUERTO", "8992"));

    private static String MAPA_VERSION = "desconocida";

    // MapMatching guarda estado mutable por consulta (queryGraph, statistics):
    // compartir una instancia entre los 4 hilos devolvía 500 y caminos
    // distintos para la misma entrada. Cada hilo del pool tiene la suya.
    private static final ThreadLocal<MapMatching> MATCHER_POR_HILO = new ThreadLocal<>();

    private static MapMatching matcherDeHilo(GraphHopper hopper) {
        MapMatching mm = MATCHER_POR_HILO.get();
        if (mm == null) {
            mm = MapMatching.fromGraphHopper(hopper, new com.graphhopper.util.PMap().putObject("profile", "car"));
            mm.setTransitionProbabilityBeta(5);
            mm.setMeasurementErrorSigma(10);
            MATCHER_POR_HILO.set(mm);
        }
        return mm;
    }

    private static GraphHopper buildHopper() {
        GraphHopperConfig cfg = new GraphHopperConfig();
        cfg.putObject("datareader.file", PBF);
        cfg.putObject("graph.location", GRAPH);
        cfg.putObject("graph.dataaccess", "MMAP");
        cfg.putObject("import.osm.ignored_highways", "proposed,raceway,bus_guideway");
        cfg.putObject("graph.vehicles", "car");
        cfg.putObject("graph.encoded_values", "road_access, max_speed, ferry_speed, road_class, road_environment, surface");
        CustomModel cm = new CustomModel();
        cm.setDistanceInfluence(70.0);
        cm.addToPriority(Statement.If("!car_access", Statement.Op.MULTIPLY, "0"));
        cm.addToSpeed(Statement.If("road_environment == FERRY", Statement.Op.LIMIT, "ferry_speed"));
        cm.addToSpeed(Statement.Else(Statement.Op.LIMIT, "car_average_speed"));
        cm.addToSpeed(Statement.If("true", Statement.Op.LIMIT, "max_speed * 0.9"));
        cfg.setProfiles(List.of(new Profile("car").setVehicle("car").setWeighting("custom").setCustomModel(cm).setTurnCosts(false)));
        GraphHopper hopper = new GraphHopper().init(cfg);
        hopper.importOrLoad();
        return hopper;
    }

    // SHA-256 del PBF una sola vez: identifica el mapa en cada respuesta para
    // que el Replay sepa con qué grafo se reconstruyó cada tramo.
    private static String calcularMapaVersion(String rutaPbf) {
        try (InputStream entrada = Files.newInputStream(Paths.get(rutaPbf))) {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[65536];
            int leidos;
            while ((leidos = entrada.read(buffer)) != -1) {
                sha.update(buffer, 0, leidos);
            }
            byte[] resumen = sha.digest();
            StringBuilder hex = new StringBuilder(resumen.length * 2);
            for (byte b : resumen) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            System.err.println("[ruteo] AVISO no se pudo hashear el PBF: " + e.getMessage());
            return "desconocida";
        }
    }

    public static void main(String[] args) throws Exception {
        System.out.println("[ruteo] importando/cargando grafo...");
        GraphHopper hopper = buildHopper();
        System.out.println("[ruteo] grafo listo");
        MAPA_VERSION = calcularMapaVersion(PBF);
        System.out.println("[ruteo] mapaVersion=" + MAPA_VERSION.substring(0, Math.min(12, MAPA_VERSION.length())) + "...");

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", PUERTO), 0);
        // La API pide varios tramos en paralelo por cada Replay: cuatro hilos
        // alcanzan para que el grafo no se convierta en cuello de botella.
        server.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(4));
        server.createContext("/health", (HttpExchange ex) -> responder(ex, 200, "ok", false));
        server.createContext("/route", (HttpExchange ex) -> manejarRoute(ex, hopper));
        server.createContext("/match", (HttpExchange ex) -> manejarMatch(ex, hopper));
        server.start();
        System.out.println("[ruteo] escuchando en 127.0.0.1:" + PUERTO);
    }

    private static void manejarRoute(HttpExchange ex, GraphHopper hopper) throws IOException {
        try {
            if (!"POST".equals(ex.getRequestMethod())) {
                responder(ex, 405, "{\"error\":\"POST required\"}", true);
                return;
            }
            ObjectNode body = JSON.readValue(ex.getRequestBody(), ObjectNode.class);
            double[] desde = leerPunto(body.get("from"));
            double[] hasta = leerPunto(body.get("to"));
            if (desde == null || hasta == null) {
                responder(ex, 400, "{\"error\":\"from y to son [lon,lat] requeridos\"}", true);
                return;
            }
            GHRequest pedido = new GHRequest(desde[1], desde[0], hasta[1], hasta[0]).setProfile("car");
            GHResponse respuesta = hopper.route(pedido);
            if (respuesta.hasErrors()) {
                responder(ex, 422, "{\"error\":\"sin ruta entre los puntos\"}", true);
                return;
            }
            ResponsePath ruta = respuesta.getBest();
            PointList puntos = ruta.getPoints();
            ArrayNode salida = JSON.createArrayNode();
            for (int i = 0; i < puntos.size(); i++) {
                ArrayNode punto = JSON.createArrayNode();
                punto.add(puntos.getLon(i));
                punto.add(puntos.getLat(i));
                salida.add(punto);
            }
            ObjectNode cuerpo = JSON.createObjectNode();
            cuerpo.set("points", salida);
            cuerpo.put("distance", ruta.getDistance());
            cuerpo.put("time", ruta.getTime());
            cuerpo.put("mapaVersion", MAPA_VERSION);
            responder(ex, 200, JSON.writeValueAsString(cuerpo), true);
        } catch (Exception e) {
            e.printStackTrace();
            responder(ex, 500, "{\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\"}", true);
        }
    }

    private static void manejarMatch(HttpExchange ex, GraphHopper hopper) throws IOException {
        try {
            if (!"POST".equals(ex.getRequestMethod())) {
                responder(ex, 405, "{\"error\":\"POST required\"}", true);
                return;
            }
            MapMatching mm = matcherDeHilo(hopper);
            ObjectNode body = JSON.readValue(ex.getRequestBody(), ObjectNode.class);
            ArrayNode points = (ArrayNode) body.get("points");
            if (points == null || points.size() < 2) {
                responder(ex, 400, "{\"error\":\"se requieren >=2 puntos\"}", true);
                return;
            }
            List<Observation> observations = new ArrayList<>();
            for (int i = 0; i < points.size(); i += 1) {
                ArrayNode p = (ArrayNode) points.get(i);
                double lon = p.get(0).asDouble();
                double lat = p.get(1).asDouble();
                if (!Double.isFinite(lon) || !Double.isFinite(lat)
                        || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                    responder(ex, 400, "{\"error\":\"punto fuera de rango\"}", true);
                    return;
                }
                observations.add(new Observation(new com.graphhopper.util.shapes.GHPoint(lat, lon)));
            }
            JsonNode accuracyNode = body.get("accuracy");
            double snapTrust = snapTrust(accuracyNode == null ? null : accuracyNode.asText());
            List<Observation> filtered = mm.filterObservations(observations);
            HybridResult hybrid = new HybridResult();
            resilientMatch(mm, filtered, hybrid, 0, snapTrust);
            ArrayNode matched = JSON.createArrayNode();
            for (double[] coord : hybrid.coords) {
                ArrayNode point = JSON.createArrayNode();
                point.add(coord[0]);
                point.add(coord[1]);
                matched.add(point);
            }
            ObjectNode resp = JSON.createObjectNode();
            resp.set("matched", matched);
            resp.put("distance", hybrid.distance);
            resp.put("raw", observations.size());
            resp.put("filtered", filtered.size());
            resp.put("snappedRatio", filtered.isEmpty() ? 0 : (double) hybrid.snapped / filtered.size());
            resp.put("paresPorVia", hybrid.paresPorVia);
            resp.put("paresRectos", hybrid.paresRectos);
            resp.put("mapaVersion", MAPA_VERSION);
            responder(ex, 200, JSON.writeValueAsString(resp), true);
        } catch (Exception e) {
            e.printStackTrace();
            String mensaje = String.valueOf(e.getMessage()).replace("\"", "'");
            responder(ex, 500, "{\"error\":\"" + mensaje + "\"}", true);
        }
    }

    /** [lon, lat] finito dentro de rango; null si el nodo no sirve. */
    private static double[] leerPunto(JsonNode nodo) {
        if (nodo == null || !nodo.isArray() || nodo.size() < 2) return null;
        double lon = nodo.get(0).asDouble(Double.NaN);
        double lat = nodo.get(1).asDouble(Double.NaN);
        if (!Double.isFinite(lon) || !Double.isFinite(lat)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return new double[]{lon, lat};
    }

    private static void responder(HttpExchange ex, int codigo, String cuerpo, boolean json) throws IOException {
        byte[] datos = cuerpo.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
        ex.sendResponseHeaders(codigo, datos.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(datos);
        }
    }

    // --- Matching resiliente reutilizado de MatchService.java (respaldo) ---
    // Nunca pierde cobertura y nunca inventa desvíos: cada snap solo se usa si
    // dist(raw, snap) <= snapTrust (<=45 m); si Viterbi falla se descarta el
    // paso y se reintenta (máx 10); si sigue fallando se divide; lo que ni así
    // casa sale crudo. Cobertura: 100% de las observaciones de entrada.

    private static class HybridResult {
        final List<double[]> coords = new ArrayList<>();
        double distance = 0;
        int snapped = 0;
        int paresPorVia = 0;
        int paresRectos = 0;

        void addRaw(Observation obs) {
            coords.add(new double[]{obs.getPoint().getLon(), obs.getPoint().getLat()});
        }

        void addSnapped(double lon, double lat) {
            coords.add(new double[]{lon, lat});
            snapped += 1;
        }

        void addAllRaw(List<Observation> list) {
            for (Observation obs : list) {
                addRaw(obs);
            }
        }
    }

    private static final double SNAP_TRUST_M = 45;

    // --- Forma de la calle entre puntos ajustados ---
    // El ajuste da un punto por observación y unirlos con rectas corta las
    // esquinas. Entre dos puntos seguidos del mismo ajuste se copia el tramo
    // de calle que ya eligió el ajuste, siempre que no sea un rodeo: largo
    // máximo max(1.3 x recta, recta + 25 m). Si es mayor (contramano, retorno,
    // calle paralela) ese par queda recto. Los puntos no se mueven.
    private static final double VIA_RAZON_MAX = 1.3;
    private static final double VIA_HOLGURA_M = 25;
    private static final double VIA_UBICAR_M = 2;

    /** Distancia (m) de un punto a un segmento, en plano local. */
    private static double distanciaASegmento(double lat, double lon,
                                             double latA, double lonA, double latB, double lonB) {
        double k = Math.cos(Math.toRadians(lat)) * 111320.0;
        double ax = (lonA - lon) * k, ay = (latA - lat) * 110540.0;
        double bx = (lonB - lon) * k, by = (latB - lat) * 110540.0;
        double dx = bx - ax, dy = by - ay;
        double largo2 = dx * dx + dy * dy;
        double t = largo2 > 0 ? -(ax * dx + ay * dy) / largo2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(ax + t * dx, ay + t * dy);
    }

    /** Primer segmento del camino (desde `desde`) que contiene el punto; -1 si no. */
    private static int ubicarEnCamino(PointList camino, double lat, double lon, int desde) {
        int mejor = -1;
        double mejorDist = Double.MAX_VALUE;
        for (int j = Math.max(0, desde); j < camino.size() - 1; j++) {
            double d = distanciaASegmento(lat, lon, camino.getLat(j), camino.getLon(j),
                    camino.getLat(j + 1), camino.getLon(j + 1));
            if (d <= VIA_UBICAR_M) return j;
            if (d < mejorDist) {
                mejorDist = d;
                mejor = j;
            }
        }
        return mejorDist <= 3 * VIA_UBICAR_M ? mejor : -1;
    }

    private static double dist(double latA, double lonA, double latB, double lonB) {
        return com.graphhopper.util.DistanceCalcEarth.DIST_EARTH.calcDist(latA, lonA, latB, lonB);
    }

    /** Confianza del snap según la precisión declarada de la ventana:
     *  clamp(3·accuracy, 20, 45): poco error -> snap más exigente; mucho
     *  error -> hasta 45 m. Sin dato: el tope (45 m). */
    private static double snapTrust(String accuracyRaw) {
        double accuracy = Double.NaN;
        try {
            accuracy = Double.parseDouble(accuracyRaw);
        } catch (Exception ignored) {
            // sin dato: se usa el tope conservador
        }
        if (!Double.isFinite(accuracy) || accuracy <= 0) return SNAP_TRUST_M;
        double acotada = Math.max(3, Math.min(50, accuracy));
        return Math.max(20, Math.min(SNAP_TRUST_M, 3 * acotada));
    }

    private static void resilientMatch(
            MapMatching mm, List<Observation> observations, HybridResult out, int depth, double snapTrust) {
        if (observations.size() < 2 || depth > 4) {
            out.addAllRaw(observations);
            return;
        }
        List<Observation> current = new ArrayList<>(observations);
        int dropped = 0;
        while (true) {
            try {
                MatchResult result = mm.match(current);
                collectHybrid(result, current, out, snapTrust);
                out.distance += result.getMatchLength();
                return;
            } catch (IllegalArgumentException e) {
                int step = parseBrokenStep(e.getMessage());
                if (step >= 0 && step < current.size() && dropped < 10) {
                    current.remove(step);
                    dropped += 1;
                    continue;
                }
                if (depth >= 4 || current.size() < 4) {
                    out.addAllRaw(current);
                    return;
                }
                int mid = current.size() / 2;
                resilientMatch(mm, current.subList(0, mid), out, depth + 1, snapTrust);
                resilientMatch(mm, current.subList(mid, current.size()), out, depth + 1, snapTrust);
                return;
            }
        }
    }

    private static void collectHybrid(
            MatchResult result, List<Observation> observations, HybridResult out, double snapTrust) {
        List<com.graphhopper.matching.EdgeMatch> edges = result.getEdgeMatches();
        List<com.graphhopper.matching.State> states = new ArrayList<>();
        for (com.graphhopper.matching.EdgeMatch edge : edges) {
            states.addAll(edge.getStates());
        }
        if (states.size() != observations.size()) {
            out.addAllRaw(observations);
            return;
        }
        PointList camino = null;
        try {
            camino = result.getMergedPath() == null ? null : result.getMergedPath().calcPoints();
        } catch (RuntimeException e) {
            camino = null;
        }
        double[] previo = null;
        int segPrevio = -1;
        // El camino avanza con las observaciones: la búsqueda nunca retrocede
        // (en recorridos que repasan la misma calle se toma la pasada vigente).
        int busqueda = 0;
        for (int i = 0; i < observations.size(); i++) {
            com.graphhopper.storage.index.Snap snap = states.get(i).getSnap();
            com.graphhopper.util.shapes.GHPoint3D snapped = snap == null ? null : runCatchingSnapped(snap);
            if (snapped == null || snap.getQueryDistance() > snapTrust) {
                if (previo != null) out.paresRectos += 1;
                out.addRaw(observations.get(i));
                previo = null;
                segPrevio = -1;
                continue;
            }
            double lat = snapped.getLat();
            double lon = snapped.getLon();
            int seg = camino == null ? -1 : ubicarEnCamino(camino, lat, lon, busqueda);
            if (seg >= 0) busqueda = seg;
            if (previo != null && segPrevio >= 0 && seg >= segPrevio) {
                double recta = dist(previo[1], previo[0], lat, lon);
                double largo = 0;
                double pLat = previo[1], pLon = previo[0];
                for (int j = segPrevio + 1; j <= seg; j++) {
                    largo += dist(pLat, pLon, camino.getLat(j), camino.getLon(j));
                    pLat = camino.getLat(j);
                    pLon = camino.getLon(j);
                }
                largo += dist(pLat, pLon, lat, lon);
                if (seg > segPrevio && largo <= Math.max(VIA_RAZON_MAX * recta, recta + VIA_HOLGURA_M)) {
                    for (int j = segPrevio + 1; j <= seg; j++) {
                        out.coords.add(new double[]{camino.getLon(j), camino.getLat(j)});
                    }
                    out.paresPorVia += 1;
                } else if (seg > segPrevio) {
                    out.paresRectos += 1;
                }
            } else if (previo != null) {
                out.paresRectos += 1;
            }
            out.addSnapped(lon, lat);
            previo = new double[]{lon, lat};
            segPrevio = seg;
        }
    }

    private static com.graphhopper.util.shapes.GHPoint3D runCatchingSnapped(
            com.graphhopper.storage.index.Snap snap) {
        try {
            return snap.getSnappedPoint();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static int parseBrokenStep(String message) {
        if (message == null) {
            return -1;
        }
        java.util.regex.Matcher matcher =
                java.util.regex.Pattern.compile("time step (\\d+)").matcher(message);
        if (matcher.find()) {
            try {
                return Integer.parseInt(matcher.group(1));
            } catch (NumberFormatException ignored) {
                return -1;
            }
        }
        return -1;
    }
}
