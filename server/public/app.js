// Estado de la aplicación
let currentUser = null;
let sessionToken = localStorage.getItem('store_notify_token') || null;
let notifications = [];
let selectedDate = '';
let searchQuery = '';
let soundEnabled = true;
let audioCtx = null;
let ws = null;

// ==========================================
// INICIALIZACIÓN Y AUTENTICACIÓN
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  setupAuthForm();
  setupFiltersAndSearch();

  if (sessionToken) {
    await verifyCurrentSession();
  } else {
    showAuthView();
  }

  // Activar audio context al primer clic
  document.body.addEventListener('click', () => {
    initAudio();
  }, { once: true });
});

function setupAuthForm() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('inputUsername').value.trim();
      const password = document.getElementById('inputPassword').value.trim();

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Error al iniciar sesión');
          return;
        }

        sessionToken = data.token;
        currentUser = data.user;
        localStorage.setItem('store_notify_token', sessionToken);
        localStorage.setItem('store_notify_user', JSON.stringify(currentUser));

        initAppView();
      } catch (err) {
        alert('Error de conexión con el servidor: ' + err.message);
      }
    });
  }

  const newUserForm = document.getElementById('newUserForm');
  if (newUserForm) {
    newUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('newFullName').value.trim();
      const username = document.getElementById('newUsername').value.trim();
      const password = document.getElementById('newPassword').value.trim();
      const role = document.getElementById('newRole').value;

      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`
          },
          body: JSON.stringify({ fullName, username, password, role })
        });

        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'No se pudo crear el usuario');
          return;
        }

        alert('Usuario creado correctamente!');
        closeNewUserModal();
        newUserForm.reset();
        loadAdminUsers();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }

  const editUserForm = document.getElementById('editUserForm');
  if (editUserForm) {
    editUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editUserId').value;
      const fullName = document.getElementById('editFullName').value.trim();
      const username = document.getElementById('editUsername').value.trim();
      const password = document.getElementById('editPassword').value.trim();
      const role = document.getElementById('editRole').value;

      try {
        const res = await fetch(`/api/admin/users/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`
          },
          body: JSON.stringify({ fullName, username, password, role })
        });

        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'No se pudo actualizar el usuario');
          return;
        }

        alert('Usuario actualizado correctamente!');
        closeEditUserModal();
        loadAdminUsers();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }
}

async function verifyCurrentSession() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      initAppView();
    } else {
      logout(false);
    }
  } catch (e) {
    // Si hay error de red, intentar con datos locales
    const cachedUser = localStorage.getItem('store_notify_user');
    if (cachedUser) {
      currentUser = JSON.parse(cachedUser);
      initAppView();
    } else {
      showAuthView();
    }
  }
}

function showAuthView() {
  document.getElementById('authView').style.display = 'flex';
  document.getElementById('appView').style.display = 'none';
  if (ws) {
    ws.close();
    ws = null;
  }
}

function initAppView() {
  document.getElementById('authView').style.display = 'none';
  document.getElementById('appView').style.display = 'flex';

  // Mostrar datos del usuario
  document.getElementById('lblCurrentUserName').textContent = currentUser.fullName || currentUser.username;
  document.getElementById('lblCurrentUserRole').textContent = currentUser.role === 'admin' ? 'Administrador' : 'Empleado';

  // Navegación y opciones exclusivas para Admin
  const adminTabs = document.getElementById('adminNavTabs');
  const btnApk = document.getElementById('btnApkModal');
  if (currentUser.role === 'admin') {
    if (adminTabs) adminTabs.style.display = 'flex';
    if (btnApk) btnApk.style.display = 'inline-flex';
  } else {
    if (adminTabs) adminTabs.style.display = 'none';
    if (btnApk) btnApk.style.display = 'none';
  }

  switchTab('live');
  connectWebSocket();
  loadInitialNotifications();
}

async function logout(callApi = true) {
  if (callApi && sessionToken) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
    } catch (e) {}
  }
  sessionToken = null;
  currentUser = null;
  localStorage.removeItem('store_notify_token');
  localStorage.removeItem('store_notify_user');
  showAuthView();
}

// ==========================================
// TABS & NAVEGACIÓN
// ==========================================

function switchTab(tab) {
  const tabLive = document.getElementById('tabLiveFeed');
  const tabUsers = document.getElementById('tabUsers');
  const tabSessions = document.getElementById('tabSessions');

  const secLive = document.getElementById('sectionLiveFeed');
  const secUsers = document.getElementById('sectionUsers');
  const secSessions = document.getElementById('sectionSessions');

  [tabLive, tabUsers, tabSessions].forEach(t => t && t.classList.remove('active'));
  [secLive, secUsers, secSessions].forEach(s => s && (s.style.display = 'none'));

  if (tab === 'live') {
    if (tabLive) tabLive.classList.add('active');
    secLive.style.display = 'block';
  } else if (tab === 'users') {
    if (tabUsers) tabUsers.classList.add('active');
    secUsers.style.display = 'block';
    loadAdminUsers();
  } else if (tab === 'sessions') {
    if (tabSessions) tabSessions.classList.add('active');
    secSessions.style.display = 'block';
    loadAdminSessions();
  }
}

// ==========================================
// MÓDULO ADMIN: USUARIOS
// ==========================================

let cachedAdminUsers = [];

async function loadAdminUsers() {
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    cachedAdminUsers = data.users || [];
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    if (cachedAdminUsers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No hay usuarios registrados</td></tr>`;
      return;
    }

    tbody.innerHTML = cachedAdminUsers.map(u => {
      const isSelf = u.id === currentUser.id;
      return `
        <tr>
          <td><b>${escapeHtml(u.full_name)}</b></td>
          <td><code>${escapeHtml(u.username)}</code></td>
          <td><span class="role-badge role-${u.role}">${u.role}</span></td>
          <td>${formatDate(u.created_at)}</td>
          <td>
            ${u.is_active
              ? '<span class="badge-active">● Activo</span>'
              : '<span class="badge-ended">● Desactivado</span>'}
          </td>
          <td>
            <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
              <button class="btn btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="openEditUserModal('${u.id}')">
                ✏️ Editar
              </button>
              ${!isSelf ? `
                <button class="btn btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="toggleUserStatus('${u.id}')">
                  ${u.is_active ? 'Desactivar' : 'Activar'}
                </button>
                <button class="btn btn-outline-danger" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="deleteUser('${u.id}', '${escapeForAttr(u.username)}')">
                  🗑️ Eliminar
                </button>
              ` : '<span style="color: var(--text-muted); font-size: 0.75rem;">(Tu cuenta)</span>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

function openEditUserModal(userId) {
  const user = cachedAdminUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('editUserId').value = user.id;
  document.getElementById('editFullName').value = user.full_name || '';
  document.getElementById('editUsername').value = user.username || '';
  document.getElementById('editPassword').value = '';
  document.getElementById('editRole').value = user.role || 'usuario';

  document.getElementById('editUserModal').classList.add('active');
}

function closeEditUserModal() {
  document.getElementById('editUserModal').classList.remove('active');
}

async function deleteUser(id, username) {
  if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente al usuario "${username}"?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'No se pudo eliminar el usuario');
      return;
    }
    alert(`Usuario ${username} eliminado.`);
    loadAdminUsers();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function toggleUserStatus(id) {
  try {
    const res = await fetch(`/api/admin/users/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.ok) loadAdminUsers();
  } catch (e) {}
}

