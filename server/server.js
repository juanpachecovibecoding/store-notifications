const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'tienda123';

// Credenciales de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fpvwfqgrwifeszvpttxw.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwdndmcWdyd2lmZXN6dnB0dHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MzQyMzcsImV4cCI6MjEwNDAxMDIzN30.t73QjkpyJ4uzEUzVRY27_sazbABTGCt421IU1KYv7vs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Estado en memoria (respaldo y sincronización)
let inMemoryUsers = [
  {
    id: 'admin-default-id',
    username: 'admin',
    password_hash: bcrypt.hashSync('admin123', 10),
    full_name: 'Administrador Principal',
    role: 'admin',
    is_active: true,
    created_at: new Date().toISOString()
  }
];

let inMemorySessions = [];
let inMemoryNotifications = [];
let inMemorySessionNotifications = [];

// Función para registrar usuarios por defecto si Supabase está vacío
async function initSupabaseAdmin() {
  try {
    const { data, error } = await supabase.from('app_users').select('*').limit(1);
    if (!error && (!data || data.length === 0)) {
      console.log('[Supabase] Insertando admin inicial...');
      await supabase.from('app_users').insert([
        {
          username: 'admin',
          password_hash: bcrypt.hashSync('admin123', 10),
          full_name: 'Administrador Principal',
          role: 'admin',
          is_active: true
        }
      ]);
    }
  } catch (err) {
    console.warn('[Supabase] Aviso al inicializar admin:', err.message);
  }
}
initSupabaseAdmin();

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

wss.on('connection', (ws, req) => {
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      }
    } catch (e) {}
  });
});

// Helper de autenticación para teléfono (API Key)
function phoneAuthMiddleware(req, res, next) {
  const clientKey = req.headers['x-api-key'] || req.query.apiKey || req.body?.apiKey;
  if (API_KEY && clientKey && clientKey !== API_KEY) {
    return res.status(401).json({ error: 'Token o clave de API incorrecta' });
  }
  next();
}

// Middleware para verificar sesión de usuario
async function sessionAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim() || req.query.sessionId || req.headers['x-session-id'];

  if (!token) {
    return res.status(401).json({ error: 'Sesión no proporcionada o no iniciada' });
  }

  // Buscar sesión en Supabase
  try {
    const { data: session, error } = await supabase
      .from('user_sessions')
      .select('*, app_users(*)')
      .eq('id', token)
      .eq('is_active', true)
      .single();

    if (!error && session) {
      req.session = session;
      req.user = session.app_users || { id: session.user_id, username: session.username, role: session.role };
      return next();
    }
  } catch (e) {}

  // Buscar en memoria de respaldo
  const memSession = inMemorySessions.find(s => s.id === token && s.is_active);
  if (memSession) {
    req.session = memSession;
    const memUser = inMemoryUsers.find(u => u.id === memSession.user_id);
    req.user = memUser || { id: memSession.user_id, username: memSession.username, role: memSession.role };
    return next();
  }

  return res.status(401).json({ error: 'Sesión inválida o expirada' });
}

// Middleware solo Administrador
function adminOnlyMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado: se requieren privilegios de Administrador' });
  }
  next();
}

