(() => {
  'use strict';
  const cfg = window.ATELIERFLOW_CONFIG;
  const rememberPreferenceKey = 'atelierflow-remember-session';
  let rememberSession = localStorage.getItem(rememberPreferenceKey) !== 'false';
  const authStorage = {
    getItem: (key) => (rememberSession ? localStorage : sessionStorage).getItem(key),
    setItem: (key, value) => (rememberSession ? localStorage : sessionStorage).setItem(key, value),
    removeItem: (key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  };
  const client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage }
  });
  const $ = (s) => document.querySelector(s);
  const STATUS = {
    queued: 'À planifier', in_progress: 'En cours',
    awaiting_customer: 'En attente client', ready_for_pickup: 'Prêt à récupérer',
    closed: 'Clôturé', cancelled: 'Annulé', draft: 'Brouillon'
  };
  const TO_DB = {
    'À planifier':'queued', 'En cours':'in_progress',
    'En attente client':'awaiting_customer', 'Prêt à récupérer':'ready_for_pickup',
    'Annulé':'cancelled'
  };
  let user = null, garageId = null, garageName = '', garageDetails = {}, records = [], view = 'dashboard', selectedId = null;
  let signupMode = false;
  let inspectionSaveQueue=Promise.resolve(), inspectionAttachmentQueue=Promise.resolve();
  let language = 'fr';
  localStorage.setItem('atelierflow-language','fr');
  const I18N = {
    fr:{dashboard:'Tableau de bord',vehicles:'Véhicules',orders:'Ordres de travail',quotes:'Devis',planning:'Planning atelier',team:'Équipe & administration',settings:'Paramètres',active:'Dossiers actifs',ongoing:'En cours',pending:'Devis en attente',ready:'Prêts à récupérer',activity:'Activité atelier',allVehicles:'Tous les véhicules',schedule:'Planning de l’atelier',scheduleHint:'Une ligne par membre de l’équipe · créneaux positionnés par heure',settingsTitle:'Paramètres généraux',language:'Langue de l’interface',languageHint:'Le choix est enregistré sur cet appareil.',save:'Enregistrer les préférences',saved:'Préférences enregistrées.'},
    nl:{dashboard:'Dashboard',vehicles:'Voertuigen',orders:'Werkorders',quotes:'Offertes',planning:'Werkplaatsplanning',team:'Team & beheer',settings:'Instellingen',active:'Actieve dossiers',ongoing:'In uitvoering',pending:'Openstaande offertes',ready:'Klaar om op te halen',activity:'Werkplaatsactiviteit',allVehicles:'Alle voertuigen',schedule:'Werkplaatsplanning',scheduleHint:'Eén rij per teamlid · tijdsblokken per uur',settingsTitle:'Algemene instellingen',language:'Taal van de interface',languageHint:'Deze keuze wordt op dit apparaat opgeslagen.',save:'Voorkeuren opslaan',saved:'Voorkeuren opgeslagen.'},
    en:{dashboard:'Dashboard',vehicles:'Vehicles',orders:'Work orders',quotes:'Quotes',planning:'Workshop schedule',team:'Team & administration',settings:'Settings',active:'Active jobs',ongoing:'In progress',pending:'Pending quotes',ready:'Ready for pickup',activity:'Workshop activity',allVehicles:'All vehicles',schedule:'Workshop schedule',scheduleHint:'One row per team member · time slots by hour',settingsTitle:'General settings',language:'Interface language',languageHint:'Your choice is saved on this device.',save:'Save preferences',saved:'Preferences saved.'}
  };
  function t(key){return (I18N[language]||I18N.fr)[key]||I18N.fr[key]||key;}
  function syncLanguageShell(){document.documentElement.lang=language;document.querySelectorAll('.nav-item').forEach(b=>{b.textContent=t(b.dataset.view);});}
  let membershipRole='mechanic', staff=[], appointments=[], appointmentAssignments=[], mechanicProfiles=[], checklistTemplate=null, checklistCategories=[], checklistItems=[], activeInspection=null, inspectionResults=[], inspections=[], inspectionAttachments=[];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function money(v) { return new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(Number(v)||0); }
  function date(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-BE',{day:'2-digit',month:'short',year:'numeric'}).format(d);
  }
  function localDateTime(v) {
    if (!v) return null;
    return new Date(v + 'T12:00:00').toISOString();
  }
  function notice(id, msg, type) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'notice ' + (type || '');
    el.hidden = false;
  }
  function showScreen(which) {
    $('#auth-screen').hidden = which !== 'auth';
    $('#garage-screen').hidden = which !== 'garage';
    $('#application').hidden = which !== 'app';
  }
  function errorMessage(err) {
    const msg = err && err.message ? err.message : String(err || 'Erreur inconnue');
    if (/Invalid login credentials/i.test(msg)) return 'Adresse e-mail ou mot de passe incorrect.';
    if (/Email not confirmed/i.test(msg)) return 'Confirmez votre adresse e-mail depuis le message reçu avant de vous connecter.';
    if (/duplicate key|unique constraint/i.test(msg)) return 'Cette opération existe déjà ou a déjà été effectuée.';
    return msg;
  }

  $('#password-setup-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f=ev.currentTarget, password=f.elements.password.value, confirmation=f.elements.confirm_password.value;
    const btn=f.querySelector('button[type=submit]');
    if(password.length<8){notice('#password-setup-message','Le mot de passe doit contenir au moins 8 caractères.','error');return;}
    if(password!==confirmation){notice('#password-setup-message','Les deux mots de passe ne correspondent pas.','error');return;}
    btn.disabled=true;btn.textContent='Enregistrement…';
    try{
      const {error}=await client.auth.updateUser({password});
      if(error)throw error;
      history.replaceState({},document.title,window.location.pathname);
      notice('#password-setup-message','Mot de passe enregistré. Connexion à votre atelier…','success');
      await continueAfterAuth();
    }catch(err){notice('#password-setup-message',errorMessage(err),'error');btn.disabled=false;btn.textContent='Enregistrer mon mot de passe';}
  });

  $('#toggle-signup').addEventListener('click', () => {
    signupMode = !signupMode;
    $('#name-field').hidden = !signupMode;
    $('#password-field').hidden = signupMode;
    $('#auth-form').elements.password.required = !signupMode;
    $('#auth-submit').textContent = signupMode ? 'Envoyer ma demande' : 'Se connecter';
    $('#toggle-signup').textContent = signupMode ? 'J’ai déjà un compte' : 'Demander un accès';
    $('#auth-form').elements.password.autocomplete = 'current-password';
    $('#remember-field').hidden = signupMode;
    $('#auth-message').hidden = true;
  });

  $('#auth-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget, email = f.elements.email.value.trim(), password = f.elements.password.value;
    rememberSession = signupMode ? true : f.elements.remember_session.checked;
    localStorage.setItem(rememberPreferenceKey, rememberSession ? 'true' : 'false');
    const btn = $('#auth-submit');
    btn.disabled = true; btn.textContent = 'Veuillez patienter…';
    try {
      if (signupMode) {
        const fullName = f.elements.full_name.value.trim();
        if (!fullName) throw new Error('Indiquez votre nom complet.');
        const { data, error } = await client.functions.invoke('access-requests', {
          body: { action: 'submit', fullName, email }
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        notice('#auth-message', data?.message || 'Votre demande a été envoyée à l’administration.', 'success');
        f.reset();
      } else {
        const result = await client.auth.signInWithPassword({email,password});
        if (result.error) throw result.error;
        user = result.data.user;
        await continueAfterAuth();
      }
    } catch (err) {
      notice('#auth-message',errorMessage(err),'error');
    } finally {
      btn.disabled = false;
      btn.textContent = signupMode ? 'Créer mon compte' : 'Se connecter';
    }
  });

  async function continueAfterAuth() {
    const {data:{user:authUser},error:userError} = await client.auth.getUser();
    if (userError) throw userError;
    user = authUser;
    const {data: memberships,error} = await client.from('garage_memberships')
      .select('garage_id, role, is_active').eq('profile_id',user.id).eq('is_active',true);
    if (error) throw error;
    if (!memberships || memberships.length === 0) {
      showScreen('garage');
      return;
    }
    garageId = memberships[0].garage_id;
    membershipRole = memberships[0].role || 'mechanic';
    const {data:garage,error:garageError} = await client.from('garages').select('*').eq('id',garageId).single();
    if (garageError) throw garageError;
    garageName = garage.name;
    garageDetails = garage;
    view = membershipRole === 'admin' ? 'dashboard' : 'planning';
    await enterApp();
  }

  $('#garage-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f=ev.currentTarget, d=new FormData(f), btn=f.querySelector('button[type=submit]');
    btn.disabled=true; btn.textContent='Création…';
    try {
      const {data,error}=await client.rpc('create_garage_with_admin',{
        p_name:String(d.get('name')).trim(),
        p_address:String(d.get('address')||'').trim()||null,
        p_city:String(d.get('city')||'').trim()||null,
        p_postal_code:String(d.get('postal_code')||'').trim()||null,
        p_phone:String(d.get('phone')||'').trim()||null,
        p_email:String(d.get('email')||'').trim()||null,
        p_timezone:'Europe/Brussels'
      });
      if(error) throw error;
      garageId=data;
      garageName=String(d.get('name')).trim();
      await enterApp();
    } catch(err) {
      notice('#garage-message',errorMessage(err),'error');
    } finally { btn.disabled=false; btn.textContent='Créer mon espace atelier'; }
  });

  async function signOut() {
    await client.auth.signOut();
    user=null; garageId=null; records=[];
    showScreen('auth');
  }
  $('#garage-signout').addEventListener('click',signOut);
  $('#signout').addEventListener('click',signOut);

  async function enterApp() {
    showScreen('app');
    syncLanguageShell();
    $('#garage-label').textContent=garageName+' · Synchronisé en ligne';
    await loadRecords();
    if(isAdmin()) await ensureChecklist();
    render();
  }

  async function loadRecords() {
    $('#app').innerHTML='<p class="empty">Synchronisation des données…</p>';
    if (!isAdmin()) {
      const results = await Promise.all([
        client.from('clients').select('*').eq('garage_id',garageId),
        client.from('vehicles').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
        client.from('work_orders').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
        client.from('appointments').select('*').eq('garage_id',garageId).order('starts_at'),
        client.from('appointment_mechanics').select('*').eq('garage_id',garageId),
        client.from('mechanic_profiles').select('*').eq('garage_id',garageId),
        client.from('garage_memberships').select('id,profile_id,role,is_active').eq('garage_id',garageId),
        client.from('profiles').select('id,full_name,is_active'),
        client.from('inspections').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
        client.from('quotes').select('*').eq('garage_id',garageId).order('created_at',{ascending:false})
      ]);
      for (const r of results) if (r.error) throw r.error;
      const clients=results[0].data||[], vehicles=results[1].data||[], orders=results[2].data||[];
      appointments=results[3].data||[]; appointmentAssignments=results[4].data||[]; mechanicProfiles=results[5].data||[];
      const memberships=results[6].data||[], profiles=results[7].data||[];
      inspections=results[8].data||[];
      const mechanicQuotes=results[9].data||[];
      const mechanicQuoteItems=mechanicQuotes.length?(await client.from('quote_items').select('*').in('quote_id',mechanicQuotes.map(q=>q.id))).data||[]:[];
      staff=memberships.map(m=>({profileId:m.profile_id,role:m.role,is_active:m.is_active,profile:profiles.find(p=>p.id===m.profile_id)||{},mechanic:mechanicProfiles.find(mp=>mp.profile_id===m.profile_id)||null}));
      records=vehicles.map(v=>{
        const c=clients.find(x=>x.id===v.client_id)||{}, o=orders.find(x=>x.vehicle_id===v.id)||{};
        const name=[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company_name||'Client';
        const noteLines=String(o.conclusion||'').split('\\n');
        return {
          id:v.id,clientId:c.id,orderId:o.id,clientName:name,
          clientFirstName:c.first_name||'',clientLastName:c.last_name||'',clientCompanyName:c.company_name||'',
          phone:c.phone||'',email:c.email||'',clientAddress:c.address||'',clientNotes:c.notes||'',
          brand:v.brand||'',model:v.model||'',plate:v.registration_number||'',vin:v.vin||'',color:v.color||'',
          year:v.year??'',fuelType:v.fuel_type||'',mileageCurrent:v.mileage_current??0,vehicleNotes:v.notes||'',
          plannedDate:o.planned_start,status:STATUS[o.status]||'À planifier',workRequested:o.description||'',
          workDone:noteLines[0]||'',tasks:noteLines.slice(1).filter(Boolean),parts:[],
          quotes:mechanicQuotes.filter(q=>q.vehicle_id===v.id).map(q=>({...q,items:mechanicQuoteItems.filter(it=>it.quote_id===q.id)}))
        };
      });
      return;
    }
    const results = await Promise.all([
      client.from('clients').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('vehicles').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('work_orders').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('quotes').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('appointments').select('*').eq('garage_id',garageId).order('starts_at'),
      client.from('appointment_mechanics').select('*').eq('garage_id',garageId),
      client.from('mechanic_profiles').select('*').eq('garage_id',garageId),
      client.from('garage_memberships').select('id,profile_id,role,is_active').eq('garage_id',garageId).eq('is_active',true),
      client.from('profiles').select('id,full_name,is_active'),
      client.from('inspections').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('quote_items').select('*')
    ]);
    for (const r of results) if (r.error) throw r.error;
    const clients=results[0].data||[], vehicles=results[1].data||[], orders=results[2].data||[], quotes=results[3].data||[];
    appointments=results[4].data||[]; appointmentAssignments=results[5].data||[]; mechanicProfiles=results[6].data||[]; inspections=results[9].data||[]; const quoteItems=results[10].data||[];
    const memberships=results[7].data||[], profiles=results[8].data||[];
    staff=memberships.map(m=>({profileId:m.profile_id,role:m.role,profile:profiles.find(p=>p.id===m.profile_id)||{},mechanic:mechanicProfiles.find(mp=>mp.profile_id===m.profile_id)||null}));
    records=vehicles.map(v=>{
      const c=clients.find(x=>x.id===v.client_id)||{};
      const o=orders.find(x=>x.vehicle_id===v.id)||{};
      const qs=quotes.filter(q=>q.vehicle_id===v.id).map(q=>({
        id:q.id, quote_number:q.quote_number, title:q.title, description:q.title, amount:q.amount,
        decision:({pending:'En attente',accepted:'Accepté',rejected:'Refusé',expired:'Expiré'})[q.status]||'En attente',
        createdAt:q.created_at, items:quoteItems.filter(it=>it.quote_id===q.id)
      }));
      const name=[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company_name||'Client';
      const status=STATUS[o.status]||'À planifier';
      const noteLines=String(o.conclusion||'').split('\\n');
      return {
        id:v.id, clientId:c.id, orderId:o.id, clientName:name,
        clientFirstName:c.first_name||'', clientLastName:c.last_name||'', clientCompanyName:c.company_name||'',
        phone:c.phone||'', email:c.email||'', clientAddress:c.address||'', clientNotes:c.notes||'',
        brand:v.brand||'', model:v.model||'', plate:v.registration_number||'', vin:v.vin||'', color:v.color||'',
        year:v.year??'', fuelType:v.fuel_type||'', mileageCurrent:v.mileage_current??0, vehicleNotes:v.notes||'',
        plannedDate:o.planned_start, status, workRequested:o.description||'', workDone:noteLines[0]||'',
        tasks:noteLines.slice(1).filter(Boolean), parts:[], quotes:qs
      };
    });
    if (selectedId && !records.some(v=>v.id===selectedId)) selectedId=null;
  }

  function activeVehicles(){return records.filter(v=>v.status!=='Clôturé'&&v.status!=='Annulé');}
  function statusClass(s){return {'En cours':'blue','En attente client':'amber','Prêt à récupérer':'green','Clôturé':'gray','Annulé':'gray'}[s]||'gray';}
  function vehicleRows(list) {
    if(!list.length)return '<p class="empty">Aucun dossier enregistré pour le moment.</p>';
    return '<div class="table-wrap"><table><thead><tr><th>Véhicule</th><th>Client</th><th>Prévu</th><th>Statut</th><th></th></tr></thead><tbody>'+
      list.map(v=>'<tr><td><strong>'+esc(v.brand)+' '+esc(v.model)+'</strong><small>'+esc(v.plate)+'</small></td><td>'+esc(v.clientName)+'<small>'+esc(v.phone)+'</small></td><td>'+date(v.plannedDate)+'</td><td><span class="badge '+statusClass(v.status)+'">'+esc(v.status)+'</span></td><td><button class="text-btn" data-action="open" data-id="'+esc(v.id)+'">Dossier</button></td></tr>').join('')+
      '</tbody></table></div>';
  }
  function render() {
    document.querySelectorAll('.nav-item').forEach(b=>{ b.hidden = !isAdmin() ? b.dataset.view !== 'planning' : false; });
    $('#new-vehicle').hidden = !isAdmin();
    if (!isAdmin() && view !== 'planning') view='planning';
    const titles={dashboard:t('dashboard'),vehicles:t('vehicles'),orders:t('orders'),quotes:t('quotes'),planning:t('planning'),handoffs:'Véhicules à remettre',archives:'Historique',team:t('team'),settings:t('settings')};
    $('#page-title').textContent=titles[view]||titles.dashboard;
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    if(view==='dashboard') {
      const pending=records.reduce((n,v)=>n+v.quotes.filter(q=>q.decision==='En attente').length,0);
      $('#app').innerHTML='<section class="stats"><article><span>'+t('active')+'</span><strong>'+activeVehicles().length+'</strong></article><article><span>'+t('ongoing')+'</span><strong>'+records.filter(v=>v.status==='En cours').length+'</strong></article><article><span>'+t('pending')+'</span><strong>'+pending+'</strong></article><article><span>'+t('ready')+'</span><strong>'+records.filter(v=>v.status==='Prêt à récupérer').length+'</strong></article></section><div class="dashboard-grid"><section class="panel dashboard-main"><div class="panel-heading"><div><h2>'+t('schedule')+'</h2><p class="muted">'+t('scheduleHint')+'</p></div><button class="secondary-btn" data-view-action="planning">Voir le planning complet</button></div><div id="dashboard-planning"></div></section><section class="panel dashboard-side"><div class="panel-heading"><h2>'+t('activity')+'</h2><button class="secondary-btn" data-view-action="vehicles">'+t('allVehicles')+'</button></div>'+vehicleRows(activeVehicles())+'</section></div>';renderWorkshopPlanning('#dashboard-planning',true);
    } else if(view==='vehicles') {
      $('#app').innerHTML='<section class="panel"><div class="panel-heading"><h2>Tous les dossiers</h2><input id="vehicle-search" class="search" type="search" placeholder="Rechercher client, véhicule, immatriculation…"></div><div id="vehicle-table">'+vehicleRows(records)+'</div></section>';
      $('#vehicle-search').addEventListener('input',e=>{const q=e.target.value.toLocaleLowerCase('fr');$('#vehicle-table').innerHTML=vehicleRows(records.filter(v=>[v.clientName,v.brand,v.model,v.plate].some(x=>String(x||'').toLocaleLowerCase('fr').includes(q))));});
    } else if(view==='orders') {
      const selected=records.find(v=>v.id===selectedId)||records[0];
      $('#app').innerHTML='<section class="two-col"><div class="panel"><div class="panel-heading"><h2>Dossiers atelier</h2></div>'+vehicleRows(activeVehicles())+'</div><div class="panel">'+(selected?orderDetail(selected):'<p class="empty">Créez un dossier pour commencer.</p>')+'</div></section>';
    } else if(view==='quotes') {
      const rows=[];records.forEach(v=>v.quotes.forEach(q=>rows.push({v,q})));
      $('#app').innerHTML='<section class="panel"><div class="panel-heading"><h2>Devis complémentaires</h2></div>'+(rows.length?'<div class="table-wrap"><table><thead><tr><th>Véhicule / client</th><th>Proposition</th><th>Montant</th><th>Décision</th></tr></thead><tbody>'+rows.map(x=>'<tr><td><strong>'+esc(x.v.brand)+' '+esc(x.v.model)+'</strong><small>'+esc(x.v.clientName)+'</small></td><td>'+esc(x.q.description)+'</td><td>'+money(x.q.amount)+'</td><td><select data-action="quote-status" data-id="'+esc(x.q.id)+'"><option value="pending" '+(x.q.decision==='En attente'?'selected':'')+'>En attente</option><option value="accepted" '+(x.q.decision==='Accepté'?'selected':'')+'>Accepté</option><option value="rejected" '+(x.q.decision==='Refusé'?'selected':'')+'>Refusé</option></select></td></tr>').join('')+'</tbody></table></div>':'<p class="empty">Aucun devis enregistré.</p>')+'</section>';
    } else if(view==='planning') { renderWorkshopPlanning(); }
    else if(view==='archives') { renderArchives(); }
    else if(view==='handoffs') { renderHandoffs(); }
    else if(view==='team') { renderTeam(); }
    else if(view==='settings') { renderSettings(); }
  }
  function renderHandoffs(){
    const pending=inspections.filter(i=>i.status==='submitted');
    const rows=pending.map(i=>{
      const v=records.find(x=>x.orderId===i.work_order_id);if(!v)return '';
      const quoteHtml=v.quotes.length?v.quotes.map(q=>'<div class="detail-block"><b>Devis '+esc(q.quote_number||'')+' — '+esc(q.title)+'</b><p>'+q.items.map(it=>esc(it.description)+' · '+esc(it.quantity)+' × '+money(it.unit_price)+' = '+money(it.total_price)).join('<br>')+'</p><strong>Total : '+money(q.amount)+'</strong></div>').join(''):'<p class="muted">Aucun devis joint à ce dossier.</p>';
      return '<article class="team-row"><div><b>'+esc(v.brand+' '+v.model)+' · '+esc(v.plate)+'</b><small>'+esc(v.clientName)+' · Contrôle transmis le '+date(i.updated_at||i.created_at)+'</small></div><div>'+quoteHtml+'</div><div class="team-actions"><button class="secondary-btn" data-action="review-inspection" data-work-order-id="'+esc(i.work_order_id)+'">Voir le contrôle</button><button class="primary-btn" data-action="open-client-message" data-id="'+esc(v.id)+'">Préparer SMS / e-mail et archiver</button></div></article>';
    }).join('');
    $('#app').innerHTML='<section class="panel"><div class="panel-heading"><div><h2>Véhicules transmis par les mécaniciens</h2><p class="muted">Vérifiez le contrôle, contactez le client, puis archivez le dossier.</p></div></div>'+(rows||'<p class="empty">Aucun véhicule en attente de remise.</p>')+'</section>';
  }
  function renderArchives(){
    const archived=records.filter(v=>v.status==='Clôturé');
    $('#app').innerHTML='<section class="panel"><div class="panel-heading"><div><h2>Historique des véhicules</h2><p class="muted">Dossiers terminés, remis aux clients et archivés.</p></div></div>'+vehicleRows(archived)+'</section>';
  }
  function orderDetail(v) {
    const statusOptions=['À planifier','En cours','En attente client','Prêt à récupérer','Annulé'];
    return '<div class="panel-heading"><div><h2>'+esc(v.brand)+' '+esc(v.model)+'</h2><p class="muted">'+esc(v.clientName)+' · '+esc(v.plate)+'</p></div><button class="secondary-btn" data-action="edit" data-id="'+esc(v.id)+'">Modifier</button></div>'+
      '<div class="detail-block"><b>Travail demandé</b><p>'+esc(v.workRequested||'—')+'</p></div><div class="detail-block"><b>Travail effectué / notes</b><p>'+esc(v.workDone||'À renseigner')+'</p></div>'+
      '<div class="detail-block"><label class="inline-label">Statut <select data-action="status" data-id="'+esc(v.id)+'">'+statusOptions.map(s=>'<option '+(v.status===s?'selected':'')+'>'+s+'</option>').join('')+'</select></label></div>'+
      '<div class="button-row"><button class="secondary-btn" data-action="edit" data-id="'+esc(v.id)+'">Mettre à jour l’ordre</button><button class="primary-btn" data-action="add-quote" data-id="'+esc(v.id)+'">Ajouter un devis</button><button class="secondary-btn" data-action="inspection" data-id="'+esc(v.id)+'">Contrôle véhicule</button><button class="primary-btn" data-action="ready" data-id="'+esc(v.id)+'">Préparer SMS</button>'+'</div>';
  }

  function openForm(kind,id) {
    const v=records.find(x=>x.id===id);
    let html='';
    if(kind==='new') {
      html='<dialog id="data-dialog"><form id="data-form"><div class="dialog-head"><h2>Nouveau dossier véhicule</h2><button class="icon-btn" type="button" data-action="close">×</button></div><div class="form-grid">'+
      '<label>Nom du client<input name="clientName" required maxlength="100"></label><label>Téléphone<input name="phone" type="tel" maxlength="40"></label><label>E-mail client<input name="email" type="email" maxlength="200"></label><label>Marque<input name="brand" required maxlength="60"></label><label>Modèle<input name="model" required maxlength="60"></label><label>Immatriculation<input name="plate" required maxlength="30"></label><label>Date prévue<input name="plannedDate" type="date"></label><label class="full">Travail demandé<textarea name="workRequested" rows="3" maxlength="1500"></textarea></label></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Créer le dossier</button></div></form></dialog>';
    } else if(kind==='edit' && v) {
      html='<dialog id="data-dialog"><form id="data-form"><div class="dialog-head"><h2>Modifier le dossier complet</h2><button class="icon-btn" type="button" data-action="close">×</button></div><input type="hidden" name="id" value="'+esc(v.id)+'"><div class="form-grid">'+
      '<h3 class="full">Coordonnées du client</h3><label>Prénom<input name="clientFirstName" maxlength="100" value="'+esc(v.clientFirstName)+'"></label><label>Nom<input name="clientLastName" maxlength="100" value="'+esc(v.clientLastName)+'"></label><label class="full">Société (si applicable)<input name="clientCompanyName" maxlength="160" value="'+esc(v.clientCompanyName)+'"></label><label>Téléphone<input name="phone" type="tel" maxlength="40" value="'+esc(v.phone)+'"></label><label>E-mail<input name="email" type="email" maxlength="200" value="'+esc(v.email)+'"></label><label class="full">Adresse du client<input name="clientAddress" maxlength="250" value="'+esc(v.clientAddress)+'"></label><label class="full">Notes sur le client<textarea name="clientNotes" rows="2" maxlength="1500">'+esc(v.clientNotes)+'</textarea></label>'+
      '<h3 class="full">Informations du véhicule</h3><label>Marque<input name="brand" required maxlength="60" value="'+esc(v.brand)+'"></label><label>Modèle<input name="model" required maxlength="60" value="'+esc(v.model)+'"></label><label>Immatriculation<input name="plate" required maxlength="30" value="'+esc(v.plate)+'"></label><label>Numéro de châssis (VIN)<input name="vin" maxlength="40" value="'+esc(v.vin)+'"></label><label>Couleur<input name="color" maxlength="60" value="'+esc(v.color)+'"></label><label>Année<input name="year" type="number" min="1886" max="2100" step="1" value="'+esc(v.year)+'"></label><label>Carburant<input name="fuelType" maxlength="40" value="'+esc(v.fuelType)+'"></label><label>Kilométrage actuel<input name="mileageCurrent" type="number" min="0" step="1" value="'+esc(v.mileageCurrent)+'"></label><label class="full">Notes sur le véhicule<textarea name="vehicleNotes" rows="2" maxlength="1500">'+esc(v.vehicleNotes)+'</textarea></label>'+
      '<h3 class="full">Intervention et suivi</h3><label class="full">Travail demandé<textarea name="workRequested" rows="3" maxlength="1500">'+esc(v.workRequested)+'</textarea></label><label class="full">Travail effectué / notes<textarea name="workDone" rows="4">'+esc(v.workDone)+'</textarea></label><label class="full">Tâches / opérations réalisées (une par ligne)<textarea name="tasks" rows="4">'+esc(v.tasks.join('\n'))+'</textarea></label></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Enregistrer les modifications</button></div></form></dialog>';
    } else if(kind==='quote' && v) {
      html='<dialog id="data-dialog"><form id="data-form"><div class="dialog-head"><h2>Créer le devis du véhicule</h2><button class="icon-btn" type="button" data-action="close">×</button></div><input type="hidden" name="id" value="'+esc(v.id)+'"><div class="form-grid"><label class="full">Titre / diagnostic<textarea name="description" required rows="2" placeholder="Ex. Remplacement des plaquettes avant"></textarea></label><label>Pièce / opération 1<input name="item1" maxlength="160" placeholder="Plaquettes de frein"></label><label>Quantité<input name="qty1" type="number" min="0.01" max="1000000" step="0.01" value="1"></label><label>Prix unitaire (€)<input name="price1" type="number" min="0" max="1000000000" step="0.01" value="0"></label><label>Pièce / opération 2<input name="item2" maxlength="160"></label><label>Quantité<input name="qty2" type="number" min="0.01" max="1000000" step="0.01" value="1"></label><label>Prix unitaire (€)<input name="price2" type="number" min="0" max="1000000000" step="0.01" value="0"></label><label>Pièce / opération 3<input name="item3" maxlength="160"></label><label>Quantité<input name="qty3" type="number" min="0.01" max="1000000" step="0.01" value="1"></label><label>Prix unitaire (€)<input name="price3" type="number" min="0" max="1000000000" step="0.01" value="0"></label><label>Heures de main-d’œuvre<input name="labor_hours" type="number" min="0" max="1000" step="0.25" value="0"></label><label>Taux horaire (€ / h)<input name="labor_rate" type="number" min="0" max="1000000" step="0.01" value="60"></label><p class="muted full">Le total est calculé automatiquement à partir des pièces, opérations et heures de main-d’œuvre.</p></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Enregistrer et joindre au contrôle</button></div></form></dialog>';
    }
    if(!html)return;
    const old=$('#data-dialog'); if(old)old.remove();
    document.body.insertAdjacentHTML('beforeend',html);
    const dlg=$('#data-dialog'); dlg.showModal();
    $('#data-form').addEventListener('submit',async ev=>{
      ev.preventDefault(); const form=ev.currentTarget, data=new FormData(form), submit=form.querySelector('[type=submit]');
      submit.disabled=true; submit.textContent='Enregistrement…';
      try {
        if(kind==='new') await createVehicle(data);
        if(kind==='edit') await saveEdit(data);
        if(kind==='quote') await addQuote(data);
      } catch(err) {
        alert('Impossible d’enregistrer : '+errorMessage(err));
        submit.disabled=false; submit.textContent='Réessayer';
        return;
      }
      dlg.close(); dlg.remove();
      try { await loadRecords(); render(); }
      catch(err) { alert((kind==='quote'?'Le devis a bien été enregistré, mais la liste n’a pas pu être actualisée.':'L’enregistrement a réussi, mais la liste n’a pas pu être actualisée.')+' '+errorMessage(err)); }
    });
  }

  async function createVehicle(d) {
    const name=String(d.get('clientName')).trim().split(/\s+/);
    const first=name.shift()||'Client', last=name.join(' ');
    const {data:c,error:ce}=await client.from('clients').insert({
      garage_id:garageId,first_name:first,last_name:last||null,phone:String(d.get('phone')||'').trim()||null,email:String(d.get('email')||'').trim()||null
    }).select().single();
    if(ce)throw ce;
    const {data:v,error:ve}=await client.from('vehicles').insert({
      garage_id:garageId,client_id:c.id,brand:String(d.get('brand')).trim(),model:String(d.get('model')).trim(),
      registration_number:String(d.get('plate')).trim().toUpperCase(),mileage_current:0
    }).select().single();
    if(ve) { await client.from('clients').delete().eq('id',c.id); throw ve; }
    const {data:o,error:oe}=await client.from('work_orders').insert({
      garage_id:garageId,vehicle_id:v.id,client_id:c.id,created_by:user.id,
      title:'Réparation '+v.brand+' '+v.model,
      description:String(d.get('workRequested')||'').trim()||null,
      status:'queued',planned_start:d.get('plannedDate')?localDateTime(d.get('plannedDate')):null
    }).select().single();
    if(oe) { await client.from('vehicles').delete().eq('id',v.id); await client.from('clients').delete().eq('id',c.id); throw oe; }
    selectedId=v.id;
  }

  async function saveEdit(d) {
    const v=records.find(x=>x.id===d.get('id'));
    if(!v||!v.clientId)throw new Error('Dossier client introuvable.');
    const firstName=String(d.get('clientFirstName')||'').trim();
    const lastName=String(d.get('clientLastName')||'').trim();
    const companyName=String(d.get('clientCompanyName')||'').trim();
    if(!firstName&&!lastName&&!companyName)throw new Error('Indiquez au moins un nom de client ou une société.');
    const yearRaw=String(d.get('year')||'').trim();
    const year=yearRaw?Number(yearRaw):null;
    if(year!==null&&(!Number.isInteger(year)||year<1886||year>2100))throw new Error('Vérifiez l’année du véhicule.');
    const mileageRaw=String(d.get('mileageCurrent')||'').trim();
    const mileageCurrent=mileageRaw?Number(mileageRaw):0;
    if(!Number.isInteger(mileageCurrent)||mileageCurrent<0)throw new Error('Le kilométrage doit être un nombre entier positif.');
    const clientPatch={
      first_name:firstName||null,last_name:lastName||null,company_name:companyName||null,
      phone:String(d.get('phone')||'').trim()||null,email:String(d.get('email')||'').trim()||null,
      address:String(d.get('clientAddress')||'').trim()||null,notes:String(d.get('clientNotes')||'').trim()||null
    };
    const {error:clientError}=await client.from('clients').update(clientPatch).eq('id',v.clientId).eq('garage_id',garageId);
    if(clientError)throw clientError;
    const vehiclePatch={
      brand:String(d.get('brand')||'').trim(),model:String(d.get('model')||'').trim(),
      registration_number:String(d.get('plate')||'').trim().toUpperCase(),
      vin:String(d.get('vin')||'').trim()||null,color:String(d.get('color')||'').trim()||null,
      year,fuel_type:String(d.get('fuelType')||'').trim()||null,mileage_current:mileageCurrent,
      notes:String(d.get('vehicleNotes')||'').trim()||null
    };
    if(!vehiclePatch.brand||!vehiclePatch.model||!vehiclePatch.registration_number)throw new Error('La marque, le modèle et l’immatriculation sont obligatoires.');
    const {error:vehicleError}=await client.from('vehicles').update(vehiclePatch).eq('id',v.id).eq('garage_id',garageId);
    if(vehicleError)throw vehicleError;
    if(v.orderId){
      const conclusion=[String(d.get('workDone')||'').trim(),...String(d.get('tasks')||'').split('\n').map(x=>x.trim()).filter(Boolean)].filter(Boolean).join('\n');
      const {error:orderError}=await client.from('work_orders').update({
        description:String(d.get('workRequested')||'').trim()||null,conclusion
      }).eq('id',v.orderId).eq('garage_id',garageId);
      if(orderError)throw orderError;
    }
  }

  async function addQuote(d) {
    const v=records.find(x=>x.id===d.get('id')); if(!v||!v.orderId)throw new Error('Ordre de travail introuvable.');
    const title=String(d.get('description')||'').trim();
    if(!title)throw new Error('Indiquez le titre ou le diagnostic du devis.');
    const readNumber=(name,fallback)=>{
      const raw=String(d.get(name)??'').trim().replace(/\s/g,'').replace(',','.');
      if(!raw)return fallback;
      const value=Number(raw);
      if(!Number.isFinite(value))throw new Error('Vérifiez le champ '+name+'.');
      return value;
    };
    const items=[];
    for(let n=1;n<=3;n++){
      const description=String(d.get('item'+n)||'').trim();
      if(!description)continue;
      const quantity=readNumber('qty'+n,1),unitPrice=readNumber('price'+n,0);
      if(!(quantity>0)||quantity>1000000||unitPrice<0||unitPrice>1000000000)throw new Error('Vérifiez les quantités et les prix des pièces.');
      const total=Math.round((quantity*unitPrice+Number.EPSILON)*100)/100;
      if(!Number.isFinite(total))throw new Error('Le total d’une ligne est invalide.');
      items.push({description,quantity,unit_price:Math.round((unitPrice+Number.EPSILON)*100)/100,total_price:total});
    }
    const hours=readNumber('labor_hours',0),rate=readNumber('labor_rate',0);
    if(hours<0||hours>1000||rate<0||rate>1000000)throw new Error('Vérifiez les heures et le taux horaire de la main-d’œuvre.');
    if(hours>0)items.push({description:'Main-d’œuvre ('+hours+' h)',quantity:hours,unit_price:Math.round((rate+Number.EPSILON)*100)/100,total_price:Math.round((hours*rate+Number.EPSILON)*100)/100});
    if(!items.length)throw new Error('Ajoutez au moins une pièce ou une ligne de main-d’œuvre.');
    const amount=Math.round((items.reduce((sum,it)=>sum+it.total_price,0)+Number.EPSILON)*100)/100;
    if(!Number.isFinite(amount)||amount>9999999999.99)throw new Error('Le total du devis dépasse la limite autorisée. Vérifiez les quantités et les prix saisis.');
    const {data:q,error}=await client.from('quotes').insert({garage_id:garageId,work_order_id:v.orderId,vehicle_id:v.id,quote_number:'AF-'+Date.now(),title,amount,status:'pending',created_by:user.id}).select().single();
    if(error)throw error;
    const payload=items.map(it=>({quote_id:q.id,...it}));
    const {error:itemError}=await client.from('quote_items').insert(payload);
    if(itemError){await client.from('quotes').delete().eq('id',q.id);throw itemError;}
  }

  async function changeStatus(id,label) {
    const v=records.find(x=>x.id===id); if(!v||!v.orderId)return;
    if(label==='Clôturé') { alert('La clôture exige les kilométrages d’entrée et de sortie. Cette saisie sera ajoutée avant d’activer cette action.'); render(); return; }
    const status=TO_DB[label]; if(!status)return;
    const {error}=await client.from('work_orders').update({status}).eq('id',v.orderId).eq('garage_id',garageId);
    if(error)alert('Statut non modifié : '+errorMessage(error));
    await loadRecords(); render();
  }

  let pendingClientMessage=null;
  function buildQuotePdf(v,quote){
    if(!window.jspdf?.jsPDF)throw new Error('Le générateur PDF ne s’est pas chargé. Vérifiez votre connexion puis réessayez.');
    const {jsPDF}=window.jspdf,doc=new jsPDF({unit:'mm',format:'a4'}),pageWidth=210,margin=16;
    let y=20;
    const line=(txt,size=10,bold=false)=>{
      doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);
      const lines=doc.splitTextToSize(String(txt||''),pageWidth-margin*2);
      for(const part of lines){if(y>276){doc.addPage();y=20;}doc.text(part,margin,y);y+=size*0.48+2;}
    };
    const rule=()=>{doc.setDrawColor(210);doc.line(margin,y,pageWidth-margin,y);y+=7;};
    doc.setFont('helvetica','bold');doc.setFontSize(21);doc.text(garageName||'Atelier',margin,y);y+=10;
    doc.setFont('helvetica','normal');doc.setFontSize(9);
    [garageDetails.address,[(garageDetails.postal_code||''), (garageDetails.city||'')].filter(Boolean).join(' '),garageDetails.phone,garageDetails.email].filter(Boolean).forEach(t=>{doc.text(String(t),margin,y);y+=5;});
    y+=5;rule();
    line('DEVIS '+(quote.quote_number||''),16,true);
    line('Date : '+new Intl.DateTimeFormat('fr-BE').format(new Date(quote.createdAt||Date.now())));
    line('Client : '+v.clientName);
    if(v.phone)line('Téléphone : '+v.phone);
    if(v.email)line('E-mail : '+v.email);
    line('Véhicule : '+v.brand+' '+v.model+' — '+v.plate);
    y+=3;rule();line('Objet : '+(quote.title||quote.description||'Intervention'),11,true);y+=3;
    doc.setFont('helvetica','bold');doc.setFontSize(9);
    doc.text('Désignation',margin,y);doc.text('Qté',132,y);doc.text('Prix unit.',151,y);doc.text('Total',pageWidth-margin,y,{align:'right'});y+=6;rule();
    (quote.items||[]).forEach(item=>{
      const desc=doc.splitTextToSize(String(item.description||''),105);
      const rowHeight=Math.max(6,desc.length*5);
      if(y+rowHeight+5>276){doc.addPage();y=20;}
      doc.setFont('helvetica','normal');doc.setFontSize(9);
      doc.text(desc,margin,y);
      doc.text(String(item.quantity??1),132,y);
      doc.text(Number(item.unit_price||0).toFixed(2)+' EUR',151,y);
      doc.text(Number(item.total_price||0).toFixed(2)+' EUR',pageWidth-margin,y,{align:'right'});
      y+=rowHeight+2;
    });
    y+=4;rule();doc.setFont('helvetica','bold');doc.setFontSize(13);
    doc.text('TOTAL : '+Number(quote.amount||0).toFixed(2)+' EUR',pageWidth-margin,y,{align:'right'});
    y+=12;doc.setFont('helvetica','normal');doc.setFontSize(8);
    line('Ce document constitue le devis établi par '+(garageName||'votre atelier')+'.',8);
    return doc.output('blob');
  }
  async function createQuotePdfLink(v,quote){
    const pdf=buildQuotePdf(v,quote),path=garageId+'/quotes/'+quote.id+'-'+Date.now()+'.pdf';
    const {error:uploadError}=await client.storage.from('inspection-attachments').upload(path,pdf,{contentType:'application/pdf',upsert:false});
    if(uploadError)throw uploadError;
    const {data,error}=await client.storage.from('inspection-attachments').createSignedUrl(path,604800);
    if(error)throw error;
    if(!data?.signedUrl)throw new Error('Le lien sécurisé du devis n’a pas pu être créé.');
    return data.signedUrl;
  }
  function openClientMessageDialog(vehicleId){
    if(!isAdmin())return;
    const v=records.find(x=>x.id===vehicleId);
    if(!v)throw new Error('Dossier introuvable.');
    if(!v.phone&&!v.email)throw new Error('Ajoutez un numéro de téléphone ou une adresse e-mail au client.');
    const quotes=[...(v.quotes||[])].sort((a,b)=>new Date(b.createdAt||b.created_at||0)-new Date(a.createdAt||a.created_at||0));
    const defaultQuote=quotes[0]||null;
    const message='Bonjour '+v.clientName+', le contrôle de votre '+v.brand+' '+v.model+' ('+v.plate+') est terminé. Contactez-nous pour toute question. Merci.';
    pendingClientMessage={vehicleId,channel:v.phone?'sms':'email',message,launched:false,quoteId:defaultQuote?.id||null,preparedUrl:null};
    const old=$('#data-dialog');if(old)old.remove();
    const quoteOptions='<option value="">Sans devis PDF</option>'+quotes.map(q=>'<option value="'+esc(q.id)+'" '+(q.id===defaultQuote?.id?'selected':'')+'>'+esc((q.quote_number||'Devis')+' — '+(q.title||q.description||'')+' — '+money(q.amount))+'</option>').join('');
    const quoteInfo=quotes.length?'Choisis un devis si tu veux l’ajouter au message en PDF.':'Aucun devis n’est enregistré : tu peux quand même préparer le SMS ou l’e-mail sans PDF.';
    document.body.insertAdjacentHTML('beforeend','<dialog id="data-dialog"><div class="dialog-head"><h2>Préparer un SMS / e-mail</h2><button class="icon-btn" type="button" data-action="close">×</button></div><p class="muted">Vérifie les coordonnées et le texte avant d’ouvrir ton application de messagerie.</p><label>Devis à joindre (facultatif)<select id="client-message-quote">'+quoteOptions+'</select></label><p id="client-message-status" class="muted">'+esc(quoteInfo)+'</p><label>Envoyer par<select id="client-message-channel"><option value="sms" '+(v.phone?'':'disabled')+'>SMS'+(v.phone?'':' — numéro absent')+'</option><option value="email" '+(!v.phone&&v.email?'selected':'')+' '+(v.email?'':'disabled')+'>E-mail'+(v.email?'':' — adresse absente')+'</option></select></label><label>Message<textarea id="client-message-body" rows="5">'+esc(message)+'</textarea></label><p class="muted">Le PDF, s’il est sélectionné, est partagé par un lien sécurisé valable 7 jours.</p><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="button" data-action="launch-client-message">Préparer le message</button><button class="secondary-btn" type="button" data-action="confirm-client-message" disabled>J’ai envoyé — archiver</button></div></dialog>');
    $('#data-dialog').showModal();
  }
  async function launchClientMessage(){
    if(!pendingClientMessage)throw new Error('Aucun message en préparation.');
    const v=records.find(x=>x.id===pendingClientMessage.vehicleId);
    const channel=$('#client-message-channel')?.value;
    const quoteId=$('#client-message-quote')?.value||'';
    const quote=quoteId?(v?.quotes||[]).find(q=>q.id===quoteId):null;
    if(quoteId&&!quote)throw new Error('Le devis sélectionné est introuvable. Choisis-le à nouveau.');
    if(channel==='sms'&&!v?.phone)throw new Error('Numéro de téléphone manquant.');
    if(channel==='email'&&!v?.email)throw new Error('Adresse e-mail manquante.');
    let message=$('#client-message-body').value.trim();
    if(!message)throw new Error('Le message ne peut pas être vide.');
    const btn=$('[data-action="launch-client-message"]');
    btn.disabled=true;
    btn.textContent=quote?'Génération du PDF…':'Préparation…';
    try{
      if(quote){
        const pdfLink=await createQuotePdfLink(v,quote);
        message+='\n\nVotre devis en PDF : '+pdfLink;
      }
      let preparedUrl='';
      if(channel==='sms'){
        const phone=String(v.phone).replace(/[^\d+]/g,'');
        preparedUrl='sms:'+phone+'?&body='+encodeURIComponent(message);
      }else{
        const subject=quote?'Votre devis '+(quote.quote_number||'')+' — '+garageName:'Votre véhicule — '+garageName;
        preparedUrl='mailto:'+v.email+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(message);
      }
      pendingClientMessage={...pendingClientMessage,channel,message,quoteId:quote?.id||null,preparedUrl,launched:false};
      btn.dataset.action='open-prepared-client-message';
      btn.textContent=channel==='sms'?'Ouvrir les SMS':'Ouvrir Mail';
      btn.disabled=false;
      const status=$('#client-message-status');
      if(status)status.textContent=quote?'Le PDF est prêt. Appuie maintenant sur « Ouvrir » pour lancer ton application.':'Le message est prêt. Appuie maintenant sur « Ouvrir » pour lancer ton application.';
    }catch(err){
      btn.disabled=false;
      btn.textContent='Réessayer';
      throw err;
    }
  }
  function openPreparedClientMessage(){
    if(!pendingClientMessage?.preparedUrl)throw new Error('Prépare d’abord le message.');
    const url=pendingClientMessage.preparedUrl;
    pendingClientMessage={...pendingClientMessage,launched:true};
    const confirmBtn=$('[data-action="confirm-client-message"]');
    if(confirmBtn)confirmBtn.disabled=false;
    window.location.href=url;
  }
  async function confirmClientMessageAndArchive(){
    if(!pendingClientMessage?.launched)throw new Error('Ouvrez d’abord votre application SMS ou Mail et envoyez le message.');
    const {vehicleId,channel,message}=pendingClientMessage,v=records.find(x=>x.id===vehicleId);
    const inspection=inspections.find(x=>x.work_order_id===v?.orderId&&x.status==='submitted');
    if(!v?.orderId||!inspection)throw new Error('Le contrôle transmis est introuvable.');
    const {error:messageError}=await client.from('work_orders').update({customer_message_sent_at:new Date().toISOString(),customer_message_channel:channel,customer_message_content:message}).eq('id',v.orderId).eq('garage_id',garageId);
    if(messageError)throw messageError;
    const {error:closeError}=await client.from('work_orders').update({status:'closed'}).eq('id',v.orderId).eq('garage_id',garageId);
    if(closeError)throw closeError;
    const {error:inspectionError}=await client.from('inspections').update({status:'archived'}).eq('id',inspection.id).eq('garage_id',garageId);
    if(inspectionError)throw inspectionError;
    pendingClientMessage=null;const dlg=$('#data-dialog');if(dlg){dlg.close();dlg.remove();}
    await loadRecords();view='archives';render();
  }


  function isAdmin(){return membershipRole==='admin';}
  function timeLabel(value){return new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
  function dateInputValue(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function renderWorkshopPlanning(target='#app',compact=false){
    const dateId=compact?'planning-day-dashboard':'planning-day';
    const day=document.getElementById(dateId)?.value||dateInputValue(new Date());
    const start=new Date(day+'T07:00:00'),end=new Date(day+'T19:00:00');
    const todays=appointments.filter(a=>new Date(a.starts_at)<end&&new Date(a.ends_at)>start&&a.status!=='cancelled');
    const hours=Array.from({length:12},(_,i)=>7+i);
    const people=staff.filter(s=>s.mechanic&&s.is_active!==false);
    const header='<div class="schedule-head"><div class="schedule-name">Équipe</div><div>'+hours.map(h=>'<div class="schedule-hour">'+String(h).padStart(2,'0')+':00</div>').join('')+'</div></div>';
    const lanes=people.map(person=>{
      const events=todays.filter(a=>appointmentAssignments.some(x=>x.appointment_id===a.id&&x.mechanic_profile_id===person.mechanic.id)).map(a=>{
        const s=new Date(a.starts_at),e=new Date(a.ends_at),left=Math.max(0,(s-start)/3600000),right=Math.min(12,(e-start)/3600000);
        if(right<=left)return '';
        const colStart=Math.floor(left)+1,colEnd=Math.max(colStart+1,Math.ceil(right)+1);
        const linked=records.find(v=>v.orderId===a.work_order_id);
        return '<button class="schedule-event" style="grid-column:'+colStart+' / '+colEnd+'" data-action="appointment" data-id="'+esc(a.id)+'"><b>'+timeLabel(a.starts_at)+'–'+timeLabel(a.ends_at)+'</b><span>'+esc(a.title)+'</span><small>'+esc(linked?(linked.brand+' '+linked.model+' · '+linked.plate):'Intervention atelier')+'</small></button>';
      }).join('');
      return '<div class="schedule-lane"><div class="schedule-person"><b>'+esc(person.profile.full_name||'Mécanicien')+'</b><small>'+(person.role==='admin'?'Administration':'Mécanicien')+'</small></div><div class="schedule-track">'+hours.map(()=>'<div class="schedule-cell"></div>').join('')+events+'</div></div>';
    }).join('');
    const host=document.querySelector(target);if(!host)return;
    host.innerHTML='<div class="schedule-actions dashboard-date"><input id="'+dateId+'" type="date" value="'+day+'">'+(isAdmin()?'<button class="primary-btn" data-action="new-appointment">+ Planifier un travail</button>':'')+'</div><div class="schedule-scroll">'+header+(lanes||'<p class="empty">Aucun profil mécanicien n’est configuré. Ajoutez les profils depuis Équipe & administration.</p>')+'</div>';
  }

  function renderSettings(){
    $('#app').innerHTML='<section class="panel settings-panel"><div class="panel-heading"><div><h2>Informations de l’entreprise</h2><p class="muted">Ces informations sont enregistrées pour votre atelier et peuvent être modifiées à tout moment.</p></div></div><form id="garage-settings-form" class="form-grid"><label class="full">Nom de l’entreprise / du garage<input name="name" required maxlength="120" value="'+esc(garageName)+'"></label><label class="full">Adresse<input name="address" maxlength="200" value="'+esc(garageDetails.address||'')+'"></label><label>Code postal<input name="postal_code" maxlength="20" value="'+esc(garageDetails.postal_code||'')+'"></label><label>Ville<input name="city" maxlength="100" value="'+esc(garageDetails.city||'')+'"></label><label>Téléphone professionnel<input name="phone" type="tel" maxlength="40" value="'+esc(garageDetails.phone||'')+'"></label><label>E-mail professionnel<input name="email" type="email" maxlength="200" value="'+esc(garageDetails.email||'')+'"></label><div id="garage-settings-message" class="notice full" hidden></div><div class="dialog-actions full"><button class="primary-btn" type="submit">Enregistrer les informations</button></div></form></section><section class="panel settings-panel"><div class="panel-heading"><div><h2>Mon mot de passe</h2><p class="muted">Modifiez votre mot de passe sans vous déconnecter de votre atelier.</p></div></div><form id="change-password-form" class="form-grid"><label class="full">Nouveau mot de passe<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label class="full">Confirmer le nouveau mot de passe<input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required></label><div id="change-password-message" class="notice full" hidden></div><div class="dialog-actions full"><button class="primary-btn" type="submit">Modifier mon mot de passe</button></div></form></section>';
    $('#garage-settings-form').addEventListener('submit',async ev=>{
      ev.preventDefault();const form=ev.currentTarget,d=new FormData(form),btn=form.querySelector('[type=submit]');
      const name=String(d.get('name')||'').trim();if(!name){notice('#garage-settings-message','Le nom de l’entreprise est obligatoire.','error');return;}
      btn.disabled=true;btn.textContent='Enregistrement…';
      try{
        const patch={name,address:String(d.get('address')||'').trim()||null,postal_code:String(d.get('postal_code')||'').trim()||null,city:String(d.get('city')||'').trim()||null,phone:String(d.get('phone')||'').trim()||null,email:String(d.get('email')||'').trim()||null};
        const {data,error}=await client.from('garages').update(patch).eq('id',garageId).select().single();
        if(error)throw error;garageDetails=data;garageName=data.name;$('#garage-label').textContent=garageName+' · Synchronisé en ligne';
        notice('#garage-settings-message','Les informations de votre entreprise ont été enregistrées.','success');
      }catch(err){notice('#garage-settings-message',errorMessage(err),'error');}
      finally{btn.disabled=false;btn.textContent='Enregistrer les informations';}
    });
    $('#change-password-form').addEventListener('submit',async ev=>{
      ev.preventDefault();const form=ev.currentTarget,password=form.elements.password.value,confirmation=form.elements.confirm_password.value,btn=form.querySelector('[type=submit]');
      if(password.length<8){notice('#change-password-message','Le mot de passe doit contenir au moins 8 caractères.','error');return;}
      if(password!==confirmation){notice('#change-password-message','Les deux mots de passe ne correspondent pas.','error');return;}
      btn.disabled=true;btn.textContent='Modification…';
      try{const {error}=await client.auth.updateUser({password});if(error)throw error;form.reset();notice('#change-password-message','Mot de passe modifié. Vous restez connecté.','success');}
      catch(err){notice('#change-password-message',errorMessage(err),'error');}
      finally{btn.disabled=false;btn.textContent='Modifier mon mot de passe';}
    });
  }
  function renderTeam(){
    const members=staff.filter(s=>s.role==='admin'||s.mechanic);
    $('#app').innerHTML='<section class="panel"><div class="panel-heading"><div><h2>Équipe de l’atelier</h2><p class="muted">Gérez les membres et leurs accès au planning.</p></div>'+(isAdmin()?'<button class="primary-btn" data-action="open-add-mechanic">+ Ajouter un mécanicien</button>':'')+'</div><div class="team-list">'+(members.length?members.map(s=>{
      const active=s.is_active!==false;
      return '<article class="team-row"><div><b>'+esc(s.profile.full_name||'Compte sans nom')+'</b><small>'+(s.role==='admin'?'Administrateur':'Mécanicien')+' · '+(active?'Accès actif':'Accès suspendu')+'</small></div><div class="team-actions">'+(s.role==='admin'?'<span class="badge">Administrateur</span>':(active?'<span class="badge green">Actif</span>':'<span class="badge">Suspendu</span>'))+(isAdmin()&&s.role==='mechanic'?'<button class="secondary-btn" data-action="edit-mechanic" data-id="'+esc(s.profileId)+'">Modifier</button><button class="secondary-btn" data-action="toggle-mechanic" data-id="'+esc(s.profileId)+'" data-active="'+(active?'true':'false')+'">'+(active?'Désactiver':'Réactiver')+'</button>':'')+'</div></article>';
    }).join(''):'<p class="empty">Aucun membre n’est encore rattaché à cet atelier.</p>')+'</div>'+(isAdmin()?'<p class="muted team-help">Vous pouvez modifier le nom d’un mécanicien ou suspendre/réactiver son accès. Un accès suspendu ne peut plus consulter l’atelier.</p>':'')+'</section>';
  }
  async function manageMechanic(profileId,action,fullName){
    const {data,error}=await client.functions.invoke('manage-mechanic',{body:{garageId,profileId,action,fullName}});
    if(error)throw error;if(data?.error)throw new Error(data.error);
    await loadRecords();render();
  }
  function openEditMechanicDialog(profileId){
    if(!isAdmin())return;
    const member=staff.find(s=>s.profileId===profileId);if(!member||member.role!=='mechanic')return;
    const old=$('#data-dialog');if(old)old.remove();
    document.body.insertAdjacentHTML('beforeend','<dialog id="data-dialog"><form id="edit-mechanic-form"><div class="dialog-head"><h2>Modifier le mécanicien</h2><button class="icon-btn" type="button" data-action="close">×</button></div><div class="form-grid"><label class="full">Nom complet<input name="full_name" required maxlength="100" value="'+esc(member.profile.full_name||'')+'"></label></div><div id="edit-mechanic-message" class="notice" hidden></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div></form></dialog>');
    const dlg=$('#data-dialog');dlg.showModal();
    $('#edit-mechanic-form').addEventListener('submit',async ev=>{ev.preventDefault();const btn=ev.currentTarget.querySelector('[type=submit]');btn.disabled=true;try{await manageMechanic(profileId,'rename',ev.currentTarget.elements.full_name.value.trim());dlg.close();dlg.remove();}catch(err){notice('#edit-mechanic-message',errorMessage(err),'error');btn.disabled=false;}});
  }
  function openAddMechanicDialog(){
    if(!isAdmin())return;
    const old=$('#data-dialog');if(old)old.remove();
    document.body.insertAdjacentHTML('beforeend','<dialog id="data-dialog"><form id="add-mechanic-form"><div class="dialog-head"><h2>Créer un compte mécanicien</h2><button class="icon-btn" type="button" data-action="close">×</button></div><p class="muted">Tu définis ici son mot de passe initial et tu le lui transmets en privé. Il pourra se connecter avec ce mot de passe et le changer dans Paramètres. L’envoi automatique d’un e-mail de connexion nécessite encore la configuration de l’adresse d’envoi AtelierFlow.</p><div class="form-grid"><label class="full">Nom complet<input name="full_name" required maxlength="100" autocomplete="name" placeholder="Ex. Jean Dupont"></label><label class="full">Adresse e-mail<input name="email" type="email" required maxlength="200" autocomplete="email" placeholder="mecanicien@exemple.be"></label><label class="full">Mot de passe initial<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><label class="full">Confirmer le mot de passe<input name="confirm_password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label></div><div id="mechanic-invite-message" class="notice" hidden></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Créer le compte mécanicien</button></div></form></dialog>');
    const dlg=$('#data-dialog');dlg.showModal();
    $('#add-mechanic-form').addEventListener('submit',async ev=>{
      ev.preventDefault();const form=ev.currentTarget,btn=form.querySelector('[type=submit]');
      const fullName=form.elements.full_name.value.trim(),email=form.elements.email.value.trim().toLowerCase(),password=form.elements.password.value,confirmation=form.elements.confirm_password.value;
      if(!fullName||!email)return;
      if(password.length<8){notice('#mechanic-invite-message','Le mot de passe doit contenir au moins 8 caractères.','error');return;}
      if(password!==confirmation){notice('#mechanic-invite-message','Les deux mots de passe ne correspondent pas.','error');return;}
      btn.disabled=true;btn.textContent='Création du compte…';
      try{
        const {data,error}=await client.functions.invoke('invite-mechanic',{body:{garageId,fullName,email,password}});
        if(error)throw error;
        if(data?.error)throw new Error(data.error);
        notice('#mechanic-invite-message','Compte créé pour '+email+'. Transmets-lui le mot de passe initial en privé. Il peut maintenant se connecter et le modifier dans Paramètres.','success');
        btn.textContent='Compte créé';
        await loadRecords();render();
        setTimeout(()=>{if(dlg.open){dlg.close();dlg.remove();}},1800);
      }catch(err){
        let message=errorMessage(err);
        if(err?.context && typeof err.context.clone==='function'){
          try{const responseBody=await err.context.clone().json();if(responseBody?.error)message=responseBody.error;}catch(_){}
        }
        notice('#mechanic-invite-message',message,'error');
        btn.disabled=false;btn.textContent='Créer le compte mécanicien';
      }
    });
  }
  function openAppointmentForm(appointmentId){
    if(!isAdmin())return;
    const existing=appointmentId?appointments.find(a=>a.id===appointmentId):null;
    if(appointmentId&&!existing)throw new Error('Rendez-vous introuvable.');
    const options=records.filter(v=>v.orderId).map(v=>'<option value="'+esc(v.orderId)+'" '+(existing?.work_order_id===v.orderId?'selected':'')+'>'+esc(v.brand+' '+v.model+' · '+v.plate+' — '+v.clientName)+'</option>').join('');
    const mechanics=staff.filter(s=>s.mechanic).map(s=>'<option value="'+esc(s.mechanic.id)+'" '+(appointmentAssignments.some(x=>x.appointment_id===existing?.id&&x.mechanic_profile_id===s.mechanic.id)?'selected':'')+'>'+esc(s.profile.full_name||'Mécanicien')+'</option>').join('');
    if(!mechanics){alert('Ajoutez d’abord les profils des mécaniciens dans Équipe & administration.');return;}
    const d=existing?new Date(existing.starts_at):new Date();if(!existing){d.setMinutes(0,0,0);d.setHours(Math.max(7,Math.min(17,d.getHours()+1)));}
    const finish=existing?new Date(existing.ends_at):new Date(d.getTime()+3600000);
    const dt=x=>[dateInputValue(x),String(x.getHours()).padStart(2,'0')+':'+String(x.getMinutes()).padStart(2,'0')].join('T');
    const defaultOrder=existing?.work_order_id||'__new__';
    showAppointmentDialog('<h2>'+(existing?'Modifier le rendez-vous':'Planifier un véhicule')+'</h2><input type="hidden" name="appointment_id" value="'+esc(existing?.id||'')+'"><div class="form-grid"><label class="full">Travail demandé / intervention<input name="title" required maxlength="1500" value="'+esc(existing?.title||'')+'" placeholder="Ex. Entretien complet, diagnostic moteur, remplacement des freins"></label><label class="full">Dossier véhicule (réutilisable pour plusieurs rendez-vous)<select name="work_order_id"><option value="__new__" '+(defaultOrder==='__new__'?'selected':'')+'>+ Créer le dossier d’un nouveau véhicule</option><option value="">Intervention sans dossier lié</option>'+options+'</select></label><div id="new-vehicle-fields" class="form-grid full" '+(defaultOrder==='__new__'?'':'hidden')+'><p class="muted full">Le dossier client, le véhicule et l’ordre de travail seront créés automatiquement avec ce rendez-vous.</p><label>Nom du client<input name="clientName" maxlength="100" '+(defaultOrder==='__new__'?'required':'')+'></label><label>Téléphone<input name="phone" type="tel" maxlength="40"></label><label>E-mail client<input name="email" type="email" maxlength="200"></label><label>Marque<input name="brand" maxlength="60" '+(defaultOrder==='__new__'?'required':'')+'></label><label>Modèle<input name="model" maxlength="60" '+(defaultOrder==='__new__'?'required':'')+'></label><label>Immatriculation<input name="plate" maxlength="30" '+(defaultOrder==='__new__'?'required':'')+'></label></div><label>Mécanicien<select name="mechanic_id" required>'+mechanics+'</select></label><label>Début<input type="datetime-local" name="starts_at" value="'+dt(d)+'" required></label><label>Fin<input type="datetime-local" name="ends_at" value="'+dt(finish)+'" required></label><label class="full">Notes du rendez-vous<textarea name="notes" rows="2">'+esc(existing?.notes||'')+'</textarea></label></div>');
    const orderSelect=$('#data-form [name="work_order_id"]'),newFields=$('#new-vehicle-fields');
    const syncNewFields=()=>{const active=orderSelect.value==='__new__';newFields.hidden=!active;newFields.querySelectorAll('input,textarea').forEach(el=>{el.disabled=!active;el.required=active&&['clientName','brand','model','plate'].includes(el.name);});};
    orderSelect.addEventListener('change',syncNewFields);syncNewFields();
    if(existing){const submit=$('#data-form [type=submit]');if(submit)submit.textContent='Enregistrer les modifications';}
  }
  function showAppointmentDialog(fields){
    const old=$('#data-dialog');if(old)old.remove();
    document.body.insertAdjacentHTML('beforeend','<dialog id="data-dialog"><form id="data-form"><div class="dialog-head">'+fields+'<button class="icon-btn" type="button" data-action="close">×</button></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Créer le créneau</button></div></form></dialog>');
    const dlg=$('#data-dialog');dlg.showModal();
    $('#data-form').addEventListener('submit',async ev=>{
      ev.preventDefault();const f=ev.currentTarget,d=new FormData(f),btn=f.querySelector('[type=submit]');btn.disabled=true;
      try{await saveAppointment(d);dlg.close();dlg.remove();await loadRecords();render();}
      catch(err){alert('Enregistrement impossible : '+errorMessage(err));btn.disabled=false;}
    });
  }
  async function saveAppointment(d){
    const starts=new Date(d.get('starts_at')),ends=new Date(d.get('ends_at'));
    if(!(ends>starts))throw new Error('L’heure de fin doit être après l’heure de début.');
    const id=String(d.get('appointment_id')||''),selectedOrder=String(d.get('work_order_id')||''),payload={work_order_id:selectedOrder==='__new__'?null:(selectedOrder||null),title:String(d.get('title')).trim(),starts_at:starts.toISOString(),ends_at:ends.toISOString(),notes:String(d.get('notes')||'').trim()||null};
    let appointmentId=id,createdClientId=null,createdVehicleId=null,createdOrderId=null;
    if(selectedOrder==='__new__'){
      const name=String(d.get('clientName')||'').trim().split(/\\s+/),first=name.shift()||'Client',last=name.join(' ');
      const {data:c,error:ce}=await client.from('clients').insert({garage_id:garageId,first_name:first,last_name:last||null,phone:String(d.get('phone')||'').trim()||null,email:String(d.get('email')||'').trim()||null}).select().single();
      if(ce)throw ce;createdClientId=c.id;
      const {data:v,error:ve}=await client.from('vehicles').insert({garage_id:garageId,client_id:c.id,brand:String(d.get('brand')).trim(),model:String(d.get('model')).trim(),registration_number:String(d.get('plate')).trim().toUpperCase(),mileage_current:0}).select().single();
      if(ve){await client.from('clients').delete().eq('id',c.id);throw ve;}createdVehicleId=v.id;
      const {data:o,error:oe}=await client.from('work_orders').insert({garage_id:garageId,vehicle_id:v.id,client_id:c.id,created_by:user.id,title:'Réparation '+v.brand+' '+v.model,description:String(d.get('title')||'').trim()||null,status:'queued',planned_start:starts.toISOString()}).select().single();
      if(oe){await client.from('vehicles').delete().eq('id',v.id);await client.from('clients').delete().eq('id',c.id);throw oe;}createdOrderId=o.id;payload.work_order_id=o.id;
    }
    try{
      if(id){const {error}=await client.from('appointments').update(payload).eq('id',id).eq('garage_id',garageId);if(error)throw error;const {error:de}=await client.from('appointment_mechanics').delete().eq('appointment_id',id).eq('garage_id',garageId);if(de)throw de;}
      else{const {data:a,error}=await client.from('appointments').insert({...payload,garage_id:garageId,created_by:user.id}).select().single();if(error)throw error;appointmentId=a.id;}
      const {error:ae}=await client.from('appointment_mechanics').insert({garage_id:garageId,appointment_id:appointmentId,mechanic_profile_id:String(d.get('mechanic_id'))});
      if(ae)throw ae;
    }catch(err){
      if(createdOrderId)await client.from('work_orders').delete().eq('id',createdOrderId).eq('garage_id',garageId);
      if(createdVehicleId)await client.from('vehicles').delete().eq('id',createdVehicleId).eq('garage_id',garageId);
      if(createdClientId)await client.from('clients').delete().eq('id',createdClientId).eq('garage_id',garageId);
      throw err;
    }
  }
  async function cancelAppointment(id){
    if(!isAdmin())throw new Error('Seule l’administration peut annuler un rendez-vous.');
    const a=appointments.find(x=>x.id===id);if(!a)return;
    if(!confirm('Annuler ce rendez-vous ? Le véhicule et son dossier seront conservés, mais retirés du planning actif.'))return;
    const {error}=await client.from('appointments').update({status:'cancelled'}).eq('id',id).eq('garage_id',garageId);if(error)throw error;
    
    await loadRecords();render();
  }
  document.addEventListener('change',ev=>{if(ev.target.id==='planning-day')renderWorkshopPlanning();if(ev.target.id==='planning-day-dashboard')renderWorkshopPlanning('#dashboard-planning',true);if(ev.target.id==='language-setting'){language=ev.target.value;localStorage.setItem('atelierflow-language',language);syncLanguageShell();render();}});


  const DEFAULT_CHECKLIST=[
    {name:'Sécurité et freinage',items:['Freinage avant','Freinage arrière','État des pneus','Pression des pneus','Éclairage et signalisation','Direction et jeu de direction']},
    {name:'Moteur et transmission',items:['Démarrage et fonctionnement moteur','Bruits anormaux','Embrayage et boîte de vitesses','Courroie / chaîne / transmission']},
    {name:'Sous le véhicule',items:['Fuites moteur','Fuites boîte de vitesses','Échappement et fixations','Suspension et amortisseurs']},
    {name:'Électricité et diagnostic',items:['Batterie et charge','Voyants au tableau de bord','Lecture des codes défauts','Équipements électriques']},
    {name:'Habitacle et finition',items:['Ceintures et avertisseurs','Essuie-glaces et lave-glace','État général intérieur / extérieur']}
  ];
  async function ensureChecklist(){
    if(checklistTemplate)return;
    const {data:templates,error}=await client.from('checklist_templates').select('*').eq('garage_id',garageId).eq('is_active',true).order('created_at');
    if(error)throw error;
    if(templates?.length)checklistTemplate=templates[0];
    else{
      if(!isAdmin())throw new Error('Le modèle de contrôle doit être créé par l’administrateur.');
      const {data:t,error:te}=await client.from('checklist_templates').insert({garage_id:garageId,name:'Contrôle général du véhicule',created_by:user.id}).select().single();
      if(te)throw te;checklistTemplate=t;
      for(let i=0;i<DEFAULT_CHECKLIST.length;i++){
        const group=DEFAULT_CHECKLIST[i];
        const {data:c,error:ce}=await client.from('checklist_categories').insert({garage_id:garageId,template_id:t.id,name:group.name,sort_order:i}).select().single();
        if(ce)throw ce;
        const payload=group.items.map((name,j)=>({garage_id:garageId,category_id:c.id,name,sort_order:j,item_type:'boolean'}));
        const {error:ie}=await client.from('checklist_items').insert(payload);if(ie)throw ie;
      }
    }
    const {data:cats,error:ca}=await client.from('checklist_categories').select('*').eq('template_id',checklistTemplate.id).order('sort_order');
    if(ca)throw ca;checklistCategories=cats||[];
    const {data:items,error:it}=await client.from('checklist_items').select('*').eq('garage_id',garageId).eq('is_active',true).order('sort_order');
    if(it)throw it;checklistItems=items||[];
  }
  async function openInspection(workOrderId,appointmentId){
    if(!workOrderId)throw new Error('Aucun ordre de travail lié à ce créneau.');
    await ensureChecklist();
    const {data:ins,error}=await client.from('inspections').select('*').eq('work_order_id',workOrderId).eq('template_id',checklistTemplate.id).order('created_at',{ascending:false}).limit(1);
    if(error)throw error;
    const latestInspection=ins?.[0]||null;
    const appointment=appointmentId?appointments.find(a=>a.id===appointmentId):null;
    const isNewAppointmentAfterPreviousControl=!!(appointment&&latestInspection&&['submitted','archived'].includes(latestInspection.status)&&new Date(appointment.created_at)>new Date(latestInspection.created_at));
    activeInspection=isNewAppointmentAfterPreviousControl?null:latestInspection;
    if(!activeInspection){
      const {data:i,error:ie}=await client.from('inspections').insert({garage_id:garageId,work_order_id:workOrderId,template_id:checklistTemplate.id,conducted_by:user.id,status:'in_progress'}).select().single();
      if(ie)throw ie;activeInspection=i;inspections.unshift(i);
    }
    const [{data:r,error:re},{data:files,error:fe}]=await Promise.all([
      client.from('inspection_results').select('*').eq('inspection_id',activeInspection.id),
      client.from('attachments').select('*').eq('work_order_id',workOrderId).eq('garage_id',garageId).order('created_at')
    ]);
    if(re)throw re;if(fe)throw fe;inspectionResults=r||[];inspectionAttachments=files||[];
    for(const file of inspectionAttachments){const {data:signed}=await client.storage.from('inspection-attachments').createSignedUrl(file.storage_path,3600);file.signed_url=signed?.signedUrl||null;}
    renderInspection(workOrderId);
  }
  function renderInspection(workOrderId){
    const v=records.find(x=>x.orderId===workOrderId);
    const sections=checklistCategories.map(cat=>{
      const items=checklistItems.filter(i=>i.category_id===cat.id);
      return '<section class="check-group"><h3>'+esc(cat.name)+'</h3>'+items.map(item=>{
        const result=inspectionResults.find(r=>r.item_id===item.id),state=result?.state||'';
        const editable=['in_progress','completed'].includes(activeInspection.status);
        const files=inspectionAttachments.filter(f=>f.storage_path.includes('/'+item.id+'/'));
        return '<div class="check-row"><b>'+esc(item.name)+'</b><select data-action="check-result" data-item="'+esc(item.id)+'" '+(!editable?'disabled':'')+'><option value="" disabled '+(!state?'selected':'')+'>Choisir le résultat…</option><option value="ok" '+(state==='ok'?'selected':'')+'>Conforme</option><option value="anomaly" '+(state==='anomaly'?'selected':'')+'>Anomalie / non conforme</option><option value="n/a" '+(state==='n/a'?'selected':'')+'>Non applicable</option></select>'+(state==='anomaly'?'<div class="inspection-anomaly"><label class="check-note-label">Commentaire obligatoire<textarea class="check-note" data-action="check-note" data-item="'+esc(item.id)+'" required placeholder="Décrivez le problème constaté" '+(!editable?'disabled':'')+'>'+esc(result?.note||'')+'</textarea></label>'+(editable?'<label class="attachment-upload">Ajouter une photo ou un document<input type="file" data-action="inspection-attachment" data-item="'+esc(item.id)+'" accept="image/jpeg,image/png,image/webp,application/pdf" multiple></label>':'')+(files.length?'<ul class="attachment-list">'+files.map(f=>'<li>'+(f.signed_url?'<a href="'+esc(f.signed_url)+'" target="_blank" rel="noopener">'+esc(f.file_name)+'</a>':esc(f.file_name))+'</li>').join('')+'</ul>':'')+'</div>':'')+'</div>';
      }).join('')+'</section>';
    }).join('');
    $('#page-title').textContent='Contrôle véhicule';
    const done=inspectionResults.filter(r=>r.state==='ok'||r.state==='anomaly'||r.state==='n/a').length;
    const editable=activeInspection.status==='in_progress';
    const adminReview=isAdmin()&&activeInspection.status==='submitted';
    $('#app').innerHTML='<section class="panel"><div class="panel-heading"><div><h2>'+esc(v?v.brand+' '+v.model:'Contrôle')+'</h2><p class="muted">'+esc(v?v.plate:'')+' · '+esc(v?v.clientName:'')+'</p></div><button class="secondary-btn" data-action="back-orders">Retour au planning</button></div><p class="muted">Sélectionnez un résultat pour chaque point. Un commentaire est obligatoire uniquement en cas d’anomalie ou de non-conformité.</p><div class="inspection-progress">'+done+' / '+checklistItems.length+' contrôles enregistrés · '+(activeInspection.status==='submitted'?'Transmis à l’administration':activeInspection.status==='archived'?'Archivé':'En cours')+'</div>'+sections+'<div class="button-row">'+(['in_progress','completed'].includes(activeInspection.status)?'<button class="secondary-btn" data-action="add-quote" data-id="'+esc(v?.id||'')+'">Créer / ajouter un devis</button><button class="primary-btn inspection-next-step" type="button" data-action="finish-inspection">Passer à l’étape supérieure →</button>':activeInspection.status==='completed'?'<span class="muted">Contrôle modifiable — les changements sont enregistrés automatiquement.</span>':adminReview?'<span class="muted">Contrôle reçu par l’administration. Consultez les devis dans le dossier transmis.</span>':'<span class="muted">Ce contrôle est en lecture seule.</span>')+'</div></section>';
  }
  async function saveInspectionResult(itemId,patch){
    if(!['in_progress','completed'].includes(activeInspection?.status))throw new Error('Ce contrôle n’est plus modifiable.');
    const current=inspectionResults.find(r=>r.item_id===itemId);
    const payload={garage_id:garageId,inspection_id:activeInspection.id,item_id:itemId,...(current?{}:{}),...patch};
    const {data,error}=await client.from('inspection_results').upsert(payload,{onConflict:'inspection_id,item_id'}).select().single();
    if(error)throw error;
    const idx=inspectionResults.findIndex(r=>r.item_id===itemId);if(idx>=0)inspectionResults[idx]=data;else inspectionResults.push(data);
  }
  async function submitInspection(button){
    if(!['in_progress','completed'].includes(activeInspection?.status))return;
    if(button){button.disabled=true;button.textContent='Transmission…';}
    let completed=false;
    try{
      await inspectionSaveQueue;await inspectionAttachmentQueue;
      const {data:current,error:currentError}=await client.from('inspections').select('*').eq('id',activeInspection.id).eq('garage_id',garageId).maybeSingle();
      if(currentError)throw currentError;
      if(!current)throw new Error('Le contrôle est introuvable. Actualisez la page puis réessayez.');
      activeInspection=current;
      if(!['in_progress','completed'].includes(current.status)){
        renderInspection(current.work_order_id);
        alert(current.status==='archived'?'Ce contrôle a déjà été archivé par l’administration. Il ne peut plus être transmis.':'Ce contrôle a déjà été transmis à l’administration.');
        return;
      }
      const {data:latestResults,error:resultsError}=await client.from('inspection_results').select('*').eq('inspection_id',current.id);
      if(resultsError)throw resultsError;inspectionResults=latestResults||[];
      const missing=checklistItems.filter(i=>{const r=inspectionResults.find(x=>x.item_id===i.id);return !r||!r.state||(r.state==='anomaly'&&!String(r.note||'').trim());});
      if(missing.length){alert('Il reste '+missing.length+' contrôle(s) à compléter ou des anomalies sans commentaire ('+missing.length+').');return;}
      const {data,error}=await client.from('inspections').update({status:'submitted'}).eq('id',current.id).eq('garage_id',garageId).in('status',['in_progress','completed']).select().maybeSingle();
      if(error)throw error;
      if(!data){
        const {data:latest,error:latestError}=await client.from('inspections').select('*').eq('id',current.id).eq('garage_id',garageId).maybeSingle();
        if(latestError)throw latestError;
        if(latest){activeInspection=latest;renderInspection(latest.work_order_id);}
        alert('Le statut du contrôle a changé. Actualisez la page et vérifiez avec l’administration.');
        return;
      }
      activeInspection=data;alert('Véhicule transmis à l’administration.');
      await loadRecords();if(isAdmin())renderInspection(activeInspection.work_order_id);else{view='planning';render();}
      completed=true;
    }finally{
      if(button&&!completed&&button.isConnected){button.disabled=false;button.textContent='Passer à l’étape supérieure →';}
    }
  }

  async function uploadInspectionAttachments(itemId,fileList){
    if(!['in_progress','completed'].includes(activeInspection?.status))throw new Error('Ce contrôle n’accepte plus de pièces jointes.');
    const result=inspectionResults.find(r=>r.item_id===itemId);
    if(result?.state!=='anomaly')throw new Error('Les pièces jointes sont disponibles pour un point signalé en anomalie.');
    const v=records.find(x=>x.orderId===activeInspection.work_order_id);
    for(const file of Array.from(fileList)){
      if(file.size>10*1024*1024)throw new Error('Chaque fichier doit faire 10 Mo maximum.');
      if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw new Error('Format accepté : JPG, PNG, WEBP ou PDF.');
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||'piece-jointe';
      const path=garageId+'/'+activeInspection.id+'/'+itemId+'/'+Date.now()+'-'+crypto.randomUUID()+'-'+safeName;
      const {error:uploadError}=await client.storage.from('inspection-attachments').upload(path,file,{contentType:file.type,upsert:false});
      if(uploadError)throw uploadError;
      const {data:row,error}=await client.from('attachments').insert({garage_id:garageId,work_order_id:activeInspection.work_order_id,vehicle_id:v?.id||null,attachment_kind:file.type==='application/pdf'?'document':'photo',file_name:file.name,storage_path:path,mime_type:file.type,created_by:user.id}).select().single();
      if(error){await client.storage.from('inspection-attachments').remove([path]);throw error;}
      const {data:signed}=await client.storage.from('inspection-attachments').createSignedUrl(path,3600);
      row.signed_url=signed?.signedUrl||null;inspectionAttachments.push(row);
    }
    renderInspection(activeInspection.work_order_id);
  }
  function openAppointmentDetails(a){
    const v=records.find(x=>x.orderId===a.work_order_id);
    const old=$('#data-dialog');if(old)old.remove();
    const action=a.work_order_id?'<button class="primary-btn" type="button" data-action="start-inspection" data-work-order-id="'+esc(a.work_order_id)+'" data-appointment-id="'+esc(a.id)+'">Commencer la validation du véhicule</button>':'';
    const adminActions=isAdmin()?'<button class="secondary-btn" type="button" data-action="edit-appointment" data-id="'+esc(a.id)+'">Modifier le rendez-vous</button><button class="secondary-btn" type="button" data-action="cancel-appointment" data-id="'+esc(a.id)+'">Annuler / client absent</button>':'';
    document.body.insertAdjacentHTML('beforeend','<dialog id="data-dialog"><div class="dialog-head"><h2>'+esc(a.title)+'</h2><button class="icon-btn" type="button" data-action="close">×</button></div><p class="muted">'+timeLabel(a.starts_at)+' – '+timeLabel(a.ends_at)+'</p><p>'+(v?esc(v.brand+' '+v.model+' · '+v.plate+' — '+v.clientName):'Intervention atelier')+'</p><p class="muted">'+esc(a.notes||'Aucune note')+'</p><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Fermer</button>'+adminActions+action+'</div></dialog>');
    $('#data-dialog').showModal();
  }
  async function archiveVehicleByVehicle(vehicleId){
    if(!isAdmin())throw new Error('Seule l’administration peut archiver un véhicule.');
    const v=records.find(x=>x.id===vehicleId);if(!v?.orderId)throw new Error('Dossier introuvable.');
    const inspection=inspections.find(x=>x.work_order_id===v.orderId&&x.status==='submitted');
    if(!inspection)throw new Error('Le contrôle doit être transmis par le mécanicien avant la remise.');
    if(!confirm('Confirmer que le message client a été envoyé et que le véhicule a bien été remis ? Le dossier sera ensuite déplacé dans l’historique.'))return;
    const {error}=await client.from('work_orders').update({status:'closed'}).eq('id',v.orderId).eq('garage_id',garageId);
    if(error)throw error;
    const {error:ie}=await client.from('inspections').update({status:'archived'}).eq('id',inspection.id).eq('garage_id',garageId);if(ie)throw ie;
    await loadRecords();view='archives';render();
  }

  /* WORKSHOP_PLANNING_MODULE */
  document.addEventListener('click',async ev=>{
    const nav=ev.target.closest('[data-view]');
    if(nav){view=nav.dataset.view;render();return;}
    const viewBtn=ev.target.closest('[data-view-action]');
    if(viewBtn){if(!isAdmin() && viewBtn.dataset.viewAction!=='planning')return;view=viewBtn.dataset.viewAction;render();return;}
    const btn=ev.target.closest('[data-action]');
    if(!btn)return;
    const id=btn.dataset.id, action=btn.dataset.action;
    if(!isAdmin() && !['appointment','start-inspection','check-result','check-note','inspection-attachment','finish-inspection','back-orders','close','add-quote'].includes(action)) return;
    if(action==='open'){selectedId=id;view='orders';render();}
    if(action==='edit')openForm('edit',id);
    if(action==='add-quote')openForm('quote',id);
    if(action==='close'){const dlg=btn.closest('dialog');if(dlg){dlg.close();dlg.remove();}}
    if(action==='status')return;
    if(action==='ready'){if(isAdmin())try{openClientMessageDialog(id);}catch(err){alert(errorMessage(err));}}
    if(action==='new-appointment')openAppointmentForm();
    if(action==='edit-appointment'){const dlg=btn.closest('dialog');if(dlg){dlg.close();dlg.remove();}openAppointmentForm(id);}
    if(action==='cancel-appointment'){const dlg=btn.closest('dialog');if(dlg){dlg.close();dlg.remove();}cancelAppointment(id).catch(err=>alert(errorMessage(err)));}
    if(action==='open-add-mechanic')openAddMechanicDialog();
    if(action==='edit-mechanic')openEditMechanicDialog(id);
    if(action==='toggle-mechanic'){const active=btn.dataset.active==='true';if(confirm(active?'Suspendre l’accès de ce mécanicien ?':'Réactiver l’accès de ce mécanicien ?'))manageMechanic(id,active?'deactivate':'activate').catch(err=>alert(errorMessage(err)));}
    if(action==='add-mechanic')addMechanic(id).catch(err=>alert(errorMessage(err)));
    if(action==='appointment'){const a=appointments.find(x=>x.id===id);if(a)openAppointmentDetails(a);}
    if(action==='inspection'){const v=records.find(x=>x.id===id);if(v?.orderId)openInspection(v.orderId).catch(err=>alert(errorMessage(err)));}
    if(action==='back-orders'){view=isAdmin()?'orders':'planning';render();}
    if(action==='finish-inspection')submitInspection(btn).catch(err=>alert(errorMessage(err)));
    if(action==='start-inspection'){const dlg=btn.closest('dialog');if(dlg){dlg.close();dlg.remove();}openInspection(btn.dataset.workOrderId,btn.dataset.appointmentId).catch(err=>alert(errorMessage(err)));}
    if(action==='review-inspection')openInspection(btn.dataset.workOrderId).catch(err=>alert(errorMessage(err)));
    if(action==='message-client'||action==='open-client-message'){if(!isAdmin())return;try{openClientMessageDialog(id);}catch(err){alert(errorMessage(err));}}
    if(action==='launch-client-message')launchClientMessage().catch(err=>alert(errorMessage(err)));
    if(action==='open-prepared-client-message'){try{openPreparedClientMessage();}catch(err){alert(errorMessage(err));}}
    if(action==='confirm-client-message')confirmClientMessageAndArchive().catch(err=>alert(errorMessage(err)));
  });
  document.addEventListener('change',async ev=>{
    const el=ev.target;
    if(el.dataset.action==='status' && isAdmin())changeStatus(el.dataset.id,el.value);
    if(el.dataset.action==='check-result'&&el.value)inspectionSaveQueue=inspectionSaveQueue.then(()=>saveInspectionResult(el.dataset.item,{state:el.value,note:el.value==='anomaly'?(inspectionResults.find(r=>r.item_id===el.dataset.item)?.note||null):null})).then(()=>renderInspection(activeInspection.work_order_id)).catch(err=>alert(errorMessage(err)));
    if(el.dataset.action==='check-note')inspectionSaveQueue=inspectionSaveQueue.then(()=>saveInspectionResult(el.dataset.item,{note:el.value})).catch(err=>alert(errorMessage(err)));
    if(el.dataset.action==='inspection-attachment'&&el.files?.length)inspectionAttachmentQueue=inspectionAttachmentQueue.then(()=>uploadInspectionAttachments(el.dataset.item,el.files)).catch(err=>alert(errorMessage(err)));
    if(el.dataset.action==='quote-status'){
      const {error}=await client.from('quotes').update({status:el.value}).eq('id',el.dataset.id).eq('garage_id',garageId);
      if(error)alert('Décision du devis non enregistrée : '+errorMessage(error));
      await loadRecords(); render();
    }
  });
  $('#new-vehicle').addEventListener('click',()=>openForm('new'));
  // The initial session is restored below; explicit sign-in/sign-out handlers manage UI state.
  (async()=>{
    try {
      const {data,error}=await client.auth.getSession(); if(error)throw error;
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const authType = hashParams.get('type') || new URLSearchParams(window.location.search).get('type') || '';
      const isPasswordSetup = new URLSearchParams(window.location.search).get('setup-password') === '1' || authType === 'invite' || authType === 'recovery';
      if(data.session){
        user=data.session.user;
        if(isPasswordSetup){
          $('#auth-form').hidden=true;
          $('#toggle-signup').hidden=true;
          $('#password-setup-panel').hidden=false;
          showScreen('auth');
        }else await continueAfterAuth();
      } else {
        showScreen('auth');
        const authError = hashParams.get('error_description') || new URLSearchParams(window.location.search).get('error_description');
        if (authError) notice('#auth-message','Le lien d’invitation a expiré ou n’est plus valide. Demandez à l’administrateur de renvoyer une invitation.','error');
      }
    } catch(err) { showScreen('auth');notice('#auth-message',errorMessage(err),'error'); }
  })();
})();