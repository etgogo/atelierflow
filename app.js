const STORAGE_AUTH_KEY = 'atelierflow-auth-v2';
const STORAGE_APP_KEY = 'atelierflow-data-v2';
const SESSION_DEFAULT_ADMIN = { id: 'admin-1', name: 'Admin garage', email: 'admin@atelier.local', password: 'admin123', role: 'admin' };

const defaultUsers = [
  SESSION_DEFAULT_ADMIN,
  { id: 'm-1', name: 'Robert Martin', email: 'robert@atelier.local', password: 'robert123', role: 'mechanic' },
  { id: 'm-2', name: 'Thomas Leroy', email: 'thomas@atelier.local', password: 'thomas123', role: 'mechanic' }
];

const defaultAppState = {
  currentView: 'dashboard',
  selectedVehicleId: 'demo-1',
  vehicles: [
    {
      id: 'demo-1',
      clientName: 'Martin Dupont',
      phone: '06 12 34 56 78',
      brand: 'Renault',
      model: 'Clio',
      plate: 'AB-123-CD',
      plannedDate: '2026-11-12',
      status: 'En cours',
      workRequested: 'Vidange et contrôle des freins',
      workDone: 'Vidange effectuée. Contrôle visuel réalisé.',
      tasks: ['Vidange', 'Contrôle des freins'],
      parts: ['Filtre à huile'],
      quotes: [{ id: 'quote-1', description: 'Plaquettes avant usées, remplacement recommandé.', amount: 180, decision: 'En attente' }],
      mileageIn: 84250,
      mileageOut: 84263,
      notes: 'Véhicule en cours d’intervention, besoin de validation client.'
    },
    {
      id: 'demo-2',
      clientName: 'Sophie Bernard',
      phone: '07 98 76 54 32',
      brand: 'Peugeot',
      model: '208',
      plate: 'XY-456-ZT',
      plannedDate: '2026-11-13',
      status: 'En attente client',
      workRequested: 'Diagnostic bruit à l’avant',
      workDone: 'Bruit confirmé sur rotules avant.',
      tasks: ['Diagnostic', 'Rotules avant'],
      parts: [],
      quotes: [{ id: 'quote-2', description: 'Rotules avant + pose.', amount: 220, decision: 'En attente' }],
      mileageIn: 97000,
      mileageOut: 97014,
      notes: 'Devis à valider par le client.'
    },
    {
      id: 'demo-3',
      clientName: 'Nicolas Martin',
      phone: '06 65 44 33 22',
      brand: 'Citroën',
      model: 'C3',
      plate: 'ZZ-999-KL',
      plannedDate: '2026-11-14',
      status: 'Prêt à récupérer',
      workRequested: 'Diagnostic et remplacement batterie',
      workDone: 'Batterie remplacée, diagnostic terminé.',
      tasks: ['Diagnostic', 'Remplacement batterie'],
      parts: ['Batterie 12 V'],
      quotes: [],
      mileageIn: 73000,
      mileageOut: 73008,
      notes: 'Prêt à être livré.'
    }
  ],
  planning: [
    { id: 'pl-1', vehicleId: 'demo-1', mechanicId: 'm-1', date: '2026-11-12', start: '08:00', end: '10:30', notes: 'Vidange et contrôle des freins' },
    { id: 'pl-2', vehicleId: 'demo-2', mechanicId: 'm-2', date: '2026-11-13', start: '09:00', end: '11:30', notes: 'Diagnostic bruit avant' },
    { id: 'pl-3', vehicleId: 'demo-3', mechanicId: 'm-1', date: '2026-11-14', start: '13:00', end: '14:00', notes: 'Livraison / validation finale' }
  ]
};

let appState = loadAppState();
let authState = loadAuthState();
let currentView = appState.currentView;

const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');
const appContent = document.getElementById('app-content');
const pageTitle = document.getElementById('page-title');
const currentUserLabel = document.getElementById('current-user-label');
const vehicleDialog = document.getElementById('vehicle-dialog');
const quoteDialog = document.getElementById('quote-dialog');
const editDialog = document.getElementById('edit-dialog');
const planningDialog = document.getElementById('planning-dialog');
const createAccountDialog = document.getElementById('create-account-dialog');

function loadAppState() {
  try {
    const saved = localStorage.getItem(STORAGE_APP_KEY);
    if (!saved) return structuredClone(defaultAppState);
    return JSON.parse(saved);
  } catch {
    return structuredClone(defaultAppState);
  }
}