// ==========================================
// RUTAS DE AUTENTICACIÓN Y SESIONES
// ==========================================

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  let user = null;

  // 1. Intentar buscar en Supabase
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('username', username)
      .single();

    if (!error && data) {
      user = data;
    }
  } catch (err) {}

  // 2. Si no está en Supabase, buscar en memoria
  if (!user) {
    user = inMemoryUsers.find(u => u.username === username);
  }

  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Usuario incorrecto o cuenta desactivada' });
  }

  const isMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const newSessionData = {
    user_id: user.id,
    username: user.username,
    role: user.role,
    started_at: new Date().toISOString(),
    is_active: true,
    ip_address: ipAddress,
    user_agent: userAgent
  };

  let sessionObj = null;

  // Guardar en Supabase
  try {
    const { data: createdSession, error } = await supabase
      .from('user_sessions')
      .insert([newSessionData])
      .select()
      .single();

    if (!error && createdSession) {
      sessionObj = createdSession;
    }
  } catch (err) {}

  // Fallback a memoria si Supabase no tiene la tabla aún
  if (!sessionObj) {
    sessionObj = {
      id: `sess_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      ...newSessionData
    };
  }

  inMemorySessions.unshift(sessionObj);

  console.log(`[Auth] Sesión abierta para ${user.username} (${user.role}) - ID: ${sessionObj.id}`);

  res.json({
    success: true,
    token: sessionObj.id,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role
    },
    session: {
      id: sessionObj.id,
      startedAt: sessionObj.started_at
    }
  });
});

// Logout (Cerrar Sesión)
app.post('/api/auth/logout', sessionAuthMiddleware, async (req, res) => {
  const sessionId = req.session.id;

  try {
    await supabase
      .from('user_sessions')
      .update({ ended_at: new Date().toISOString(), is_active: false })
      .eq('id', sessionId);
  } catch (e) {}

  const mem = inMemorySessions.find(s => s.id === sessionId);
  if (mem) {
    mem.ended_at = new Date().toISOString();
    mem.is_active = false;
  }

  console.log(`[Auth] Sesión cerrada ID: ${sessionId}`);
  res.json({ success: true, message: 'Sesión finalizada' });
});

// Datos de la sesión actual
app.get('/api/auth/me', sessionAuthMiddleware, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      fullName: req.user.full_name || req.user.fullName,
      role: req.user.role
    },
    session: {
      id: req.session.id,
      startedAt: req.session.started_at
    }
  });
});

// ==========================================
// RUTAS DE ADMINISTRACIÓN (SOLO ADMIN)
// ==========================================

// Listar usuarios
app.get('/api/admin/users', sessionAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, username, full_name, role, is_active, created_at')
      .order('created_at', { ascending: false });

    if (!error && data) {
      return res.json({ success: true, users: data });
    }
  } catch (e) {}

  // Respaldo en memoria
  const sanitized = inMemoryUsers.map(({ password_hash, ...u }) => u);
  res.json({ success: true, users: sanitized });
});

// Crear nuevo usuario
app.post('/api/admin/users', sessionAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  const { username, password, fullName, role } = req.body;

  if (!username || !password || !fullName) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const userRole = role === 'admin' ? 'admin' : 'usuario';
  const hashedPassword = bcrypt.hashSync(password, 10);

  const newUser = {
    username: username.trim().toLowerCase(),
    password_hash: hashedPassword,
    full_name: fullName.trim(),
    role: userRole,
    is_active: true,
    created_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from('app_users')
      .insert([newUser])
      .select('id, username, full_name, role, is_active, created_at')
      .single();

    if (!error && data) {
      inMemoryUsers.unshift(data);
      return res.status(201).json({ success: true, user: data });
    } else {
      console.warn("[Supabase] Aviso al insertar usuario:", error?.message);
    }

    if (data) {
      inMemoryUsers.unshift(data);
      return res.status(201).json({ success: true, user: data });
    }
  } catch (err) {}

  // Respaldo en memoria
  const memUser = {
    id: `usr_${Date.now()}`,
    ...newUser
  };
  inMemoryUsers.unshift(memUser);

  const { password_hash, ...safeUser } = memUser;
  res.status(201).json({ success: true, user: safeUser });
});

// Alternar estado de usuario (activar/desactivar)
app.patch('/api/admin/users/:id/toggle', sessionAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  const { id } = req.params;

  let newStatus = false;
  try {
    const { data: current } = await supabase.from('app_users').select('is_active').eq('id', id).single();
    if (current) {
      newStatus = !current.is_active;
      await supabase.from('app_users').update({ is_active: newStatus }).eq('id', id);
    }
  } catch (e) {}

  const mem = inMemoryUsers.find(u => u.id === id);
  if (mem) {
    mem.is_active = !mem.is_active;
    newStatus = mem.is_active;
  }

  res.json({ success: true, is_active: newStatus });
});

// Editar usuario (nombre, usuario, contraseña opcional, rol)
app.put('/api/admin/users/:id', sessionAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  const { id } = req.params;
  const { fullName, username, password, role } = req.body;

  if (!fullName || !username) {
    return res.status(400).json({ error: 'Nombre y usuario son obligatorios' });
  }

  const updateFields = {
    full_name: fullName.trim(),
    username: username.trim().toLowerCase(),
    role: role === 'admin' ? 'admin' : 'usuario'
  };

  if (password && password.trim().length > 0) {
    updateFields.password_hash = bcrypt.hashSync(password.trim(), 10);
  }

  try {
    const { data, error } = await supabase
      .from('app_users')
      .update(updateFields)
      .eq('id', id)
      .select('id, username, full_name, role, is_active, created_at')
      .single();

    if (!error && data) {
      const idx = inMemoryUsers.findIndex(u => u.id === id);
      if (idx !== -1) {
        inMemoryUsers[idx] = { ...inMemoryUsers[idx], ...updateFields, ...data };
      }
      return res.json({ success: true, user: data });
    }
  } catch (err) {
    console.warn('[Supabase] Error actualizando usuario:', err.message);
  }

  const memIdx = inMemoryUsers.findIndex(u => u.id === id);
  if (memIdx !== -1) {
    inMemoryUsers[memIdx] = { ...inMemoryUsers[memIdx], ...updateFields };
    const { password_hash, ...safe } = inMemoryUsers[memIdx];
    return res.json({ success: true, user: safe });
  }

  res.status(404).json({ error: 'Usuario no encontrado' });
});

// Eliminar usuario
app.delete('/api/admin/users/:id', sessionAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  const { id } = req.params;

  if (req.user.id === id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de administrador' });
  }

  try {
    const { error } = await supabase
      .from('app_users')
      .delete()
      .eq('id', id);

    if (!error) {
      inMemoryUsers = inMemoryUsers.filter(u => u.id !== id);
      return res.json({ success: true, message: 'Usuario eliminado correctamente' });
    }
  } catch (err) {
    console.warn('[Supabase] Error eliminando usuario:', err.message);
  }

  inMemoryUsers = inMemoryUsers.filter(u => u.id !== id);
  res.json({ success: true, message: 'Usuario eliminado correctamente' });
});

// Listar todas las sesiones
app.get('/api/admin/sessions', sessionAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('user_sessions')
      .select(`
        *,
        session_notifications(count)
      `)
      .order('started_at', { ascending: false })
      .limit(100);

    if (!error && sessions) {
      const formatted = sessions.map(s => ({
        ...s,
        notificationCount: s.session_notifications?.[0]?.count || 0
      }));
      return res.json({ success: true, sessions: formatted });
    }
  } catch (e) {}

  // Respaldo en memoria
  const formattedMem = inMemorySessions.map(s => {
    const count = inMemorySessionNotifications.filter(n => n.session_id === s.id).length;
    return { ...s, notificationCount: count };
  });

  res.json({ success: true, sessions: formattedMem });
});

// Ver notificaciones de una sesión específica
app.get('/api/admin/sessions/:sessionId/notifications', sessionAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  const { sessionId } = req.params;

  try {
    const { data, error } = await supabase
      .from('session_notifications')
      .select('*')
      .eq('session_id', sessionId)
      .order('received_at', { ascending: false });

    if (!error && data) {
      return res.json({ success: true, notifications: data });
    }
  } catch (e) {}

  // Respaldo en memoria
  const filtered = inMemorySessionNotifications.filter(n => n.session_id === sessionId);
  res.json({ success: true, notifications: filtered });
});

// ==========================================
// NOTIFICACIONES (RECEPCIÓN Y TIEMPO REAL)
// ==========================================

// Endpoint para el celular Android
app.post('/api/notifications', phoneAuthMiddleware, async (req, res) => {
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

  const notifId = notificationId || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const nowIso = new Date().toISOString();

  const newNotif = {
    id: notifId,
    appName: appName || packageName || 'Desconocida',
    packageName: packageName || 'unknown.package',
    title: title || '(Sin título)',
    text: text || bigText || '(Sin contenido)',
    bigText: bigText || '',
    subText: subText || '',
    receivedAt: nowIso,
    postTime: postTime || Date.now(),
    status: 'new'
  };

  inMemoryNotifications.unshift(newNotif);
  if (inMemoryNotifications.length > 500) inMemoryNotifications.pop();

  // 1. Guardar en Supabase (tabla global)
  try {
    await supabase.from('notifications').insert([{
      id: newNotif.id,
      app_name: newNotif.appName,
      package_name: newNotif.packageName,
      title: newNotif.title,
      text: newNotif.text,
      big_text: newNotif.bigText,
      post_time: newNotif.postTime,
      received_at: nowIso,
      status: 'new'
    }]);
  } catch (err) {
    console.warn('[Supabase] Error guardando notificación global:', err.message);
  }

  // 2. Obtener sesiones activas para vincular la notificación
  let activeSessions = [];
  try {
    const { data: dbActiveSessions } = await supabase
      .from('user_sessions')
      .select('id, user_id, username')
      .eq('is_active', true);

    if (dbActiveSessions && dbActiveSessions.length > 0) {
      activeSessions = dbActiveSessions;
    }
  } catch (err) {}

  if (activeSessions.length === 0) {
    activeSessions = inMemorySessions.filter(s => s.is_active);
  }

  // 3. Vincular notificación a cada sesión activa
  if (activeSessions.length > 0) {
    const sessionRecords = activeSessions.map(s => ({
      session_id: s.id,
      user_id: s.user_id,
      notification_id: newNotif.id,
      app_name: newNotif.appName,
      title: newNotif.title,
      text: newNotif.text,
      received_at: nowIso,
      status: 'new'
    }));

    try {
      await supabase.from('session_notifications').insert(sessionRecords);
    } catch (err) {
      console.warn('[Supabase] Error vinculando a sesiones:', err.message);
    }

    sessionRecords.forEach(rec => inMemorySessionNotifications.unshift(rec));
    console.log(`[Sesión] Notificación vinculada a ${activeSessions.length} sesión(es) activa(s).`);
  } else {
    console.log(`[Sesión] No hay sesiones activas en este momento. Notificación guardada en el historial general.`);
  }

  // 4. Difundir en tiempo real por WebSockets
  broadcast({
    type: 'NEW_NOTIFICATION',
    data: newNotif
  });

  console.log(`[Notificación Recibida] [${newNotif.appName}] ${newNotif.title}`);

  res.status(201).json({
    success: true,
    message: 'Notificación procesada y vinculada a las sesiones activas',
    notification: newNotif,
    linkedSessionsCount: activeSessions.length
  });
});

// Listado de notificaciones para el panel
app.get('/api/notifications', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(100);

    if (!error && data && data.length > 0) {
      const formatted = data.map(d => ({
        id: d.id,
        appName: d.app_name,
        packageName: d.package_name,
        title: d.title,
        text: d.text,
        bigText: d.big_text,
        postTime: d.post_time,
        receivedAt: d.received_at,
        status: d.status
      }));
      return res.json({ success: true, count: formatted.length, notifications: formatted });
    }
  } catch (e) {}

  res.json({
    success: true,
    count: inMemoryNotifications.length,
    notifications: inMemoryNotifications
  });
});

// Actualizar estado (Atendido)
app.patch('/api/notifications/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const newStatus = status || 'attended';

  try {
    await supabase.from('notifications').update({ status: newStatus }).eq('id', id);
    await supabase.from('session_notifications').update({ status: newStatus }).eq('notification_id', id);
  } catch (e) {}

  const item = inMemoryNotifications.find(n => n.id === id);
  if (item) {
    item.status = newStatus;
  }

  broadcast({
    type: 'UPDATE_NOTIFICATION',
    data: { id, status: newStatus }
  });

  res.json({ success: true, id, status: newStatus });
});

// Descargar APK
app.get('/download/app-debug.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'public', 'download', 'app-debug.apk');
  if (fs.existsSync(apkPath)) {
    res.setHeader('Content-Disposition', 'attachment; filename="StoreNotify.apk"');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    return res.sendFile(apkPath);
  } else {
    return res.status(404).send('APK no disponible.');
  }
});

// Status y comprobación del servidor
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    appName: 'Notificaciones Tienda con Supabase',
    serverTime: new Date().toISOString(),
    totalNotifications: inMemoryNotifications.length,
    activeSessions: inMemorySessions.filter(s => s.is_active).length,
    activeWebSockets: wss.clients.size,
    hasApk: fs.existsSync(path.join(__dirname, 'public', 'download', 'app-debug.apk'))
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🚀 Servidor StoreNotify con Supabase y Roles activo!`);
  console.log(`📡 Puerto: http://localhost:${PORT}`);
  console.log(`🗄️ Supabase URL: ${SUPABASE_URL}`);
  console.log(`🔑 Admin por defecto: admin / admin123`);
  console.log(`=================================================`);
});
