/*
 * Copyright 2015 - 2022 Anton Tananaev (anton@traccar.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
@file:Suppress("DEPRECATION", "StaticFieldLeak")
package com.dmujeres.app.datos

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.database.DatabaseUtils
import android.database.SQLException
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.AsyncTask
import android.util.Log
import androidx.preference.PreferenceManager
import com.dmujeres.app.pantallas.StatusActivity
import com.dmujeres.app.seguimiento.Position
import com.dmujeres.app.seguimiento.STATUS_DEAD
import com.dmujeres.app.seguimiento.STATUS_PENDING
import java.sql.Date

private const val MAX_BUFFERED_POSITIONS = 5000L

private const val TAG = "DatabaseHelper"

class DatabaseHelper(private val appContext: Context?) :
    SQLiteOpenHelper(appContext, DATABASE_NAME, null, DATABASE_VERSION) {

    interface DatabaseHandler<T> {
        fun onComplete(success: Boolean, result: T)
    }

    private abstract class DatabaseAsyncTask<T>(val handler: DatabaseHandler<T?>) : AsyncTask<Unit, Unit, T?>() {

        private var error: RuntimeException? = null

        override fun doInBackground(vararg params: Unit): T? {
            return try {
                executeMethod()
            } catch (error: RuntimeException) {
                this.error = error
                null
            }
        }

        protected abstract fun executeMethod(): T

        override fun onPostExecute(result: T?) {
            handler.onComplete(error == null, result)
        }
    }

    private val db: SQLiteDatabase = writableDatabase

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(CREATE_POSITION)
        db.execSQL(CREATE_META)
    }

    /**
     * La migración revisa qué existe de verdad (con PRAGMA) en vez de confiar
     * en el número de versión: hubo versiones con el mismo número y distinto
     * esquema, y el cambio nunca corría. Así funciona venga de donde venga.
     * Nunca se borra nada: la cola de puntos sin enviar no se pierde al
     * actualizar. La v7 agrega `device_id` (equipo de captura por fila); las
     * filas viejas quedan en NULL.
     */
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        ensureEsquemaV7(db)
    }

    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Volver a una versión anterior tampoco borra: el esquema nuevo incluye
        // al viejo y el código viejo ignora las columnas que no conoce.
        ensureEsquemaV7(db)
    }

    /** Nombres de columna reales de una tabla (vacío si no existe). */
    private fun columnasDe(db: SQLiteDatabase, tabla: String): Set<String> {
        val columnas = mutableSetOf<String>()
        runCatching {
            db.rawQuery("PRAGMA table_info($tabla)", null).use { cursor ->
                val indice = cursor.getColumnIndex("name")
                while (cursor.moveToNext()) {
                    cursor.getString(indice)?.let { columnas.add(it) }
                }
            }
        }.onFailure { Log.e(TAG, "no se pudo leer esquema de $tabla", it) }
        return columnas
    }

    /**
     * Deja el esquema v6 completo, sea cual sea el punto de partida: agrega
     * las columnas que falten y crea `meta`. Corre al actualizar y en cada
     * apertura; si ya está al día no hace nada.
     */
    private fun ensureEsquemaV6(db: SQLiteDatabase) {
        val columnas = columnasDe(db, "position").toMutableSet()
        if (columnas.isNotEmpty()) {
            for (columna in POSITION_V5_COLUMNS) {
                val nombre = columna.substringBefore(' ')
                if (!columnas.contains(nombre)) {
                    runCatching { db.execSQL("ALTER TABLE position ADD COLUMN $columna") }
                        .onFailure { Log.e(TAG, "no se pudo agregar $nombre", it) }
                        .onSuccess { columnas.add(nombre) }
                }
            }
        }
        runCatching { db.execSQL(CREATE_META) }
            .onFailure { Log.e(TAG, "no se pudo crear meta", it) }
    }

    /**
     * Esquema v7: el v6 más `device_id`, el equipo con que se capturó cada
     * punto. Solo agrega; las filas anteriores quedan sin `device_id` y se
     * suben con el identificador actual.
     */
    private fun ensureEsquemaV7(db: SQLiteDatabase) {
        ensureEsquemaV6(db)
        val columnas = columnasDe(db, "position")
        if (columnas.isEmpty() || columnas.contains("device_id")) return
        runCatching { db.execSQL("ALTER TABLE position ADD COLUMN device_id TEXT") }
            .onFailure { Log.e(TAG, "no se pudo agregar device_id", it) }
    }

    init {
        // Cada apertura deja el esquema usable sin borrar nada, aunque la
        // actualización no haya corrido entera.
        runCatching { ensureEsquemaV7(db) }
            .onFailure { Log.e(TAG, "esquema no asegurado al abrir", it) }
    }

    fun insertPosition(position: Position) {
        // La identidad (boot_id, secuencia) la pone la base, no quien captura,
        // para que sea única en cada punto.
        val identified = withIdentity(position)
        val values = ContentValues()
        values.put("deviceId", identified.deviceId)
        values.put("time", identified.time.time)
        values.put("latitude", identified.latitude)
        values.put("longitude", identified.longitude)
        values.put("altitude", identified.altitude)
        values.put("speed", identified.speed)
        values.put("course", identified.course)
        values.put("accuracy", identified.accuracy)
        values.put("battery", identified.battery)
        values.put("charging", if (identified.charging) 1 else 0)
        values.put("mock", if (identified.mock) 1 else 0)
        values.put("boot_id", identified.bootId)
        values.put("local_sequence", identified.localSequence)
        values.put("journey_id", identified.journeyId)
        values.put("provider", identified.provider)
        values.put("movement_state", identified.movementState)
        values.put("status", identified.status)
        values.put("attempts", identified.attempts)
        // El equipo se fija al guardar (no al subir), así la subida es correcta
        // aunque después se cambie de cuenta. Si ya viene puesto, se respeta.
        values.put("device_id", identified.captureDeviceId.ifBlank { currentDeviceId() })
        db.insertOrThrow("position", null, values)
        enforceBufferLimit(db)
    }

    /**
     * Equipo actual al guardar (`Prefs.DEVICE`). Se guarda en cada fila.
     */
    private fun currentDeviceId(): String =
        appContext?.let {
            PreferenceManager.getDefaultSharedPreferences(it)
                .getString(Prefs.DEVICE, "").orEmpty().trim().lowercase()
        }.orEmpty()

    /**
     * Tope de la cola sin conexión: si se pasa de [MAX_BUFFERED_POSITIONS] se
     * descartan los más viejos para no crecer sin límite. 5.000 puntos son
     * unas 3 jornadas de 10 h (1 por minuto quieta, 4 por minuto en marcha) y
     * cerca de 1,2 MB.
     *
     * Lo descartado se cuenta en `meta(buffer_overflow)` y se reporta en el
     * diagnóstico, para que el panel pueda explicar el hueco.
     */
    private fun enforceBufferLimit(db: SQLiteDatabase) {
        runCatching {
            val count = DatabaseUtils.queryNumEntries(db, "position")
            if (count <= MAX_BUFFERED_POSITIONS) return
            val excess = count - MAX_BUFFERED_POSITIONS
            db.execSQL(
                "DELETE FROM position WHERE id IN (SELECT id FROM position ORDER BY id ASC LIMIT ?)",
                arrayOf(excess),
            )
            Log.w(TAG, "búfer al tope: descartados $excess puntos más viejos")
            StatusActivity.addMessage("Búfer lleno: se descartaron $excess puntos más viejos")
            addMetaCounter(db, KEY_BUFFER_OVERFLOW, excess)
        }.onFailure { Log.w(TAG, "no se pudo aplicar el tope del búfer", it) }
    }

    fun insertPositionAsync(position: Position, handler: DatabaseHandler<Unit?>) {
        object : DatabaseAsyncTask<Unit>(handler) {
            override fun executeMethod() {
                insertPosition(position)
            }
        }.execute()
    }

    @SuppressLint("Range")
    /** Número de ubicaciones en el buffer (cuadro "Pendientes por enviar"). */
    fun countPositions(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM position", null).use { cursor ->
            if (cursor.moveToFirst()) return cursor.getInt(0)
        }
        return 0
    }

    /** Ubicaciones que aún se pueden enviar (las descartadas por el servidor no cuentan). */
    fun countPorEnviar(): Int {
        readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM position WHERE COALESCE(status, '') <> ?",
            arrayOf(STATUS_DEAD),
        ).use { cursor ->
            if (cursor.moveToFirst()) return cursor.getInt(0)
        }
        return 0
    }

    fun selectPosition(): Position? {
        // Siempre el más viejo primero.
        return selectPositions(1).firstOrNull()
    }

    @SuppressLint("Range")
    /** Lote ordenado por inserción para la subida en serie (hasta [limit]). */
    fun selectPositions(limit: Int): List<Position> {
        val out = ArrayList<Position>()
        db.rawQuery("SELECT * FROM position ORDER BY id LIMIT ?", arrayOf(limit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                out.add(positionFromCursor(cursor))
            }
        }
        return out
    }

    @SuppressLint("Range")
    /**
     * Últimos fixes para reconstruir la máquina de estados tras recrear el
     * proceso (el estado nunca se asume de la RAM).
     */
    fun selectRecentPositions(limit: Int): List<Position> {
        val out = ArrayList<Position>()
        db.rawQuery("SELECT * FROM position ORDER BY id DESC LIMIT ?", arrayOf(limit.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                out.add(positionFromCursor(cursor))
            }
        }
        return out
    }

    @SuppressLint("Range")
    private fun positionFromCursor(cursor: android.database.Cursor): Position {
        // getColumnIndex devuelve -1 en bases viejas sin migrar: se lee con
        // valor por defecto en vez de romper la lectura.
        fun text(name: String): String {
            val i = cursor.getColumnIndex(name)
            return if (i >= 0 && !cursor.isNull(i)) cursor.getString(i) else ""
        }
        fun long(name: String): Long {
            val i = cursor.getColumnIndex(name)
            return if (i >= 0 && !cursor.isNull(i)) cursor.getLong(i) else 0L
        }
        fun int(name: String): Int {
            val i = cursor.getColumnIndex(name)
            return if (i >= 0 && !cursor.isNull(i)) cursor.getInt(i) else 0
        }
        return Position(
            id = cursor.getLong(cursor.getColumnIndex("id")),
            deviceId = cursor.getString(cursor.getColumnIndex("deviceId")),
            time = Date(cursor.getLong(cursor.getColumnIndex("time"))),
            latitude = cursor.getDouble(cursor.getColumnIndex("latitude")),
            longitude = cursor.getDouble(cursor.getColumnIndex("longitude")),
            altitude = cursor.getDouble(cursor.getColumnIndex("altitude")),
            speed = cursor.getDouble(cursor.getColumnIndex("speed")),
            course = cursor.getDouble(cursor.getColumnIndex("course")),
            accuracy = cursor.getDouble(cursor.getColumnIndex("accuracy")),
            battery = cursor.getDouble(cursor.getColumnIndex("battery")),
            charging = cursor.getInt(cursor.getColumnIndex("charging")) > 0,
            mock = cursor.getInt(cursor.getColumnIndex("mock")) > 0,
            bootId = text("boot_id"),
            localSequence = long("local_sequence"),
            journeyId = text("journey_id"),
            provider = text("provider"),
            movementState = text("movement_state"),
            status = text("status").ifBlank { STATUS_PENDING },
            attempts = int("attempts"),
            captureDeviceId = text("device_id"),
        )
    }

    fun deletePosition(id: Long) {
        if (db.delete("position", "id = ?", arrayOf(id.toString())) != 1) {
            throw SQLException()
        }
    }

    /** Borrado de un lote ya confirmado (idempotente: ignora los que falten). */
    fun deletePositions(ids: List<Long>) {
        if (ids.isEmpty()) return
        db.beginTransaction()
        try {
            for (id in ids) {
                db.delete("position", "id = ?", arrayOf(id.toString()))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** Marca como descartado (no se reintenta) y lo cuenta para el diagnóstico. */
    fun markDead(ids: List<Long>) {
        if (ids.isEmpty()) return
        db.beginTransaction()
        try {
            for (id in ids) {
                val values = ContentValues()
                values.put("status", STATUS_DEAD)
                db.update("position", values, "id = ?", arrayOf(id.toString()))
            }
            addMetaCounter(db, KEY_DEAD_EVENTS, ids.size.toLong())
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        // Los descartados no traban la cola: se cuentan y se borran (el
        // servidor ya dijo que no los quiere).
        deletePositions(ids)
    }

    /** Suma un intento de subida a cada evento del lote. */
    fun addAttempts(ids: List<Long>) {
        if (ids.isEmpty()) return
        db.beginTransaction()
        try {
            for (id in ids) {
                db.execSQL("UPDATE position SET attempts = attempts + 1 WHERE id = ?", arrayOf(id))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    // --- Tabla meta: identidad y contadores ----------------------------------
    // Si el esquema quedó a medias, leer devuelve null y escribir no hace nada,
    // en vez de romper el arranque.

    @SuppressLint("Range")
    fun getMeta(clave: String): String? = runCatching {
        ensureEsquemaV6(db)
        readableDatabase.rawQuery("SELECT valor FROM meta WHERE clave = ?", arrayOf(clave)).use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0)
        }
        null
    }.onFailure { Log.e(TAG, "meta ilegible ($clave)", it) }.getOrNull()

    fun putMeta(clave: String, valor: String) {
        runCatching {
            ensureEsquemaV6(db)
            val values = ContentValues()
            values.put("clave", clave)
            values.put("valor", valor)
            db.insertWithOnConflict("meta", null, values, SQLiteDatabase.CONFLICT_REPLACE)
        }.onFailure { Log.e(TAG, "meta no persistida ($clave)", it) }
    }

    private fun addMetaCounter(db: SQLiteDatabase, clave: String, delta: Long) {
        runCatching {
            val current = db.rawQuery("SELECT valor FROM meta WHERE clave = ?", arrayOf(clave)).use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0).toLongOrNull() ?: 0L else 0L
            }
            val values = ContentValues()
            values.put("clave", clave)
            values.put("valor", (current + delta).toString())
            db.insertWithOnConflict("meta", null, values, SQLiteDatabase.CONFLICT_REPLACE)
        }
    }

    /** Contador de desbordes del búfer (para el latido). */
    fun bufferOverflowCount(): Long = getMeta(KEY_BUFFER_OVERFLOW)?.toLongOrNull() ?: 0L

    /** Eventos declarados DEAD por el servidor (para el latido). */
    fun deadEventsCount(): Long = getMeta(KEY_DEAD_EVENTS)?.toLongOrNull() ?: 0L

    /**
     * `boot_id`: uno nuevo cada vez que arranca el registro ([rotateBootId]),
     * guardado en meta para sobrevivir si el sistema recrea la app. Las filas
     * viejas conservan el suyo.
     *
     * El candado es estático porque hay varias instancias sobre el mismo
     * SQLite (registro, jornada, cierre); con un candado por instancia dos
     * hilos podían sacar la misma secuencia.
     */
    fun currentBootId(): String {
        synchronized(IDENTITY_LOCK) {
            val existing = getMeta(KEY_BOOT_ID)
            if (!existing.isNullOrBlank()) return existing
            return rotateBootIdLocked()
        }
    }

    fun rotateBootId(): String {
        synchronized(IDENTITY_LOCK) {
            return rotateBootIdLocked()
        }
    }

    private fun rotateBootIdLocked(): String {
        val fresh = java.util.UUID.randomUUID().toString()
        putMeta(KEY_BOOT_ID, fresh)
        return fresh
    }

    /**
     * `local_sequence`: contador persistente que SOLO incrementa (nunca se
     * reinicia, ni en reboot). Mismo candado estático que el boot_id: la
     * lectura-modificación-escritura debe ser atómica entre instancias.
     */
    fun nextLocalSequence(): Long {
        synchronized(IDENTITY_LOCK) {
            val current = getMeta(KEY_LAST_SEQUENCE)?.toLongOrNull() ?: 0L
            val next = current + 1
            putMeta(KEY_LAST_SEQUENCE, next.toString())
            return next
        }
    }

    /** Completa la identidad del punto si no viene puesta. */
    fun withIdentity(position: Position): Position {
        if (position.bootId.isNotBlank() && position.localSequence > 0L) return position
        return position.copy(
            bootId = position.bootId.ifBlank { currentBootId() },
            localSequence = if (position.localSequence > 0L) position.localSequence else nextLocalSequence(),
            journeyId = position.journeyId.ifBlank { getMeta(KEY_JOURNEY_ID).orEmpty() },
            status = position.status.ifBlank { STATUS_PENDING },
        )
    }

    companion object {
        const val DATABASE_VERSION = 7
        const val DATABASE_NAME = "dmujeres.db"

        /** Nombre que tenía el archivo antes. */
        private const val NOMBRE_ANTERIOR = "traccar.db"

        /**
         * Al arrancar la app, antes de abrir la base, el archivo con el nombre
         * anterior pasa al nombre nuevo con sus puntos pendientes.
         */
        fun migrarNombreAnterior(context: Context) {
            val anterior = context.getDatabasePath(NOMBRE_ANTERIOR)
            val nuevo = context.getDatabasePath(DATABASE_NAME)
            if (!anterior.exists() || nuevo.exists()) return
            for (sufijo in listOf("", "-journal", "-wal", "-shm")) {
                val origen = java.io.File(anterior.path + sufijo)
                if (origen.exists()) origen.renameTo(java.io.File(nuevo.path + sufijo))
            }
        }

        /** Candado estático de identidad (boot_id + secuencia, ver arriba). */
        private val IDENTITY_LOCK = Any()

        /** Columnas nuevas de la v5 (migración aditiva). */
        private val POSITION_V5_COLUMNS = listOf(
            "boot_id TEXT",
            "local_sequence INTEGER",
            "journey_id TEXT",
            "provider TEXT",
            "movement_state TEXT",
            "status TEXT",
            "attempts INTEGER",
        )

        /** Esquema de instalación limpia: v6 + `device_id` (v7). */
        private const val CREATE_POSITION =
            "CREATE TABLE position (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "deviceId TEXT," +
                "time INTEGER," +
                "latitude REAL," +
                "longitude REAL," +
                "altitude REAL," +
                "speed REAL," +
                "course REAL," +
                "accuracy REAL," +
                "battery REAL," +
                "charging INTEGER," +
                "mock INTEGER," +
                "boot_id TEXT," +
                "local_sequence INTEGER," +
                "journey_id TEXT," +
                "provider TEXT," +
                "movement_state TEXT," +
                "status TEXT," +
                "attempts INTEGER," +
                "device_id TEXT)"

        private const val CREATE_META =
            "CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT)"

        const val KEY_BOOT_ID = "boot_id"
        const val KEY_LAST_SEQUENCE = "ultima_secuencia"
        const val KEY_JOURNEY_ID = "journey_id"
        const val KEY_JOURNEY_STARTED_AT = "journey_started_at"
        const val KEY_BUFFER_OVERFLOW = "buffer_overflow"
        const val KEY_DEAD_EVENTS = "dead_events"
        const val KEY_RECOVERY_PENDING = "recovery_pending"
    }

}
