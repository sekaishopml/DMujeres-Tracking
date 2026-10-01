package com.dmujeres.app

import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * El envío legacy nunca lanza: cualquier fallo (red, HTTP de error, runtime)
 * es `false` y el llamador aplica backoff sin perder el wake lock.
 */
class RequestManagerCatchTest {

    @Test
    fun `url nula o malformada es false sin lanzar`() {
        assertFalse(RequestManager.sendRequest(null))
        assertFalse(RequestManager.sendRequest("::::"))
    }
}