function saveAppState() {
  localStorage.setItem(STORAGE_APP_KEY, JSON.stringify(appState));
}

function loadAuthState() {
  try {
    const saved = localStorage.getItem(STORAGE_AUTH_KEY);
    if (!saved) {
      const initialUsers = structuredClone(defaultUsers);
      localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify({ users: initialUsers, currentUserId: null }));
      return { users: initialUsers, currentUserId: null };
    }
    return JSON.parse(saved);
  } catch {
    const initialUsers = structuredClone(defaultUsers);
    return { users: initialUsers, currentUserId: null };
  }
}

function saveAuthState() {
  localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(authState));
}

function getCurrentUser() {
  return authState.users.find((u) => u.id === authState.currentUserId) || null;
}

function isAdmin() {
  return getCurrentUser()?.role === 'admin';
}

function formatMoney(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function statusClass(value) {
  const map = {
    'À planifier': 'gray',
    'En cours': 'blue',
    'En attente client': 'amber',
    'Prêt à récupérer': 'green',
    'Clôturé': 'gray'
  };
  return map[value] || 'gray';
}

function setView(view) {
  currentView = view;
  appState.currentView = view;
  saveAppState();
  render();
}

function renderAuth() {
  const currentUser = getCurrentUser();
  if (currentUser) {
    appShell.classList.remove('hidden');
    authScreen.classList.add('hidden');
    render();
    return;
  }

  authScreen.classList.remove('hidden');
  appShell.classList.add('hidden');

  authScreen.innerHTML = `
    <div class="auth-card">
      <div class="auth-header">
        <div class="brand-mark auth-brand">AF</div>
        <h2>Connexion AtelierFlow</h2>
      </div>

      <form id="login-form" class="auth-form">
        <label>Email<input name="email" type="email" value="admin@atelier.local" required /></label>
        <label>Mot de passe<input name="password" type="password" value="admin123" required /></label>
        <button class="primary-btn full-width" type="submit">Se connecter</button>
      </form>

      <div class="auth-help">
        <p>Compte admin de démonstration</p>
        <p><strong>admin@atelier.local</strong> / <strong>admin123</strong></p>
      </div>
    </div>
  `;

  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email')).trim();
    const password = String(formData.get('password'));
    const match = authState.users.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password && u.active !== false);

    if (!match) {
      alert('Identifiants incorrects.');
      return;
    }

    authState.currentUserId = match.id;
    saveAuthState();
    renderAuth();
  });
}

function renderAppLayout() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    renderAuth();
    return;
  }

  currentUserLabel.textContent = `${currentUser.name} · ${currentUser.role === 'admin' ? 'Admin' : 'Mécanicien'}`;
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === currentView);
  });

  document.querySelectorAll('.admin-only').forEach((item) => {
    item.style.display = isAdmin() ? 'block' : 'none';
  });

  if (!isAdmin() && currentView === 'accounts') {
    setView('dashboard');
    return;
  }

  render();
}

