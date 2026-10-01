package com.dmujeres.app

import android.database.sqlite.SQLiteDatabase
import android.location.Location
import android.os.Build
import androidx.preference.PreferenceManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Config(application = com.dmujeres.app.MainApplication::class,
    sdk = [Build.VERSION_CODES.P])
@RunWith(RobolectricTestRunner::class)
class DatabaseHelperTest {
    @Test
    fun test() {

        val databaseHelper = DatabaseHelper(ApplicationProvider.getApplicationContext())

        var position: Position? = Position("123456789012345", Location("gps"), BatteryStatus())

        Assert.assertNull(databaseHelper.selectPosition())

        databaseHelper.insertPosition(position!!)

        position = databaseHelper.selectPosition()

        Assert.assertNotNull(position)

        databaseHelper.deletePosition(position!!.id)

        Assert.assertNull(databaseHelper.selectPosition())

    }


    @Test
    fun `el bufer respeta el tope y descarta los mas viejos`() {
        val databaseHelper = DatabaseHelper(ApplicationProvider.getApplicationContext())
        val limit = 5000
        // Referencia real del primer insertado (Robolectric aplica un offset al Location.time).
        val referenceLocation = Location("gps")
        referenceLocation.time = 1_000L
        val firstInsertedTime = Position("123456789012345", referenceLocation, BatteryStatus()).time.time
        // Inserta el tope + 10 y verifica que solo quedan las más nuevas.
        for (index in 0 until limit + 10) {
            val location = Location("gps")
            location.time = 1_000L + index
            databaseHelper.insertPosition(Position("123456789012345", location, BatteryStatus()))
        }
        Assert.assertEquals(limit, databaseHelper.countPositions())
        // La primera posición conservada debe ser la número 10 (las 10 más viejas se descartaron).
        val oldest = databaseHelper.selectPosition()
        Assert.assertNotNull(oldest)
        Assert.assertEquals(
            "count=" + databaseHelper.countPositions() + " oldest=" + oldest!!.time.time,
            firstInsertedTime + 10,
            oldest!!.time.time,
        )
    }

    /**
     * El equipo se guarda POR FILA al insertar (Prefs.DEVICE vigente): al
     * cambiar de cuenta, lo capturado antes conserva su identificador y la
     * subida no lo pisa con el nuevo.
     */
    @Test
    fun `insertPosition guarda el equipo vigente en el momento de capturar`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val databaseHelper = DatabaseHelper(context)

        prefs.edit().putString(Prefs.DEVICE, "equipo-a").commit()
        val primera = Location("gps").apply { time = 1_000L }
        databaseHelper.insertPosition(Position("123456789012345", primera, BatteryStatus()))

        prefs.edit().putString(Prefs.DEVICE, "equipo-b").commit()
        val segunda = Location("gps").apply { time = 2_000L }
        databaseHelper.insertPosition(Position("123456789012345", segunda, BatteryStatus()))

        val filas = databaseHelper.selectPositions(10)
        Assert.assertEquals(2, filas.size)
        Assert.assertEquals("la vieja conserva su equipo", "equipo-a", filas[0].captureDeviceId)
        Assert.assertEquals("la nueva usa el equipo del momento", "equipo-b", filas[1].captureDeviceId)
    }

    /**
     * Migración v7 idempotente: una base v6 (sin `device_id`) se abre, gana la
     * columna y conserva sus filas (nunca DROP). Las filas viejas leen
     * `captureDeviceId` vacío: se suben con el identificador actual.
     */
    @Test
    fun `migracion v7 agrega device_id sin borrar filas`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val path = context.getDatabasePath(DatabaseHelper.DATABASE_NAME)
        path.parentFile?.mkdirs()
        val old = SQLiteDatabase.openOrCreateDatabase(path, null)
        old.execSQL(
            "CREATE TABLE position (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "deviceId TEXT, time INTEGER, latitude REAL, longitude REAL," +
                "altitude REAL, speed REAL, course REAL, accuracy REAL," +
                "battery REAL, charging INTEGER, mock INTEGER, boot_id TEXT," +
                "local_sequence INTEGER, journey_id TEXT, provider TEXT," +
                "movement_state TEXT, status TEXT, attempts INTEGER)",
        )
        old.execSQL("CREATE TABLE meta (clave TEXT PRIMARY KEY, valor TEXT)")
        old.execSQL(
            "INSERT INTO position (deviceId, time, latitude, longitude, status)" +
                " VALUES ('equipo-a', 1000, 1.0, 2.0, 'PENDING')",
        )
        old.version = 6
        old.close()

        val databaseHelper = DatabaseHelper(context)
        Assert.assertEquals("la fila vieja sobrevive a la migración", 1, databaseHelper.countPositions())
        val heredada = databaseHelper.selectPosition()
        Assert.assertNotNull(heredada)
        Assert.assertEquals("sin device_id: se sube con el identificador actual", "", heredada!!.captureDeviceId)

        // La columna quedó realmente agregada: el insert nuevo ya persiste.
        PreferenceManager.getDefaultSharedPreferences(context)
            .edit().putString(Prefs.DEVICE, "equipo-a").commit()
        val nueva = Location("gps").apply { time = 2_000L }
        databaseHelper.insertPosition(Position("123456789012345", nueva, BatteryStatus()))
        val filas = databaseHelper.selectPositions(10)
        Assert.assertEquals(2, filas.size)
        Assert.assertEquals("equipo-a", filas[1].captureDeviceId)

        val check = SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
        val tieneDeviceId = check.rawQuery("PRAGMA table_info(position)", null).use { cursor ->
            var found = false
            while (cursor.moveToNext()) {
                if (cursor.getString(cursor.getColumnIndex("name")) == "device_id") found = true
            }
            found
        }
        check.close()
        Assert.assertTrue("device_id existe tras la migración", tieneDeviceId)
    }
}