function openNewUserModal() {
  document.getElementById('newUserModal').classList.add('active');
}

function closeNewUserModal() {
  document.getElementById('newUserModal').classList.remove('active');
}

// ==========================================
// MÓDULO ADMIN: SESIONES Y REGISTRO DE TURNOS
// ==========================================

async function loadAdminSessions() {
  try {
    const res = await fetch('/api/admin/sessions', {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('sessionsTableBody');
    if (!tbody) return;

    if (data.sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No hay sesiones registradas</td></tr>`;
      return;
    }

    tbody.innerHTML = data.sessions.map(s => {
      const isActive = s.is_active;
      return `
        <tr>
          <td><b>${escapeHtml(s.username)}</b></td>
          <td><span class="role-badge role-${s.role}">${s.role}</span></td>
          <td>${formatDate(s.started_at)}</td>
          <td>${s.ended_at ? formatDate(s.ended_at) : '<span style="color: #6ee7b7;">En curso...</span>'}</td>
          <td>
            ${isActive
              ? '<span class="badge-active">● Conectado (En vivo)</span>'
              : '<span class="badge-ended">Finalizada</span>'}
          </td>
          <td>
            <span style="font-weight: 700; color: #38bdf8;">${s.notificationCount} avisos</span>
          </td>
          <td>
            <button class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;" onclick="viewSessionNotifs('${s.id}', '${escapeForAttr(s.username)}', '${escapeForAttr(s.started_at)}')">
              🔍 Ver Notificaciones
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

async function viewSessionNotifs(sessionId, username, startedAt) {
  const modal = document.getElementById('sessionNotifsModal');
  const title = document.getElementById('modalSessionTitle');
  const sub = document.getElementById('modalSessionSubtitle');
  const list = document.getElementById('sessionNotifsList');

  title.textContent = `Turno de: ${username}`;
  sub.textContent = `Iniciado: ${formatDate(startedAt)}`;
  list.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-muted);">Cargando notificaciones del turno...</div>`;
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/admin/sessions/${sessionId}/notifications`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    const data = await res.json();

    if (!data.notifications || data.notifications.length === 0) {
      list.innerHTML = `
        <div class="empty-state" style="padding: 2rem;">
          <p>No se recibieron notificaciones de entregas durante este turno.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = data.notifications.map(n => {
      const meta = getAppMeta(n.app_name);
      return `
        <div class="notif-card" style="padding: 1rem;">
          <div class="app-badge-icon" style="background: ${meta.color}20; color: ${meta.color}; width: 38px; height: 38px; font-size: 1.1rem;">
            ${meta.icon}
          </div>
          <div class="notif-content">
            <div class="notif-topline">
              <span class="app-name-pill" style="background: ${meta.color}25; color: ${meta.color};">${meta.badge}</span>
              <span class="notif-time">⏰ ${formatDate(n.received_at)}</span>
            </div>
            <div class="notif-title" style="font-size: 0.95rem;">${escapeHtml(n.title)}</div>
            <div class="notif-body" style="font-size: 0.85rem;">${escapeHtml(n.text)}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div style="color: var(--danger); padding: 1rem;">Error al cargar: ${err.message}</div>`;
  }
}

function closeSessionNotifsModal() {
  document.getElementById('sessionNotifsModal').classList.remove('active');
}

// ==========================================
// MÓDULO EN VIVO: WEBSOCKET & FEED
// ==========================================

async function loadInitialNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    if (data.notifications) {
      notifications = data.notifications;
      updateSearchSuggestions();
      render();
    }
  } catch (e) {}
}

function connectWebSocket() {
  if (ws) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  updateStatus(false, 'Conectando...');

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      updateStatus(true, 'En Vivo (Conectado)');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {}
    };

    ws.onclose = () => {
      updateStatus(false, 'Desconectado (Reintentando...)');
      ws = null;
      if (sessionToken) setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      if (ws) ws.close();
    };
  } catch (err) {
    updateStatus(false, 'Error de conexión');
    setTimeout(connectWebSocket, 4000);
  }
}

function handleServerMessage(msg) {
  if (msg.type === 'NEW_NOTIFICATION') {
    const item = msg.data;
    if (!notifications.some(n => n.id === item.id)) {
      notifications.unshift(item);
      playStoreChime();
      showDesktopNotification(item);
      updateSearchSuggestions();
      render(item.id);
    }
  } else if (msg.type === 'UPDATE_NOTIFICATION') {
    const { id, status } = msg.data;
    const target = notifications.find(n => n.id === id);
    if (target) {
      target.status = status;
      render();
    }
  }
}

function updateStatus(isOnline, text) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (dot && label) {
    dot.classList.toggle('online', isOnline);
    label.textContent = text;
  }
}

