#!/bin/bash
set -e

export JAVA_HOME=/usr/local/sdkman/candidates/java/21.0.10-ms
export ANDROID_HOME=/workspaces/codespaces-blank/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH

echo "============================================"
echo "🔨 Compilando APK de StoreNotify en Codespaces..."
echo "Java: $(java -version 2>&1 | head -n 1)"
echo "Android SDK: $ANDROID_HOME"
echo "============================================"

cd /workspaces/codespaces-blank/android
/workspaces/codespaces-blank/gradle-8.7/bin/gradle assembleDebug --no-daemon

APK_SRC="/workspaces/codespaces-blank/android/app/build/outputs/apk/debug/app-debug.apk"
APK_DEST="/workspaces/codespaces-blank/server/public/download/app-debug.apk"

if [ -f "$APK_SRC" ]; then
    mkdir -p /workspaces/codespaces-blank/server/public/download
    cp "$APK_SRC" "$APK_DEST"
    echo "============================================"
    echo "✅ APK Compilada con éxito!"
    echo "📦 Ubicación: $APK_DEST"
    echo "📏 Tamaño: $(du -h "$APK_DEST" | cut -f1)"
    echo "🔗 Descarga directa: https://${CODESPACE_NAME}-3000.app.github.dev/download/app-debug.apk"
    echo "============================================"
else
    echo "❌ Error: No se encontró el archivo APK generado."
    exit 1
fi
