package com.notifystore.app

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class NotificationForwarderService : NotificationListenerService() {

    private val scope = CoroutineScope(Dispatchers.IO)
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    companion object {
        private const val TAG = "NotifyForwarder"
        const val ACTION_LOG = "com.notifystore.app.LOG_EVENT"
        const val EXTRA_LOG_MSG = "log_msg"

        fun sendPayload(
            context: Context,
            serverUrl: String,
            apiKey: String,
            appName: String,
            packageName: String,
            title: String,
            text: String,
            bigText: String,
            onResult: ((Boolean, String) -> Unit)? = null
        ) {
            val cleanUrl = serverUrl.trim().removeSuffix("/")
            val targetEndpoint = "$cleanUrl/api/notifications"

            val json = JSONObject().apply {
                put("appName", appName)
                put("packageName", packageName)
                put("title", title)
                put("text", text)
                put("bigText", bigText)
                put("postTime", System.currentTimeMillis())
                put("apiKey", apiKey)
            }

            val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url(targetEndpoint)
                .addHeader("x-api-key", apiKey)
                .post(body)
                .build()

            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
                .build()

            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val response = client.newCall(request).execute()
                    val success = response.isSuccessful
                    val msg = if (success) "Enviado exitosamente a la tienda ($appName)" else "Error servidor: ${response.code}"
                    broadcastLog(context, msg)
                    onResult?.invoke(success, msg)
                } catch (e: Exception) {
                    val err = "Error de red: ${e.message}"
                    Log.e(TAG, err, e)
                    broadcastLog(context, err)
                    onResult?.invoke(false, err)
                }
            }
        }

        fun broadcastLog(context: Context, msg: String) {
            val intent = Intent(ACTION_LOG).apply {
                putExtra(EXTRA_LOG_MSG, msg)
                setPackage(context.packageName)
            }
            context.sendBroadcast(intent)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val pkgName = sbn.packageName ?: return

        // Evitar bucle con la propia aplicación
        if (pkgName == packageName) return

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim() ?: ""

        // Ignorar notificaciones vacías
        if (title.isEmpty() && text.isEmpty() && bigText.isEmpty()) return

        // Obtener nombre amigable de la aplicación
        val appName = try {
            val pm = applicationContext.packageManager
            val appInfo = pm.getApplicationInfo(pkgName, 0)
            pm.getApplicationLabel(appInfo).toString()
        } catch (e: Exception) {
            pkgName
        }

        // Obtener configuración guardada
        val prefs = applicationContext.getSharedPreferences("store_notify_prefs", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", "") ?: ""
        val apiKey = prefs.getString("api_key", "tienda123") ?: "tienda123"

        if (serverUrl.isBlank()) {
            broadcastLog(this, "⚠️ Servidor no configurado. Notificación de $appName descartada.")
            return
        }

        // Verificar Filtro de Aplicaciones
        val filterMode = prefs.getString("filter_mode", "selected") ?: "selected"
        if (filterMode == "selected") {
            val allowedPackages = prefs.getStringSet("allowed_packages", null) ?: emptySet()
            val isAllowed = allowedPackages.contains(pkgName) || isPackageAllowedByPattern(pkgName, allowedPackages)

            if (!isAllowed) {
                broadcastLog(this, "🔇 [Filtro] Omitida app: $appName")
                return
            }
        }

        broadcastLog(this, "📡 Transmitiendo a tienda: $appName ($title)")

        sendPayload(
            context = applicationContext,
            serverUrl = serverUrl,
            apiKey = apiKey,
            appName = appName,
            packageName = pkgName,
            title = title,
            text = text,
            bigText = bigText
        )
    }

    private fun isPackageAllowedByPattern(pkgName: String, allowed: Set<String>): Boolean {
        // Soporte para coincidencias de prefijo si están presentes
        return allowed.any { allowedPkg ->
            pkgName.equals(allowedPkg, ignoreCase = true) ||
            pkgName.startsWith(allowedPkg, ignoreCase = true)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
    }
}
