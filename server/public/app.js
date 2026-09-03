// Estado de la aplicación en el navegador
let notifications = [];
let activeFilter = 'all';
let searchQuery = '';
let soundEnabled = true;
let audioCtx = null;
let ws = null;

// Inicializar Audio Context (requiere interacción del usuario en Chrome)
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Sonido de alerta para la tienda (campana de 2 tonos profesional)
function playStoreChime() {
  if (!soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;

    // Primer tono (587.33 Hz - Re5)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.5);

    // Segundo tono más agudo (880 Hz - La5)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.15);
    gain2.gain.setValueAtTime(0, now + 0.15);
    gain2.gain.linearRampToValueAtTime(0.4, now + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.8);
  } catch (err) {
    console.warn('Audio chime error:', err);
  }
}

// Notificación flotante de escritorio en Chrome
function showDesktopNotification(item) {
  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    try {
      const n = new Notification(`[${item.appName}] ${item.title}`, {
        body: item.text,
        icon: 'https://cdn-icons-png.flaticon.com/512/893/893257.png',
        tag: item.id
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (e) {
      console.warn("Desktop notification error:", e);
    }
  }
}

// Icono y color según el tipo de app
function getAppMeta(appName, packageName) {
  const name = (appName || packageName || '').toLowerCase();
  if (name.includes('rappi')) {
    return { icon: '🛵', color: '#ff441f', badge: 'Rappi' };
  }
  if (name.includes('pedidos') || name.includes('ya')) {
    return { icon: '🍔', color: '#e21b5a', badge: 'PedidosYa' };
  }
  if (name.includes('mercado') || name.includes('libre')) {
    return { icon: '📦', color: '#ffe600', badge: 'MercadoLibre' };
  }
  if (name.includes('amazon')) {
    return { icon: '📦', color: '#ff9900', badge: 'Amazon' };
  }
  if (name.includes('uber') || name.includes('eats')) {
    return { icon: '🚗', color: '#06c167', badge: 'Uber Eats' };
  }
  if (name.includes('whatsapp')) {
    return { icon: '💬', color: '#25d366', badge: 'WhatsApp' };
  }
  if (name.includes('telegram')) {
    return { icon: '✈️', color: '#0088cc', badge: 'Telegram' };
  }
  if (name.includes('gmail') || name.includes('mail') || name.includes('correo')) {
    return { icon: '✉️', color: '#ea4335', badge: 'Correo' };
  }
  if (name.includes('didi')) {
    return { icon: '🚖', color: '#ff7d00', badge: 'DiDi' };
  }
  return { icon: '📱', color: '#6366f1', badge: appName || 'App' };
}

// Formato de hora legible
function formatTime(isoOrTimestamp) {
  try {
    const d = new Date(isoOrTimestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    return '';
  }
}

// Conectar al WebSocket del servidor
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  updateStatus(false, 'Conectando...');

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      updateStatus(true, 'En Vivo (Conectado)');
      console.log('[WS] Conectado exitosamente');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error('[WS] Error parseando mensaje:', err);
      }
    };

    ws.onclose = () => {
      updateStatus(false, 'Desconectado (Reintentando...)');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.warn('[WS] Error:', err);
      ws.close();
    };
  } catch (err) {
    updateStatus(false, 'Error de conexión');
    setTimeout(connectWebSocket, 4000);
  }
}

function updateStatus(isOnline, text) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (dot && label) {
    if (isOnline) {
      dot.classList.add('online');
    } else {
      dot.classList.remove('online');
    }
    label.textContent = text;
  }
}

// Procesar mensajes del servidor
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'INIT':
      notifications = msg.data || [];
      render();
      break;

    case 'NEW_NOTIFICATION':
      const newNotif = msg.data;
      // Prevenir duplicados por ID
      if (!notifications.some(n => n.id === newNotif.id)) {
        notifications.unshift(newNotif);
        playStoreChime();
        showDesktopNotification(newNotif);
        render(newNotif.id);
      }
      break;

    case 'UPDATE_NOTIFICATION':
      const updated = msg.data;
      const idx = notifications.findIndex(n => n.id === updated.id);
      if (idx !== -1) {
        notifications[idx] = updated;
        render();
      }
      break;

    case 'CLEAR_ALL':
      notifications = [];
      render();
      break;
  }
}

// Cambiar estado "Atendido"
async function toggleStatus(id) {
  try {
    const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error('Error al actualizar');
  } catch (err) {
    console.error(err);
  }
}

// Borrar historial
async function clearAll() {
  if (!confirm('¿Deseas vaciar la lista de notificaciones?')) return;
  try {
    await fetch('/api/notifications', { method: 'DELETE' });
  } catch (err) {
    alert('Error al borrar');
  }
}

// Copiar texto de la notificación (códigos de entrega, dirección)
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Copiado al portapapeles!');
  }).catch(() => {});
}

