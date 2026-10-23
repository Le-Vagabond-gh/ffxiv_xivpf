package com.levagabond.xivpf

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// Kotlin half of the listing logic. The static game data lives in shared/xivpf-data.js
// (shared with the page and the userscript) and the filter below must stay in step
// with matches() in shared/xivpf-core.js, so the background poller alerts on exactly
// what the page shows.
object Listings {
    const val API = "https://xivpf.com/api/listings"
    private const val KEY_STATE = "state"

    fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("xivpf", Context.MODE_PRIVATE)
    fun stateText(ctx: Context): String = prefs(ctx).getString(KEY_STATE, null) ?: "{}"
    fun saveState(ctx: Context, json: String) = prefs(ctx).edit().putString(KEY_STATE, json).apply()

    // xivpf-data.js is `window.XIVPF_DATA = {json};` so the page can load it as a plain
    // script; the object between the first { and the last } is the json
    fun data(ctx: Context): JSONObject {
        val js = ctx.assets.open("xivpf-data.js").bufferedReader().readText()
        return JSONObject(js.substring(js.indexOf('{'), js.lastIndexOf('}') + 1))
    }

    fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000
        c.readTimeout = 30_000
        try {
            if (c.responseCode != 200) throw Exception("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().readText()
        } finally {
            c.disconnect()
        }
    }

    class Filter(ctx: Context, state: JSONObject) {
        private val data = data(ctx)
        private val worldToDc = HashMap<String, String>()
        private val categoryLabel = HashMap<String, String>()
        private val dcs: Set<String>?
        private val categories: Set<String>
        private val duties: Set<String> = state.optJSONArray("duties")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
        private val search: String = state.optString("search", "").lowercase()
        val interval: Long = state.optInt("interval", 300).coerceAtLeast(60).toLong()

        init {
            val dcWorlds = data.getJSONObject("dcWorlds")
            for (dc in dcWorlds.keys()) {
                val worlds = dcWorlds.getJSONArray(dc)
                for (i in 0 until worlds.length()) worldToDc[worlds.getString(i)] = dc
            }
            val cats = data.getJSONArray("categories")
            for (i in 0 until cats.length()) categoryLabel[cats.getJSONArray(i).getString(0)] = cats.getJSONArray(i).getString(1)

            val area = state.optString("area", "Europe")
            val regions = data.getJSONObject("regions")
            dcs = when {
                area == "All" -> null
                regions.has(area) -> regions.getJSONArray(area).let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
                else -> setOf(area)
            }
            categories = state.optJSONArray("categories")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
                ?: categoryLabel.keys
        }

        fun dataCentre(l: JSONObject): String = worldToDc[l.getJSONObject("created_world").getString("name")] ?: "Unknown"

        fun dutyName(l: JSONObject): String {
            val category = l.optString("category")
            val infoName = l.optJSONObject("duty_info")?.optJSONObject("name")?.optString("en", "")?.takeIf { it.isNotEmpty() }
            return when (l.optString("duty_type")) {
                "Normal" -> infoName ?: categoryLabel[category] ?: category
                "Roulette" -> "Duty Roulette"
                else -> {
                    if (category == "DeepDungeon" && infoName != null) {
                        val key = infoName.lowercase().replace(Regex("^the\\s+"), "").trim()
                        data.getJSONObject("deepDungeons").optString(key, "").takeIf { it.isNotEmpty() }?.let { return it }
                    }
                    categoryLabel[category] ?: category
                }
            }
        }

        fun matches(l: JSONObject): Boolean {
            if (dcs != null && dataCentre(l) !in dcs) return false
            if (l.optString("category") !in categories) return false
            if (duties.isNotEmpty() && dutyName(l) !in duties) return false
            if (search.isNotEmpty()) {
                val haystack = listOf(
                    dutyName(l), l.getJSONObject("description").optString("en"), l.optString("recruiter"),
                    l.getJSONObject("created_world").getString("name"), l.getJSONObject("home_world").getString("name"),
                ).joinToString(" ").lowercase()
                if (search !in haystack) return false
            }
            return true
        }
    }
}
