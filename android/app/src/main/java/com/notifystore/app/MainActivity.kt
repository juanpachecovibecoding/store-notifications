package com.notifystore.app

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.method.ScrollingMovementMethod
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var tvPermissionStatus: TextView
    private lateinit var btnGrantPermission: Button
    private lateinit var btnBatteryOptimization: Button

    // Filtros
    private lateinit var rgFilterMode: RadioGroup
    private lateinit var rbSelectedApps: RadioButton
    private lateinit var rbAllApps: RadioButton
    private lateinit var layoutFilterOptions: LinearLayout
    private lateinit var cbRappi: CheckBox
    private lateinit var cbPedidosYa: CheckBox
    private lateinit var cbMercadoLibre: CheckBox
    private lateinit var cbAmazon: CheckBox
    private lateinit var cbUber: CheckBox
    private lateinit var cbWhatsApp: CheckBox
    private lateinit var cbTelegram: CheckBox
    private lateinit var cbSms: CheckBox
    private lateinit var btnChooseMoreApps: Button
    private lateinit var tvCustomAppsSummary: TextView

    // Conexión
    private lateinit var etServerUrl: EditText
    private lateinit var etApiKey: EditText
    private lateinit var btnSaveConfig: Button
    private lateinit var btnTestNotification: Button
    private lateinit var tvLog: TextView

    private val customSelectedPackages = mutableSetOf<String>()

    private val logReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val msg = intent?.getStringExtra(NotificationForwarderService.EXTRA_LOG_MSG) ?: return
            appendLog(msg)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        loadSavedSettings()
        setupListeners()
    }

    private fun initViews() {
        tvPermissionStatus = findViewById(R.id.tvPermissionStatus)
        btnGrantPermission = findViewById(R.id.btnGrantPermission)
        btnBatteryOptimization = findViewById(R.id.btnBatteryOptimization)

        rgFilterMode = findViewById(R.id.rgFilterMode)
        rbSelectedApps = findViewById(R.id.rbSelectedApps)
        rbAllApps = findViewById(R.id.rbAllApps)
        layoutFilterOptions = findViewById(R.id.layoutFilterOptions)

        cbRappi = findViewById(R.id.cbRappi)
        cbPedidosYa = findViewById(R.id.cbPedidosYa)
        cbMercadoLibre = findViewById(R.id.cbMercadoLibre)
        cbAmazon = findViewById(R.id.cbAmazon)
        cbUber = findViewById(R.id.cbUber)
        cbWhatsApp = findViewById(R.id.cbWhatsApp)
        cbTelegram = findViewById(R.id.cbTelegram)
        cbSms = findViewById(R.id.cbSms)
        btnChooseMoreApps = findViewById(R.id.btnChooseMoreApps)
        tvCustomAppsSummary = findViewById(R.id.tvCustomAppsSummary)

        etServerUrl = findViewById(R.id.etServerUrl)
        etApiKey = findViewById(R.id.etApiKey)
        btnSaveConfig = findViewById(R.id.btnSaveConfig)
        btnTestNotification = findViewById(R.id.btnTestNotification)
        tvLog = findViewById(R.id.tvLog)
        tvLog.movementMethod = ScrollingMovementMethod()
    }

    override fun onResume() {
        super.onResume()
        checkPermissions()
        val filter = IntentFilter(NotificationForwarderService.ACTION_LOG)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(logReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(logReceiver, filter)
        }
    }

    override fun onPause() {
        super.onPause()
        try {
            unregisterReceiver(logReceiver)
        } catch (e: Exception) {
            // Ignorar
        }
    }

    private fun loadSavedSettings() {
        val prefs = getSharedPreferences("store_notify_prefs", Context.MODE_PRIVATE)
        val defaultUrl = "https://glowing-lamp-9695g54r444jc7j9r-3000.app.github.dev"
        val serverUrl = prefs.getString("server_url", defaultUrl) ?: defaultUrl
        val apiKey = prefs.getString("api_key", "tienda123") ?: "tienda123"

        etServerUrl.setText(serverUrl)
        etApiKey.setText(apiKey)

        val filterMode = prefs.getString("filter_mode", "selected") ?: "selected"
        if (filterMode == "all") {
            rbAllApps.isChecked = true
            layoutFilterOptions.visibility = View.GONE
        } else {
            rbSelectedApps.isChecked = true
            layoutFilterOptions.visibility = View.VISIBLE
        }

        cbRappi.isChecked = prefs.getBoolean("filter_rappi", true)
        cbPedidosYa.isChecked = prefs.getBoolean("filter_pedidosya", true)
        cbMercadoLibre.isChecked = prefs.getBoolean("filter_mercadolibre", true)
        cbAmazon.isChecked = prefs.getBoolean("filter_amazon", true)
        cbUber.isChecked = prefs.getBoolean("filter_uber", true)
        cbWhatsApp.isChecked = prefs.getBoolean("filter_whatsapp", true)
        cbTelegram.isChecked = prefs.getBoolean("filter_telegram", false)
        cbSms.isChecked = prefs.getBoolean("filter_sms", true)

        val savedCustom = prefs.getStringSet("custom_packages", emptySet()) ?: emptySet()
        customSelectedPackages.clear()
        customSelectedPackages.addAll(savedCustom)
        updateCustomAppsSummary()
    }

    private fun saveSettings() {
        val url = etServerUrl.text.toString().trim()
        val key = etApiKey.text.toString().trim()

        if (url.isEmpty()) {
            Toast.makeText(this, "Por favor ingresa la URL del servidor", Toast.LENGTH_SHORT).show()
            return
        }

        val filterMode = if (rbAllApps.isChecked) "all" else "selected"
        val allowedPackages = HashSet<String>()

        if (cbRappi.isChecked) {
            allowedPackages.add("com.rappi.store")
            allowedPackages.add("com.grability.rappi")
        }
        if (cbPedidosYa.isChecked) {
            allowedPackages.add("com.pedidosya")
        }
        if (cbMercadoLibre.isChecked) {
            allowedPackages.add("com.mercadolibre")
        }
        if (cbAmazon.isChecked) {
            allowedPackages.add("com.amazon.mShop.android.shopping")
        }
        if (cbUber.isChecked) {
            allowedPackages.add("com.ubercab")
            allowedPackages.add("com.ubercab.eats")
            allowedPackages.add("com.didiglobal.passenger")
            allowedPackages.add("com.didiglobal.driver")
            allowedPackages.add("com.sdu.didi.gui")
        }
        if (cbWhatsApp.isChecked) {
            allowedPackages.add("com.whatsapp")
            allowedPackages.add("com.whatsapp.w4b")
        }
        if (cbTelegram.isChecked) {
            allowedPackages.add("org.telegram.messenger")
        }
        if (cbSms.isChecked) {
            allowedPackages.add("com.google.android.apps.messaging")
            allowedPackages.add("com.android.mms")
            allowedPackages.add("com.samsung.android.messaging")
        }

        // Agregar las apps personalizadas seleccionadas por el usuario
        allowedPackages.addAll(customSelectedPackages)

        getSharedPreferences("store_notify_prefs", Context.MODE_PRIVATE)
            .edit()
            .putString("server_url", url)
            .putString("api_key", key)
            .putString("filter_mode", filterMode)
            .putBoolean("filter_rappi", cbRappi.isChecked)
            .putBoolean("filter_pedidosya", cbPedidosYa.isChecked)
            .putBoolean("filter_mercadolibre", cbMercadoLibre.isChecked)
            .putBoolean("filter_amazon", cbAmazon.isChecked)
            .putBoolean("filter_uber", cbUber.isChecked)
            .putBoolean("filter_whatsapp", cbWhatsApp.isChecked)
            .putBoolean("filter_telegram", cbTelegram.isChecked)
            .putBoolean("filter_sms", cbSms.isChecked)
            .putStringSet("custom_packages", customSelectedPackages)
            .putStringSet("allowed_packages", allowedPackages)
            .apply()

        val modeText = if (filterMode == "all") "TODAS las apps" else "${allowedPackages.size} apps autorizadas"
        Toast.makeText(this, "Guardado con éxito ($modeText)", Toast.LENGTH_SHORT).show()
        appendLog("💾 Configuración y filtros guardados: $modeText")
    }

    private fun setupListeners() {
        btnGrantPermission.setOnClickListener {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            startActivity(intent)
        }

        btnBatteryOptimization.setOnClickListener {
            requestBatteryOptimizationExemption()
        }

        rgFilterMode.setOnCheckedChangeListener { _, checkedId ->
            if (checkedId == R.id.rbAllApps) {
                layoutFilterOptions.visibility = View.GONE
            } else {
                layoutFilterOptions.visibility = View.VISIBLE
            }
        }

        btnChooseMoreApps.setOnClickListener {
            showInstalledAppsPicker()
        }

        btnSaveConfig.setOnClickListener {
            saveSettings()
        }

        btnTestNotification.setOnClickListener {
            sendTestNotification()
        }
    }

    private fun updateCustomAppsSummary() {
        val count = customSelectedPackages.size
        tvCustomAppsSummary.text = if (count == 0) {
            "0 apps adicionales seleccionadas"
        } else {
            "$count apps adicionales activadas"
        }
    }

    private fun showInstalledAppsPicker() {
        val pm = packageManager
        val installedApps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            .filter { app ->
                // Filtrar apps que tienen interfaz de usuario o no son del sistema puro
                app.packageName != packageName && (app.flags and ApplicationInfo.FLAG_SYSTEM == 0 || pm.getLaunchIntentForPackage(app.packageName) != null)
            }
            .sortedBy { app -> pm.getApplicationLabel(app).toString().lowercase() }

        if (installedApps.isEmpty()) {
            Toast.makeText(this, "No se encontraron aplicaciones adicionales", Toast.LENGTH_SHORT).show()
            return
        }

        val appNames = installedApps.map { pm.getApplicationLabel(it).toString() }.toTypedArray()
        val checkedItems = BooleanArray(installedApps.size) { i ->
            customSelectedPackages.contains(installedApps[i].packageName)
        }

        AlertDialog.Builder(this)
            .setTitle("Seleccionar Aplicaciones a Transmitir")
            .setMultiChoiceItems(appNames, checkedItems) { _, which, isChecked ->
                val pkg = installedApps[which].packageName
                if (isChecked) {
                    customSelectedPackages.add(pkg)
                } else {
                    customSelectedPackages.remove(pkg)
                }
            }
            .setPositiveButton("Aceptar") { dialog, _ ->
                updateCustomAppsSummary()
                saveSettings()
                dialog.dismiss()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun checkPermissions() {
        val isNotificationAccessGranted = NotificationManagerCompat.getEnabledListenerPackages(this)
            .contains(packageName)

        if (isNotificationAccessGranted) {
            tvPermissionStatus.text = "✅ Acceso a notificaciones: ACTIVO"
            tvPermissionStatus.setTextColor(getColor(R.color.success))
            btnGrantPermission.isEnabled = false
            btnGrantPermission.text = "✓ Acceso a Notificaciones Concedido"
        } else {
            tvPermissionStatus.text = "⚠️ Permiso NO concedido (Toca el botón abajo)"
            tvPermissionStatus.setTextColor(getColor(R.color.danger))
            btnGrantPermission.isEnabled = true
            btnGrantPermission.text = "1. Activar Acceso a Notificaciones"
        }

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val isIgnoringBattery = powerManager.isIgnoringBatteryOptimizations(packageName)
        if (isIgnoringBattery) {
            btnBatteryOptimization.text = "✓ Ahorro de Batería Optimizado (24/7)"
            btnBatteryOptimization.isEnabled = false
        } else {
            btnBatteryOptimization.text = "2. Desactivar Ahorro de Batería (Recomendado)"
            btnBatteryOptimization.isEnabled = true
        }
    }

    @SuppressLint("BatteryLife")
    private fun requestBatteryOptimizationExemption() {
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "No se pudo abrir ajuste de batería", Toast.LENGTH_SHORT).show()
        }
    }

    private fun sendTestNotification() {
        val serverUrl = etServerUrl.text.toString().trim()
        val apiKey = etApiKey.text.toString().trim()

        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "Guarda una URL de servidor primero", Toast.LENGTH_SHORT).show()
            return
        }

        appendLog("🚀 Enviando prueba de entrega a la tienda...")
        NotificationForwarderService.sendPayload(
            context = this,
            serverUrl = serverUrl,
            apiKey = apiKey,
            appName = "App Entregas (Prueba)",
            packageName = "com.test.delivery",
            title = "¡Mercadería en Camino!",
            text = "El camión de reparto #302 está a 5 minutos de la tienda. Código: 8841",
            bigText = "Entrega con 4 bultos de mercadería programada para hoy."
        ) { success, msg ->
            runOnUiThread {
                if (success) {
                    Toast.makeText(this, "¡Enviado a la tienda con éxito!", Toast.LENGTH_LONG).show()
                } else {
                    Toast.makeText(this, "Fallo: $msg", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun appendLog(text: String) {
        runOnUiThread {
            val time = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
            val current = tvLog.text.toString()
            val newText = "[$time] $text\n$current"
            tvLog.text = newText
        }
    }
}