// Renderizado del feed
function render(highlightId = null) {
  const container = document.getElementById('notificationGrid');
  const countBadge = document.getElementById('notifCount');
  if (!container) return;

  // Filtrado
  const filtered = notifications.filter(item => {
    const meta = getAppMeta(item.appName, item.packageName);
    const matchesFilter = activeFilter === 'all' ||
      (activeFilter === 'delivery' && ['Rappi', 'PedidosYa', 'MercadoLibre', 'Amazon', 'Uber Eats', 'DiDi'].includes(meta.badge)) ||
      (activeFilter === 'chat' && ['WhatsApp', 'Telegram', 'Correo'].includes(meta.badge)) ||
      meta.badge.toLowerCase().includes(activeFilter.toLowerCase());

    const fullSearch = `${item.appName} ${item.title} ${item.text} ${item.bigText}`.toLowerCase();
    const matchesSearch = !searchQuery || fullSearch.includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} notificaciones`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔔</div>
        <h3>No hay notificaciones pendientes</h3>
        <p>Cuando llegue un aviso de entrega o mensaje a tu celular en casa, aparecerá aquí con alerta de sonido.</p>
        <button class="btn btn-secondary" onclick="simulateDelivery()">✨ Probar Notificación de Entrega</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const meta = getAppMeta(item.appName, item.packageName);
    const isAttended = item.status === 'attended';
    const isNewArrival = item.id === highlightId;

    return `
      <div class="notif-card ${isAttended ? 'status-attended' : ''} ${isNewArrival ? 'new-arrival' : ''}" id="card-${item.id}">
        <div class="app-badge-icon" style="background: ${meta.color}20; color: ${meta.color}; border-color: ${meta.color}50;">
          ${meta.icon}
        </div>
        <div class="notif-content">
          <div class="notif-topline">
            <span class="app-name-pill" style="background: ${meta.color}25; color: ${meta.color === '#ffe600' ? '#f59e0b' : meta.color};">
              ${meta.badge}
            </span>
            <span class="notif-time">⏰ ${formatTime(item.postTime || item.receivedAt)}</span>
            ${isAttended ? '<span style="color: var(--success); font-size: 0.75rem; font-weight: 600;">✅ Atendido</span>' : '<span style="color: var(--warning); font-size: 0.75rem; font-weight: 600;">⚡ En camino</span>'}
          </div>
          <div class="notif-title">${escapeHtml(item.title)}</div>
          <div class="notif-body">${escapeHtml(item.text || item.bigText)}</div>
        </div>
        <div class="notif-actions">
          <button class="btn-status-toggle" onclick="toggleStatus('${item.id}')">
            ${isAttended ? '↩ Desmarcar' : '✓ Marcar Atendido'}
          </button>
          <button class="btn btn-secondary" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;" onclick="copyText('${escapeForAttr(item.title + ' - ' + item.text)}')">
            📋 Copiar
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeForAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, " ");
}

// Simuladores de prueba rápida
async function simulateDelivery() {
  initAudio();
  const samples = [
    {
      appName: 'Rappi',
      packageName: 'com.rappi.store',
      title: '¡Tu pedido de mercadería está cerca!',
      text: 'El repartidor Juan Carlos está a 2 minutos de la tienda. Código de recepción: 4982.'
    },
    {
      appName: 'MercadoLibre',
      packageName: 'com.mercadolibre',
      title: 'Paquete en camino a entrega hoy',
      text: 'Tu envío #ML7892134 de insumos de tienda llegará antes de las 14:00.'
    },
    {
      appName: 'PedidosYa',
      packageName: 'com.pedidosya',
      title: 'Repartidor asignado a la orden #1042',
      text: 'Carlos Mendoza ha tomado la orden y va rumbo a destino.'
    },
    {
      appName: 'WhatsApp',
      packageName: 'com.whatsapp',
      title: 'Proveedor Harinas & Lácteos',
      text: 'Buen día, el camión de distribución ya salió y llega en 20 minutos.'
    }
  ];

  const sample = samples[Math.floor(Math.random() * samples.length)];
  try {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sample)
    });
  } catch (e) {
    alert('Error enviando notificación simulada: ' + e.message);
  }
}

// Solicitar permisos de notificación de escritorio en Chrome
function requestDesktopPermissions() {
  if (!("Notification" in window)) {
    alert("Este navegador no soporta notificaciones de escritorio.");
    return;
  }
  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      alert("¡Listo! Ahora recibirás avisos flotantes de Chrome cuando lleguen notificaciones.");
      new Notification("Notificaciones Activas", {
        body: "Las alertas de entregas de la tienda llegarán a tu pantalla.",
        icon: 'https://cdn-icons-png.flaticon.com/512/893/893257.png'
      });
    } else {
      alert("Permiso no otorgado. Puedes activarlo en los ajustes del candado al lado de la URL.");
    }
  });
}

// Alternar sonido
function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('soundToggleBtn');
  if (btn) {
    btn.innerHTML = soundEnabled ? '🔊 Sonido Activado' : '🔇 Sonido Silenciado';
    btn.classList.toggle('btn-primary', soundEnabled);
    btn.classList.toggle('btn-secondary', !soundEnabled);
  }
  if (soundEnabled) {
    initAudio();
    playStoreChime();
  }
}

// Modales
function openApkModal() {
  const modal = document.getElementById('apkModal');
  const urlBox = document.getElementById('serverUrlBox');
  const qrImg = document.getElementById('qrImage');

  const currentUrl = window.location.origin;
  const downloadUrl = `${currentUrl}/download/app-debug.apk`;

  if (urlBox) urlBox.textContent = currentUrl;
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(downloadUrl)}`;
  }

  if (modal) modal.classList.add('active');
}

function closeApkModal() {
  const modal = document.getElementById('apkModal');
  if (modal) modal.classList.remove('active');
}

// Listeners al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();

  // Filtros
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.getAttribute('data-filter') || 'all';
      render();
    });
  });

  // Buscador
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });
  }

  // Activar audio context al primer clic en cualquier parte
  document.body.addEventListener('click', () => {
    initAudio();
  }, { once: true });
});
