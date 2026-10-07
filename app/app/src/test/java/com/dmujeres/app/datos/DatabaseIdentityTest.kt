package com.dmujeres.app.datos

import android.os.Build
import androidx.test.core.app.ApplicationProvider
import com.dmujeres.app.sistema.MainApplication
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Identidad de evento concurrente (Robolectric + SQLite real).
 *
 * Varias instancias de DatabaseHelper comparten el mismo archivo (tracking,
 * jornada, cierre): la secuencia debe ser única entre instancias incluso con
 * hilos concurrentes, o el servidor dedupea y una fila se reenvía para siempre.
 */
@Config(application = com.dmujeres.app.sistema.MainApplication::class,
    sdk = [Build.VERSION_CODES.P])
@RunWith(RobolectricTestRunner::class)
class DatabaseIdentityTest {

    @Test
    fun `secuencias unicas entre instancias y concurrentes`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        // Una instancia por hilo, como en producción (tracking, jornada,
        // cierre); se crean fuera de la sección medida para no mezclar el
        // costo de apertura del SQLite con la contención de la secuencia.
        val helpers = List(4) { DatabaseHelper(context.applicationContext) }
        val threads = helpers.size
        val perThread = 20
        val total = threads * perThread
        val seen = Collections.synchronizedSet(HashSet<Long>())
        val start = CountDownLatch(1)
        val done = CountDownLatch(threads)
        val pool = Executors.newFixedThreadPool(threads)
        helpers.forEach { db ->
            pool.execute {
                start.await()
                repeat(perThread) {
                    seen.add(db.nextLocalSequence())
                }
                done.countDown()
            }
        }
        start.countDown()
        assertEquals("todas las secuencias deben emitirse", true, done.await(120, TimeUnit.SECONDS))
        pool.shutdown()
        // Sin duplicados (se permiten huecos: un putMeta perdido deja hueco,
        // nunca duplicado; el dedupe del servidor exige unicidad, no densidad).
        assertEquals("ninguna secuencia duplicada entre instancias", total, seen.size)
    }

    @Test
    fun `boot_id estable dentro del proceso y unico al rotar`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val first = DatabaseHelper(context.applicationContext).currentBootId()
        val same = DatabaseHelper(context.applicationContext).currentBootId()
        assertEquals(first, same)
        val rotated = DatabaseHelper(context.applicationContext).rotateBootId()
        assertEquals(rotated, DatabaseHelper(context.applicationContext).currentBootId())
        assertEquals(false, rotated == first)
    }
}