function renderDashboard() {
  const vehicles = appState.vehicles;
  const active = vehicles.filter((v) => v.status !== 'Clôturé').length;
  const enCours = vehicles.filter((v) => v.status === 'En cours').length;
  const devis = vehicles.reduce((sum, vehicle) => sum + (vehicle.quotes || []).filter((q) => q.decision === 'En attente').length, 0);
  const pret = vehicles.filter((v) => v.status === 'Prêt à récupérer').length;

  appContent.innerHTML = `
    <section class="stats-grid">
      <article class="stat-card"><span>Dossiers actifs</span><strong>${active}</strong></article>
      <article class="stat-card"><span>En cours</span><strong>${enCours}</strong></article>
      <article class="stat-card"><span>Devis en attente</span><strong>${devis}</strong></article>
      <article class="stat-card"><span>Prêts</span><strong>${pret}</strong></article>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <h2>Véhicules récents</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Véhicule</th>
              <th>Client</th>
              <th>Prévu</th>
              <th>Statut</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${vehicles.map((vehicle) => `
              <tr>
                <td><strong>${esc(vehicle.brand)} ${esc(vehicle.model)}</strong><small>${esc(vehicle.plate)}</small></td>
                <td>${esc(vehicle.clientName)}<small>${esc(vehicle.phone)}</small></td>
                <td>${formatDate(vehicle.plannedDate)}</td>
                <td><span class="badge ${statusClass(vehicle.status)}">${esc(vehicle.status)}</span></td>
                <td><button class="text-btn" data-action="open" data-id="${vehicle.id}">Ouvrir</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderVehicles() {
  appContent.innerHTML = `
    <section class="panel">
      <div class="panel-heading">
        <h2>Véhicules</h2>
        <input id="vehicle-search" class="search" type="search" placeholder="Rechercher client, marque, plaque…" />
      </div>
      <div id="vehicle-table"></div>
    </section>
  `;

  const table = document.getElementById('vehicle-table');
  const filter = () => {
    const query = document.getElementById('vehicle-search').value.toLowerCase();
    const filtered = appState.vehicles.filter((vehicle) => [vehicle.clientName, vehicle.brand, vehicle.model, vehicle.plate].join(' ').toLowerCase().includes(query));
    table.innerHTML = renderVehicleRows(filtered);
  };

  document.getElementById('vehicle-search').addEventListener('input', filter);
  filter();
}

function renderVehicleRows(list) {
  if (!list.length) {
    return '<p class="empty">Aucun dossier correspondant.</p>';
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Véhicule</th>
            <th>Client</th>
            <th>Prévu</th>
            <th>Statut</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((vehicle) => `
            <tr>
              <td><strong>${esc(vehicle.brand)} ${esc(vehicle.model)}</strong><small>${esc(vehicle.plate)}</small></td>
              <td>${esc(vehicle.clientName)}<small>${esc(vehicle.phone)}</small></td>
              <td>${formatDate(vehicle.plannedDate)}</td>
              <td><span class="badge ${statusClass(vehicle.status)}">${esc(vehicle.status)}</span></td>
              <td><button class="text-btn" data-action="open" data-id="${vehicle.id}">Dossier</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOrders() {
  const selected = appState.vehicles.find((v) => v.id === appState.selectedVehicleId) || appState.vehicles[0];

  appContent.innerHTML = `
    <section class="two-col">
      <div class="panel">
        <div class="panel-heading">
          <h2>Dossiers atelier</h2>
        </div>
        ${renderVehicleRows(appState.vehicles)}
      </div>
      <div class="panel">
        ${selected ? orderDetail(selected) : '<p class="empty">Aucun véhicule.</p>'}
      </div>
    </section>
  `;
}

function orderDetail(vehicle) {
  return `
    <div class="panel-heading">
      <div>
        <h2>${esc(vehicle.brand)} ${esc(vehicle.model)}</h2>
        <p class="muted">${esc(vehicle.clientName)} · ${esc(vehicle.plate)}</p>
      </div>
      <button class="secondary-btn" data-action="edit" data-id="${vehicle.id}">Modifier</button>
    </div>

    <div class="detail-block">
      <b>Travail demandé</b>
      <p>${esc(vehicle.workRequested || '—')}</p>
    </div>

    <div class="detail-block">
      <b>Travail effectué / notes</b>
      <p>${esc(vehicle.workDone || 'À renseigner')}</p>
    </div>

    <div class="detail-block">
      <b>Tâches</b>
      ${vehicle.tasks?.length ? `<ul>${vehicle.tasks.map((task) => `<li>${esc(task)}</li>`).join('')}</ul>` : '<p class="muted">Aucune tâche.</p>'}
    </div>

    <div class="detail-block">
      <b>Pièces remplacées</b>
      ${vehicle.parts?.length ? `<ul>${vehicle.parts.map((part) => `<li>${esc(part)}</li>`).join('')}</ul>` : '<p class="muted">Aucune pièce.</p>'}
    </div>

    <div class="detail-block">
      <b>Kilométrage</b>
      <p>Entrée : ${Number(vehicle.mileageIn || 0).toLocaleString('fr-FR')} km</p>
      <p>Sortie : ${Number(vehicle.mileageOut || 0).toLocaleString('fr-FR')} km</p>
      <p>Différence : ${(Number(vehicle.mileageOut || 0) - Number(vehicle.mileageIn || 0)).toLocaleString('fr-FR')} km</p>
    </div>

    <div class="detail-block">
      <label class="inline-label">
        <span>Statut</span>
        <select data-action="status" data-id="${vehicle.id}">
          ${['À planifier', 'En cours', 'En attente client', 'Prêt à récupérer', 'Clôturé'].map((status) => `<option ${vehicle.status === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
      </label>
    </div>

    <div class="button-row">
      <button class="secondary-btn" data-action="edit" data-id="${vehicle.id}">Mettre à jour</button>
      <button class="primary-btn" data-action="ready" data-id="${vehicle.id}">Valider et SMS</button>
    </div>
  `;
}

function renderQuotes() {
  const rows = appState.vehicles.flatMap((vehicle) => (vehicle.quotes || []).map((quote) => ({ vehicle, quote })));

  appContent.innerHTML = `
    <section class="panel">
      <div class="panel-heading">
        <h2>Devis complémentaires</h2>
      </div>
      ${rows.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Véhicule</th>
                <th>Anomalie</th>
                <th>Montant</th>
                <th>Décision</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(({ vehicle, quote }) => `
                <tr>
                  <td><strong>${esc(vehicle.brand)} ${esc(vehicle.model)}</strong><small>${esc(vehicle.clientName)}</small></td>
                  <td>${esc(quote.description)}</td>
                  <td>${formatMoney(quote.amount)}</td>
                  <td>
                    <select data-action="quote-decision" data-id="${vehicle.id}" data-quote-id="${quote.id}">
                      ${['En attente', 'Accepté', 'Refusé'].map((decision) => `<option ${decision === quote.decision ? 'selected' : ''}>${decision}</option>`).join('')}
                    </select>
                  </td>
                  <td><button class="text-btn" data-action="sms-quote" data-id="${vehicle.id}" data-quote-id="${quote.id}">SMS</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p class="empty">Aucun devis enregistré.</p>'}
    </section>
  `;
}

function renderPlanning() {
  const mechaniciens = authState.users.filter((u) => u.role === 'mechanic' && u.active !== false);

  appContent.innerHTML = `
    <section class="panel">
      <div class="panel-heading">
        <h2>Planning partagé</h2>
        ${isAdmin() ? '<button class="primary-btn" data-action="new-planning">+ Attribuer un mécanicien</button>' : ''}
      </div>

      <div class="planning-grid">
        ${mechaniciens.map((mechanic) => {
          const events = appState.planning.filter((event) => event.mechanicId === mechanic.id);
          return `
            <div class="planning-card">
              <div class="planning-head">
                <h3>${esc(mechanic.name)}</h3>
                <span class="badge blue">Mécanicien</span>
              </div>
              ${events.length ? events.map((event) => {
                const vehicle = appState.vehicles.find((v) => v.id === event.vehicleId);
                return `
                  <div class="planning-item">
                    <div>
                      <strong>${vehicle ? `${esc(vehicle.brand)} ${esc(vehicle.model)}` : 'Véhicule inconnu'}</strong>
                      <small>${event.date} · ${event.start} à ${event.end}</small>
                    </div>
                    <span>${esc(event.notes || 'Intervention')}</span>
                  </div>
                `;
              }).join('') : '<p class="empty small">Aucune intervention assignée.</p>'}
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderAccounts() {
  if (!isAdmin()) return;

  const users = authState.users.filter((u) => u.role === 'mechanic');

  appContent.innerHTML = `
    <section class="panel">
      <div class="panel-heading">
        <h2>Comptes mécaniciens</h2>
        <button class="primary-btn" data-action="new-account">+ Créer un mécanicien</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Email</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((user) => `
              <tr>
                <td>${esc(user.name)}</td>
                <td>${esc(user.email)}</td>
                <td><span class="badge ${user.active === false ? 'gray' : 'green'}">${user.active === false ? 'Inactif' : 'Actif'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function render() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    renderAuth();
    return;
  }

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === currentView);
  });

  pageTitle.textContent = ({
    dashboard: 'Tableau de bord',
    vehicles: 'Véhicules',
    orders: 'Ordres de travail',
    quotes: 'Devis',
    planning: 'Planning',
    accounts: 'Comptes'
  }[currentView] || 'Tableau de bord');

  switch (currentView) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'vehicles':
      renderVehicles();
      break;
    case 'orders':
      renderOrders();
      break;
    case 'quotes':
      renderQuotes();
      break;
    case 'planning':
      renderPlanning();
      break;
    case 'accounts':
      renderAccounts();
      break;
    default:
      renderDashboard();
      break;
  }
}

function openVehicle(id) {
  appState.selectedVehicleId = id;
  saveAppState();
  setView('orders');
}

function createVehicle(form) {
  const data = new FormData(form);
  const vehicle = {
    id: `veh-${Date.now()}`,
    clientName: data.get('clientName').trim(),
    phone: data.get('phone').trim(),
    brand: data.get('brand').trim(),
    model: data.get('model').trim(),
    plate: data.get('plate').trim().toUpperCase(),
    plannedDate: data.get('plannedDate'),
    status: 'À planifier',
    workRequested: data.get('workRequested').trim(),
    workDone: '',
    tasks: data.get('workRequested').trim() ? data.get('workRequested').trim().split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) : [],
    parts: [],
    quotes: [],
    mileageIn: 0,
    mileageOut: 0,
    notes: 'Dossier créé.'
  };

  appState.vehicles.unshift(vehicle);
  appState.selectedVehicleId = vehicle.id;
  saveAppState();
  form.reset();
  vehicleDialog.close();
  setView('orders');
}

function editVehicle(id) {
  const vehicle = appState.vehicles.find((v) => v.id === id);
  if (!vehicle) return;

  const form = document.getElementById('edit-form');
  form.elements.vehicleId.value = vehicle.id;
  form.elements.status.value = vehicle.status;
  form.elements.workDone.value = vehicle.workDone || '';
  form.elements.parts.value = (vehicle.parts || []).join('\n');
  form.elements.tasks.value = (vehicle.tasks || []).join('\n');
  editDialog.showModal();
}

function saveVehicleEdit(form) {
  const data = new FormData(form);
  const vehicle = appState.vehicles.find((v) => v.id === data.get('vehicleId'));
  if (!vehicle) return;

  vehicle.status = data.get('status');
  vehicle.workDone = data.get('workDone').trim();
  vehicle.parts = data.get('parts').toString().split('\n').map((x) => x.trim()).filter(Boolean);
  vehicle.tasks = data.get('tasks').toString().split('\n').map((x) => x.trim()).filter(Boolean);

  saveAppState();
  form.reset();
  editDialog.close();
  render();
}

function addQuoteToVehicle(form) {
  const data = new FormData(form);
  const vehicle = appState.vehicles.find((v) => v.id === data.get('vehicleId'));
  if (!vehicle) return;

  if (!vehicle.quotes) vehicle.quotes = [];

  vehicle.quotes.push({
    id: `quote-${Date.now()}`,
    description: String(data.get('description')).trim(),
    amount: Number(data.get('amount')) || 0,
    decision: String(data.get('decision'))
  });

  if (String(data.get('decision')) === 'En attente') {
    vehicle.status = 'En attente client';
  }

  saveAppState();
  form.reset();
  quoteDialog.close();
  render();
}

function validateAndPrepareSms(id) {
  const vehicle = appState.vehicles.find((v) => v.id === id);
  if (!vehicle) return;

  vehicle.status = 'Prêt à récupérer';
  saveAppState();

  const message = `Bonjour ${vehicle.clientName}, votre ${vehicle.brand} ${vehicle.model} (${vehicle.plate}) est prêt à être récupéré. Merci de votre confiance.`;
  prepareSms(vehicle.phone, message);
  render();
}

function prepareSms(phone, message) {
  if (!phone) {
    alert('Aucun numéro de téléphone enregistré pour ce dossier.');
    return;
  }

  const smsLink = `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(message)}`;
  window.location.href = smsLink;
}

function createMechanicAccount(form) {
  const data = new FormData(form);
  const name = String(data.get('name')).trim();
  const email = String(data.get('email')).trim();
  const password = String(data.get('password'));

  if (!name || !email || password.length < 6) {
    alert('Merci de renseigner un nom, un email valide et un mot de passe de 6 caractères minimum.');
    return;
  }

  const exists = authState.users.some((u) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    alert('Un compte existe déjà avec cette adresse email.');
    return;
  }

  authState.users.push({
    id: `m-${Date.now()}`,
    name,
    email,
    password,
    role: 'mechanic',
    active: true
  });

  saveAuthState();
  form.reset();
  createAccountDialog.close();
  setView('accounts');
}

function addPlanningEvent(form) {
  const data = new FormData(form);
  const vehicleId = String(data.get('vehicleId'));
  const mechanicId = String(data.get('mechanicId'));
  const date = String(data.get('date'));
  const start = String(data.get('start'));
  const end = String(data.get('end'));
  const notes = String(data.get('notes')).trim();

  if (!vehicleId || !mechanicId || !date || !start || !end) {
    alert('Merci de renseigner tous les champs de planification.');
    return;
  }

  if (start >= end) {
    alert('L’heure de fin doit être postérieure à l’heure de début.');
    return;
  }

  const overlaps = appState.planning.some((event) => {
    if (event.mechanicId !== mechanicId || event.id === 'new') return false;
    if (event.date !== date) return false;

    return !(end <= event.start || start >= event.end);
  });

  if (overlaps) {
    alert('Conflit de planning : ce mécanicien a déjà une intervention sur cette plage horaire.');
    return;
  }

  appState.planning.push({
    id: `plan-${Date.now()}`,
    vehicleId,
    mechanicId,
    date,
    start,
    end,
    notes
  });

  saveAppState();
  form.reset();
  planningDialog.close();
  setView('planning');
}

function openNewPlanningDialog() {
  const vehicleSelect = document.getElementById('planning-vehicle-id');
  const mechanicSelect = document.getElementById('planning-mechanic-id');

  vehicleSelect.innerHTML = appState.vehicles.map((vehicle) => `<option value="${vehicle.id}">${esc(vehicle.brand)} ${esc(vehicle.model)} · ${esc(vehicle.plate)}</option>`).join('');
  mechanicSelect.innerHTML = authState.users.filter((u) => u.role === 'mechanic' && u.active !== false).map((mechanic) => `<option value="${mechanic.id}">${esc(mechanic.name)}</option>`).join('');

  planningDialog.showModal();
}

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => setView(item.dataset.view));
  });

  document.querySelectorAll('[data-action="close-dialog"]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });

  document.querySelectorAll('[data-action="new-vehicle"]').forEach((button) => {
    button.addEventListener('click', () => vehicleDialog.showModal());
  });

  document.querySelectorAll('[data-action="new-account"]').forEach((button) => {
    button.addEventListener('click', () => createAccountDialog.showModal());
  });

  document.querySelectorAll('[data-action="new-planning"]').forEach((button) => {
    button.addEventListener('click', () => openNewPlanningDialog());
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;

    const action = trigger.dataset.action;
    const id = trigger.dataset.id;

    if (action === 'open') openVehicle(id);
    if (action === 'edit') editVehicle(id);
    if (action === 'ready') validateAndPrepareSms(id);
    if (action === 'sms-quote') {
      const vehicle = appState.vehicles.find((v) => v.id === id);
      const quote = vehicle?.quotes?.find((q) => q.id === trigger.dataset.quoteId);
      if (vehicle && quote) {
        const message = `Bonjour ${vehicle.clientName}, nous avons constaté : ${quote.description} Le montant estimé est de ${formatMoney(quote.amount)}. Merci de nous confirmer votre accord.`;
        prepareSms(vehicle.phone, message);
      }
    }
    if (action === 'new-account') createAccountDialog.showModal();
    if (action === 'new-planning') openNewPlanningDialog();
  });

  document.addEventListener('change', (event) => {
    const element = event.target;

    if (element.dataset.action === 'status') {
      const vehicle = appState.vehicles.find((v) => v.id === element.dataset.id);
      if (!vehicle) return;
      vehicle.status = element.value;
      saveAppState();
      render();
    }

    if (element.dataset.action === 'quote-decision') {
      const vehicle = appState.vehicles.find((v) => v.id === element.dataset.id);
      if (!vehicle) return;
      const quote = vehicle.quotes?.find((q) => q.id === element.dataset.quoteId);
      if (!quote) return;
      quote.decision = element.value;
      saveAppState();
      render();
    }
  });

  document.getElementById('vehicle-form').addEventListener('submit', (event) => {
    event.preventDefault();
    createVehicle(event.currentTarget);
  });

  document.getElementById('quote-form').addEventListener('submit', (event) => {
    event.preventDefault();
    addQuoteToVehicle(event.currentTarget);
  });

  document.getElementById('edit-form').addEventListener('submit', (event) => {
    event.preventDefault();
    saveVehicleEdit(event.currentTarget);
  });

  document.getElementById('planning-form').addEventListener('submit', (event) => {
    event.preventDefault();
    addPlanningEvent(event.currentTarget);
  });

  document.getElementById('create-account-form').addEventListener('submit', (event) => {
    event.preventDefault();
    createMechanicAccount(event.currentTarget);
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    authState.currentUserId = null;
    saveAuthState();
    renderAuth();
  });
}

bindNavigation();
renderAuth();
