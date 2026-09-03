const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'tienda123';
const DATA_FILE = path.join(__dirname, 'notifications.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Almacenamiento en memoria con persistencia básica en archivo
let notifications = [];

function loadNotifications() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      notifications = JSON.parse(data);
      console.log(`[Storage] ${notifications.length} notificaciones cargadas desde archivo.`);
    }
  } catch (err) {
    console.error('[Storage] Error al cargar notificaciones:', err.message);
    notifications = [];
  }
}

function saveNotifications() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(notifications.slice(0, 300), null, 2), 'utf8');
  } catch (err) {
    console.error('[Storage] Error al guardar notificaciones:', err.message);
  }
}

loadNotifications();

// Difusión por WebSockets
function broadcast(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        console.error('[WebSocket] Error enviando mensaje a cliente:', err.message);
      }
    }
  });
}

// WebSocket handler
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WebSocket] Nuevo cliente conectado desde ${ip}. Total: ${wss.clients.size}`);

  // Enviar estado inicial y las notificaciones existentes
  ws.send(JSON.stringify({
    type: 'INIT',
    data: notifications
  }));

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      }
    } catch (e) {
      // Ignorar mensajes mal formateados
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] Cliente desconectado. Restantes: ${wss.clients.size}`);
  });
});

// Middleware de autenticación opcional para el teléfono
function authMiddleware(req, res, next) {
  const clientKey = req.headers['x-api-key'] || req.query.apiKey || req.body?.apiKey;
  if (API_KEY && clientKey && clientKey !== API_KEY) {
    return res.status(401).json({ error: 'Token o clave de API incorrecta' });
  }
  next();
}

// Rutas de la API
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    appName: 'Notificaciones Tienda',
    serverTime: new Date().toISOString(),
    totalNotifications: notifications.length,
    activeWebSockets: wss.clients.size,
    hasApk: fs.existsSync(path.join(__dirname, 'public', 'download', 'app-debug.apk'))
  });
});

app.get('/api/notifications', (req, res) => {
  res.json({
    success: true,
    count: notifications.length,
    notifications: notifications
  });
});

// Recepción de notificaciones enviadas por la app Android
app.post('/api/notifications', authMiddleware, (req, res) => {
  const {
    appName,
    packageName,
    title,
    text,
    bigText,
    subText,
    postTime,
    notificationId
  } = req.body;

  if (!appName && !title && !text) {
    return res.status(400).json({ error: 'Se requiere al menos appName, title o text.' });
  }

  const newNotif = {
    id: notificationId || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    appName: appName || packageName || 'Desconocida',
    packageName: packageName || 'unknown.package',
    title: title || '(Sin título)',
    text: text || bigText || '(Sin contenido)',
    bigText: bigText || '',
    subText: subText || '',
    receivedAt: new Date().toISOString(),
    postTime: postTime || Date.now(),
    status: 'new', // 'new' | 'attended'
    attendedAt: null
  };

  // Insertar al inicio (las más recientes primero)
  notifications.unshift(newNotif);
  if (notifications.length > 500) {
    notifications = notifications.slice(0, 500);
  }

  saveNotifications();

  // Transmitir en tiempo real a los navegadores de la tienda
  broadcast({
    type: 'NEW_NOTIFICATION',
    data: newNotif
  });

  console.log(`[Notificación Recibida] [${newNotif.appName}] ${newNotif.title}: ${newNotif.text.substring(0, 60)}...`);

  res.status(201).json({
    success: true,
    message: 'Notificación procesada y transmitida a los empleados',
    notification: newNotif
  });
});

// Marcar notificación como "Atendido" o alternar estado
app.patch('/api/notifications/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'attended' o 'new'

  const item = notifications.find(n => n.id === id);
  if (!item) {
    return res.status(404).json({ error: 'Notificación no encontrada' });
  }

  item.status = status || (item.status === 'attended' ? 'new' : 'attended');
  item.attendedAt = item.status === 'attended' ? new Date().toISOString() : null;

  saveNotifications();

  broadcast({
    type: 'UPDATE_NOTIFICATION',
    data: item
  });

  res.json({ success: true, notification: item });
});

// Borrar historial
app.delete('/api/notifications', (req, res) => {
  notifications = [];
  saveNotifications();

  broadcast({
    type: 'CLEAR_ALL'
  });

  res.json({ success: true, message: 'Historial vaciado' });
});

// Descargar la APK compilada
app.get('/download/app-debug.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'public', 'download', 'app-debug.apk');
  if (fs.existsSync(apkPath)) {
    res.setHeader('Content-Disposition', 'attachment; filename="StoreNotify.apk"');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    return res.sendFile(apkPath);
  } else {
    return res.status(404).send('APK aún no compilada. Por favor ejecuta la compilación en el servidor.');
  }
});

// Ruta comodín para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🚀 Servidor de Notificaciones Tienda iniciado!`);
  console.log(`📡 Puerto local: http://localhost:${PORT}`);
  console.log(`🔑 Clave API predeterminada: ${API_KEY}`);
  console.log(`📱 Descarga APK: http://localhost:${PORT}/download/app-debug.apk`);
  console.log(`=================================================`);
});
