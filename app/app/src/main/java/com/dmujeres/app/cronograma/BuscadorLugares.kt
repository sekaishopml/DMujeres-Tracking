package com.dmujeres.app.cronograma

import java.text.Normalizer

/**
 * Ordena lo escrito antes según lo que se va escribiendo. Manda la primera
 * palabra: "mall" pone primero los lugares que empiezan así, luego los que
 * tienen una palabra que empieza así y al final los que solo la contienen.
 * Las demás palabras afinan. Sin tildes ni mayúsculas, y a igual puesto el
 * más usado (la lista llega ordenada por uso).
 */
object BuscadorLugares {

    fun ordenar(usados: List<String>, escrito: String, maximo: Int = 6): List<String> {
        val palabras = normal(escrito).split(' ').filter { it.isNotEmpty() }
        if (palabras.isEmpty()) return usados.take(maximo)
        return usados.mapNotNull { lugar ->
            val n = normal(lugar)
            // Lo que ya está escrito completo no se vuelve a proponer.
            if (n == palabras.joinToString(" ")) return@mapNotNull null
            val suyas = n.split(' ')
            if (!palabras.drop(1).all { p -> suyas.any { it.startsWith(p) } }) return@mapNotNull null
            val primera = palabras.first()
            val puesto = when {
                n.startsWith(primera) -> 0
                suyas.any { it.startsWith(primera) } -> 1
                n.contains(primera) -> 2
                else -> return@mapNotNull null
            }
            puesto to lugar
        }.sortedBy { it.first }.take(maximo).map { it.second }
    }

    private fun normal(s: String): String =
        Normalizer.normalize(s.lowercase().trim(), Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "").replace(Regex("\\s+"), " ")
}