// ==========================================
// SONIDO, DESKTOP NOTIFS Y UTILIDADES
// ==========================================

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playStoreChime() {
  if (!soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;

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
  } catch (err) {}
}

function showDesktopNotification(item) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(`[${item.appName}] ${item.title}`, {
        body: item.text,
        icon: 'https://cdn-icons-png.flaticon.com/512/893/893257.png',
        tag: item.id
      });
    } catch (e) {}
  }
}

function getAppMeta(appName, packageName) {
  const name = (appName || packageName || '').toLowerCase();
  if (name.includes('rappi')) return { icon: '🛵', color: '#ff441f', badge: 'Rappi' };
  if (name.includes('pedidos') || name.includes('ya')) return { icon: '🍔', color: '#e21b5a', badge: 'PedidosYa' };
  if (name.includes('mercado') || name.includes('libre')) return { icon: '📦', color: '#ffe600', badge: 'MercadoLibre' };
  if (name.includes('amazon')) return { icon: '📦', color: '#ff9900', badge: 'Amazon' };
  if (name.includes('uber') || name.includes('eats')) return { icon: '🚗', color: '#06c167', badge: 'Uber Eats' };
  if (name.includes('whatsapp')) return { icon: '💬', color: '#25d366', badge: 'WhatsApp' };
  if (name.includes('telegram')) return { icon: '✈️', color: '#0088cc', badge: 'Telegram' };
  if (name.includes('gmail') || name.includes('mail')) return { icon: '✉️', color: '#ea4335', badge: 'Correo' };
  return { icon: '📱', color: '#6366f1', badge: appName || 'App' };
}

function formatTime(isoOrTimestamp) {
  try {
    const d = new Date(isoOrTimestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    return '';
  }
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return iso;
  }
}

async function toggleStatus(id) {
  try {
    await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
  } catch (err) {}
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Copiado al portapapeles!');
  }).catch(() => {});
}

