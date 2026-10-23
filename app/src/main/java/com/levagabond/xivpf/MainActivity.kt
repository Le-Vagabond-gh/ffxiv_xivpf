package com.levagabond.xivpf

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject
import java.io.File

// The whole UI is shared/xivpf-core.js (same page as the userscript) wired to this
// bridge by assets/pf.js, in a WebView. Kotlin only does what the page cannot: HTTP
// without CORS, persistent state the poller can read, and starting/stopping the
// poller service.
class MainActivity : Activity() {
    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = true
        web.webViewClient = object : WebViewClient() {
            // Everything that is not our own asset page opens in the browser (tomestone, full site).
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.scheme == "file") return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "Android")
        // edge-to-edge is forced since android 15, so the page would start under the
        // status bar. the inset padding goes on a wrapper: WebView drops its own padding.
        // the strip takes pico's dark background
        val frame = FrameLayout(this)
        frame.setBackgroundColor(0xFF11191F.toInt())
        frame.setOnApplyWindowInsetsListener { v, insets ->
            @Suppress("DEPRECATION")
            v.setPadding(0, insets.systemWindowInsetTop, 0, insets.systemWindowInsetBottom)
            insets
        }
        frame.addView(web)
        web.loadUrl("file:///android_asset/pf.html")
        setContentView(frame)
    }

    // All methods run on the WebView's bridge thread, not the UI thread.
    inner class Bridge {
        // The icon sprite is cached once; <use href> cannot reference a cross-origin file.
        @JavascriptInterface
        fun icons(): String {
            val f = File(cacheDir, "icons.svg")
            if (!f.exists()) {
                try { f.writeText(Listings.get("https://xivpf.com/assets/icons.svg")) } catch (e: Exception) { return "" }
            }
            return f.readText()
        }

        @JavascriptInterface
        fun loadState(): String = Listings.stateText(this@MainActivity)

        @JavascriptInterface
        fun saveState(json: String) = Listings.saveState(this@MainActivity, json)

        @JavascriptInterface
        fun refresh() {
            Thread {
                val js = try {
                    "pfListings(${Listings.get(Listings.API)})"
                } catch (e: Exception) {
                    "pfError(${JSONObject.quote(e.message ?: e.toString())})"
                }
                web.post { web.evaluateJavascript(js, null) }
            }.start()
        }

        @JavascriptInterface
        fun polling(): Boolean = Poller.running

        @JavascriptInterface
        fun setPolling(on: Boolean) {
            if (!on) {
                Poller.stop(this@MainActivity)
                return
            }
            Poller.start(this@MainActivity)
            val pm = getSystemService(PowerManager::class.java)
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                runOnUiThread {
                    startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
                }
            }
        }
    }
}
