package com.levagabond.xivpf

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

// Foreground service that re-fetches the listings on the user's interval and posts one
// notification per listing that newly matches the saved filter. The first pass after a
// start or a filter change only seeds the known set so nothing already visible alerts.
class Poller : Service() {
    companion object {
        private const val TAG = "xivpf"
        private const val ACTION_STOP = "com.levagabond.xivpf.STOP"
        private const val CH_POLLER = "poller"
        private const val CH_NEW = "new"
        private const val ID_PERSISTENT = 1

        @Volatile var running = false
            private set

        fun start(ctx: Context) = ctx.startForegroundService(Intent(ctx, Poller::class.java))
        fun stop(ctx: Context) = ctx.stopService(Intent(ctx, Poller::class.java))
    }

    private var thread: Thread? = null
    private val nm by lazy { getSystemService(NotificationManager::class.java) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "poller start: action=${intent?.action}")
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        nm.createNotificationChannel(NotificationChannel(CH_POLLER, "Poller status", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_NEW, "New listings", NotificationManager.IMPORTANCE_HIGH))
        startForeground(ID_PERSISTENT, persistent("starting"), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        if (thread == null) {
            running = true
            thread = Thread(::loop, "xivpf-poll").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "poller destroyed")
        running = false
        thread?.interrupt()
        thread = null
        super.onDestroy()
    }

    private fun openApp(): PendingIntent =
        PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)

    private fun persistent(text: String): Notification {
        val stop = PendingIntent.getService(
            this, 1, Intent(this, Poller::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CH_POLLER)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("xivpf alerts on")
            .setContentText(text)
            .setContentIntent(openApp())
            .setOngoing(true)
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_notification), "Stop", stop).build())
            .build()
    }

    private fun loop() {
        // ponytail: partial wake lock + Thread.sleep keeps sub-minute ticks alive with the screen
        // off; switch to AlarmManager.setExactAndAllowWhileIdle if battery becomes a problem.
        val wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "xivpf:poll")
        wakeLock.acquire()
        var known: Set<Int>? = null
        var lastState = ""
        try {
            while (running) {
                val stateText = Listings.stateText(this)
                if (stateText != lastState) {
                    known = null
                    lastState = stateText
                }
                val filter = Listings.Filter(this, JSONObject(stateText))
                try {
                    val arr = JSONArray(Listings.get(Listings.API))
                    val fresh = HashSet<Int>()
                    var alerted = 0
                    for (i in 0 until arr.length()) {
                        val l = arr.optJSONObject(i)?.optJSONObject("listing") ?: continue
                        if (!filter.matches(l)) continue
                        val id = l.getInt("id")
                        fresh += id
                        if (known != null && id !in known) {
                            notify(filter, l)
                            alerted++
                        }
                    }
                    known = fresh
                    nm.notify(ID_PERSISTENT, persistent("${fresh.size} matching, every ${filter.interval / 60} min" + if (alerted > 0) ", $alerted new" else ""))
                } catch (e: Exception) {
                    Log.w(TAG, "poll failed", e)
                    nm.notify(ID_PERSISTENT, persistent("refresh failed: ${e.message}"))
                }
                Thread.sleep(filter.interval * 1000)
            }
        } catch (_: InterruptedException) {
        } finally {
            wakeLock.release()
        }
    }

    private fun notify(filter: Listings.Filter, l: JSONObject) {
        val o = l.optJSONObject("objective") ?: JSONObject()
        val flags = buildString {
            if (o.optBoolean("practice")) append("[Practice]")
            if (o.optBoolean("duty_completion")) append("[Duty Completion]")
            if (o.optBoolean("loot")) append("[Loot]")
        }
        val desc = l.getJSONObject("description").optString("en").trim()
        val who = "${l.optString("recruiter")} @ ${l.getJSONObject("created_world").getString("name")}"
        val n = Notification.Builder(this, CH_NEW)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(filter.dutyName(l))
            .setContentText("$flags $desc".trim().ifEmpty { who })
            .setStyle(Notification.BigTextStyle().bigText("$flags $desc".trim() + "\n" + who))
            .setContentIntent(openApp())
            .setAutoCancel(true)
            .build()
        nm.notify(l.getInt("id"), n)
    }
}