function render(highlightId = null) {
  const container = document.getElementById('notificationGrid');
  const countBadge = document.getElementById('notifCount');
  if (!container) return;

  const filtered = notifications.filter(item => {
    // Filtro por fecha específica seleccionada
    let matchesDate = true;
    if (selectedDate) {
      const dateObj = new Date(item.postTime || item.receivedAt);
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      const localDateStr = `${yyyy}-${mm}-${dd}`;
      matchesDate = (localDateStr === selectedDate);
    }

    // Filtro por texto y sugerencias predictivas
    const fullSearch = `${item.appName} ${item.title} ${item.text} ${item.bigText}`.toLowerCase();
    const matchesSearch = !searchQuery || fullSearch.includes(searchQuery.toLowerCase());

    return matchesDate && matchesSearch;
  });

  if (countBadge) {
    const dateLabel = selectedDate ? ` (del ${selectedDate})` : '';
    countBadge.textContent = `${filtered.length} notificaciones${dateLabel}`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 3rem; margin-bottom: 0.5rem;">🔔</div>
        <h3>No se encontraron avisos</h3>
        <p>${selectedDate ? `No hay notificaciones para la fecha ${selectedDate}.` : 'No hay notificaciones con los filtros ingresados.'}</p>
        <button class="btn btn-secondary" onclick="simulateDelivery()">✨ Probar Notificación</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const meta = getAppMeta(item.appName, item.packageName);
    const isAttended = item.status === 'attended';
    const isNew = item.id === highlightId;

    return `
      <div class="notif-card ${isAttended ? 'status-attended' : ''} ${isNew ? 'new-arrival' : ''}" id="card-${item.id}">
        <div class="app-badge-icon" style="background: ${meta.color}20; color: ${meta.color}; border-color: ${meta.color}50;">
          ${meta.icon}
        </div>
        <div class="notif-content">
          <div class="notif-topline">
            <span class="app-name-pill" style="background: ${meta.color}25; color: ${meta.color === '#ffe600' ? '#f59e0b' : meta.color};">
              ${meta.badge}
            </span>
            <span class="notif-time">⏰ ${formatDate(item.postTime || item.receivedAt)}</span>
            ${isAttended ? '<span style="color: var(--success); font-size: 0.75rem; font-weight: 600;">✅ Atendido</span>' : '<span style="color: var(--warning); font-size: 0.75rem; font-weight: 600;">⚡ Verificado por Storefy</span>'}
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

function setupFiltersAndSearch() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });
  }

  const dateFilter = document.getElementById('dateFilter');
  const btnClearDate = document.getElementById('btnClearDate');
  if (dateFilter) {
    dateFilter.addEventListener('change', (e) => {
      selectedDate = e.target.value;
      if (btnClearDate) {
        btnClearDate.style.display = selectedDate ? 'inline-flex' : 'none';
      }
      render();
    });
  }
}

function clearDateFilter() {
  selectedDate = '';
  const dateFilter = document.getElementById('dateFilter');
  const btnClearDate = document.getElementById('btnClearDate');
  if (dateFilter) dateFilter.value = '';
  if (btnClearDate) btnClearDate.style.display = 'none';
  render();
}

function updateSearchSuggestions() {
  const datalist = document.getElementById('searchSuggestions');
  if (!datalist) return;
  const terms = new Set();

  notifications.forEach(n => {
    if (n.appName) terms.add(n.appName);
    if (n.title) {
      if (n.title.length < 35) terms.add(n.title);
      const matches = n.title.match(/(#[A-Za-z0-9_-]+|\b[A-ZÁÉÍÓÚa-záéíóú0-9]{4,}\b)/g);
      if (matches) matches.forEach(m => terms.add(m));
    }
    if (n.text) {
      const matches = n.text.match(/(#[A-Za-z0-9_-]+|\b\d{4,}\b)/g);
      if (matches) matches.forEach(m => terms.add(m));
    }
  });

  datalist.innerHTML = Array.from(terms).slice(0, 45).map(t => `<option value="${escapeHtml(t)}">`).join('');
}

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
    }
  ];

  const sample = samples[Math.floor(Math.random() * samples.length)];
  try {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sample)
    });
  } catch (e) {}
}

function requestDesktopPermissions() {
  if (!("Notification" in window)) return alert("Navegador no soporta notificaciones.");
  Notification.requestPermission().then(p => {
    if (p === 'granted') {
      alert("¡Alertas de escritorio activadas!");
    }
  });
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('soundToggleBtn');
  if (btn) {
    btn.innerHTML = soundEnabled ? '🔊 Sonido' : '🔇 Silencio';
    btn.classList.toggle('btn-primary', soundEnabled);
    btn.classList.toggle('btn-secondary', !soundEnabled);
  }
  if (soundEnabled) {
    initAudio();
    playStoreChime();
  }
}

function openApkModal() {
  if (!currentUser || currentUser.role !== 'admin') {
    return;
  }
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
  document.getElementById('apkModal').classList.remove('active');
}
