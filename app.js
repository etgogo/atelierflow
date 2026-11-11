(() => {
  'use strict';
  const cfg = window.ATELIERFLOW_CONFIG;
  const client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
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
  let user = null, garageId = null, garageName = '', records = [], view = 'dashboard', selectedId = null;
  let signupMode = false;
  let language = 'fr';
  localStorage.setItem('atelierflow-language','fr');
  const I18N = {
    fr:{dashboard:'Tableau de bord',vehicles:'Véhicules',orders:'Ordres de travail',quotes:'Devis',planning:'Planning atelier',team:'Équipe & administration',settings:'Paramètres',active:'Dossiers actifs',ongoing:'En cours',pending:'Devis en attente',ready:'Prêts à récupérer',activity:'Activité atelier',allVehicles:'Tous les véhicules',schedule:'Planning de l’atelier',scheduleHint:'Une ligne par membre de l’équipe · créneaux positionnés par heure',settingsTitle:'Paramètres généraux',language:'Langue de l’interface',languageHint:'Le choix est enregistré sur cet appareil.',save:'Enregistrer les préférences',saved:'Préférences enregistrées.'},
    nl:{dashboard:'Dashboard',vehicles:'Voertuigen',orders:'Werkorders',quotes:'Offertes',planning:'Werkplaatsplanning',team:'Team & beheer',settings:'Instellingen',active:'Actieve dossiers',ongoing:'In uitvoering',pending:'Openstaande offertes',ready:'Klaar om op te halen',activity:'Werkplaatsactiviteit',allVehicles:'Alle voertuigen',schedule:'Werkplaatsplanning',scheduleHint:'Eén rij per teamlid · tijdsblokken per uur',settingsTitle:'Algemene instellingen',language:'Taal van de interface',languageHint:'Deze keuze wordt op dit apparaat opgeslagen.',save:'Voorkeuren opslaan',saved:'Voorkeuren opgeslagen.'},
    en:{dashboard:'Dashboard',vehicles:'Vehicles',orders:'Work orders',quotes:'Quotes',planning:'Workshop schedule',team:'Team & administration',settings:'Settings',active:'Active jobs',ongoing:'In progress',pending:'Pending quotes',ready:'Ready for pickup',activity:'Workshop activity',allVehicles:'All vehicles',schedule:'Workshop schedule',scheduleHint:'One row per team member · time slots by hour',settingsTitle:'General settings',language:'Interface language',languageHint:'Your choice is saved on this device.',save:'Save preferences',saved:'Preferences saved.'}
  };
  function t(key){return (I18N[language]||I18N.fr)[key]||I18N.fr[key]||key;}
  function syncLanguageShell(){document.documentElement.lang=language;document.querySelectorAll('.nav-item').forEach(b=>{b.textContent=t(b.dataset.view);});}
  let membershipRole='mechanic', staff=[], appointments=[], appointmentAssignments=[], mechanicProfiles=[], checklistTemplate=null, checklistCategories=[], checklistItems=[], activeInspection=null, inspectionResults=[];

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

  $('#toggle-signup').addEventListener('click', () => {
    signupMode = !signupMode;
    $('#name-field').hidden = !signupMode;
    $('#auth-submit').textContent = signupMode ? 'Créer mon compte' : 'Se connecter';
    $('#toggle-signup').textContent = signupMode ? 'J’ai déjà un compte' : 'Créer un compte';
    $('#auth-form').elements.password.autocomplete = signupMode ? 'new-password' : 'current-password';
    $('#auth-message').hidden = true;
  });

  $('#auth-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget, email = f.elements.email.value.trim(), password = f.elements.password.value;
    const btn = $('#auth-submit');
    btn.disabled = true; btn.textContent = 'Veuillez patienter…';
    try {
      if (signupMode) {
        const fullName = f.elements.full_name.value.trim();
        if (!fullName) throw new Error('Indiquez votre nom complet.');
        const result = await client.auth.signUp({email, password, options:{data:{full_name:fullName}, emailRedirectTo:window.location.origin + window.location.pathname}});
        if (result.error) throw result.error;
        if (!result.data.session) {
          notice('#auth-message','Compte créé. Consultez votre boîte e-mail et confirmez votre adresse avant de vous connecter.','success');
        } else {
          user = result.data.user;
          await continueAfterAuth();
        }
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
    const {data:garage,error:garageError} = await client.from('garages').select('name').eq('id',garageId).single();
    if (garageError) throw garageError;
    garageName = garage.name;
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
    render();
  }

  async function loadRecords() {
    $('#app').innerHTML='<p class="empty">Synchronisation des données…</p>';
    const results = await Promise.all([
      client.from('clients').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('vehicles').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('work_orders').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('quotes').select('*').eq('garage_id',garageId).order('created_at',{ascending:false}),
      client.from('appointments').select('*').eq('garage_id',garageId).order('starts_at'),
      client.from('appointment_mechanics').select('*').eq('garage_id',garageId),
      client.from('mechanic_profiles').select('*').eq('garage_id',garageId),
      client.from('garage_memberships').select('id,profile_id,role,is_active').eq('garage_id',garageId).eq('is_active',true),
      client.from('profiles').select('id,full_name,is_active')
    ]);
    for (const r of results) if (r.error) throw r.error;
    const clients=results[0].data||[], vehicles=results[1].data||[], orders=results[2].data||[], quotes=results[3].data||[];
    appointments=results[4].data||[]; appointmentAssignments=results[5].data||[]; mechanicProfiles=results[6].data||[];
    const memberships=results[7].data||[], profiles=results[8].data||[];
    staff=memberships.map(m=>({profileId:m.profile_id,role:m.role,profile:profiles.find(p=>p.id===m.profile_id)||{},mechanic:mechanicProfiles.find(mp=>mp.profile_id===m.profile_id)||null}));
    records=vehicles.map(v=>{
      const c=clients.find(x=>x.id===v.client_id)||{};
      const o=orders.find(x=>x.vehicle_id===v.id)||{};
      const qs=quotes.filter(q=>q.vehicle_id===v.id).map(q=>({
        id:q.id, description:q.title, amount:q.amount,
        decision:({pending:'En attente',accepted:'Accepté',rejected:'Refusé',expired:'Expiré'})[q.status]||'En attente',
        createdAt:q.created_at
      }));
      const name=[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company_name||'Client';
      const status=STATUS[o.status]||'À planifier';
      const noteLines=String(o.conclusion||'').split('\n');
      return {
        id:v.id, clientId:c.id, orderId:o.id, clientName:name, phone:c.phone||'',
        brand:v.brand, model:v.model, plate:v.registration_number, plannedDate:o.planned_start,
        status, workRequested:o.description||'', workDone:noteLines[0]||'',
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
    const titles={dashboard:t('dashboard'),vehicles:t('vehicles'),orders:t('orders'),quotes:t('quotes'),planning:t('planning'),team:t('team'),settings:t('settings')};
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
    else if(view==='team') { renderTeam(); }
    else if(view==='settings') { renderSettings(); }
  }
  function orderDetail(v) {
    const statusOptions=['À planifier','En cours','En attente client','Prêt à récupérer','Annulé'];
    return '<div class="panel-heading"><div><h2>'+esc(v.brand)+' '+esc(v.model)+'</h2><p class="muted">'+esc(v.clientName)+' · '+esc(v.plate)+'</p></div><button class="secondary-btn" data-action="edit" data-id="'+esc(v.id)+'">Modifier</button></div>'+
      '<div class="detail-block"><b>Travail demandé</b><p>'+esc(v.workRequested||'—')+'</p></div><div class="detail-block"><b>Travail effectué / notes</b><p>'+esc(v.workDone||'À renseigner')+'</p></div>'+
      '<div class="detail-block"><label class="inline-label">Statut <select data-action="status" data-id="'+esc(v.id)+'">'+statusOptions.map(s=>'<option '+(v.status===s?'selected':'')+'>'+s+'</option>').join('')+'</select></label></div>'+
      '<div class="button-row"><button class="secondary-btn" data-action="edit" data-id="'+esc(v.id)+'">Mettre à jour l’ordre</button><button class="primary-btn" data-action="add-quote" data-id="'+esc(v.id)+'">Ajouter un devis</button><button class="secondary-btn" data-action="inspection" data-id="'+esc(v.id)+'">Contrôle véhicule</button><button class="primary-btn" data-action="ready" data-id="'+esc(v.id)+'">Préparer SMS</button></div>';
  }

  function openForm(kind,id) {
    const v=records.find(x=>x.id===id);
    let html='';
    if(kind==='new') {
      html='<dialog id="data-dialog"><form id="data-form"><div class="dialog-head"><h2>Nouveau dossier véhicule</h2><button class="icon-btn" type="button" data-action="close">×</button></div><div class="form-grid">'+
      '<label>Nom du client<input name="clientName" required maxlength="100"></label><label>Téléphone<input name="phone" type="tel" maxlength="40"></label><label>Marque<input name="brand" required maxlength="60"></label><label>Modèle<input name="model" required maxlength="60"></label><label>Immatriculation<input name="plate" required maxlength="30"></label><label>Date prévue<input name="plannedDate" type="date"></label><label class="full">Travail demandé<textarea name="workRequested" rows="3" maxlength="1500"></textarea></label></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Créer le dossier</button></div></form></dialog>';
    } else if(kind==='edit' && v) {
      html='<dialog id="data-dialog"><form id="data-form"><div class="dialog-head"><h2>Modifier le dossier</h2><button class="icon-btn" type="button" data-action="close">×</button></div><input type="hidden" name="id" value="'+esc(v.id)+'"><div class="form-grid"><label class="full">Travail effectué / notes<textarea name="workDone" rows="4">'+esc(v.workDone)+'</textarea></label><label class="full">Tâches / opérations réalisées (une par ligne)<textarea name="tasks" rows="4">'+esc(v.tasks.join('\n'))+'</textarea></label></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div></form></dialog>';
    } else if(kind==='quote' && v) {
      html='<dialog id="data-dialog"><form id="data-form"><div class="dialog-head"><h2>Ajouter un devis complémentaire</h2><button class="icon-btn" type="button" data-action="close">×</button></div><input type="hidden" name="id" value="'+esc(v.id)+'"><div class="form-grid"><label class="full">Anomalie et proposition<textarea name="description" required rows="3"></textarea></label><label>Montant estimé (€)<input name="amount" type="number" min="0" step="0.01" required></label></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Enregistrer le devis</button></div></form></dialog>';
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
        dlg.close(); dlg.remove(); await loadRecords(); render();
      } catch(err) { alert('Impossible d’enregistrer : '+errorMessage(err)); submit.disabled=false; submit.textContent='Réessayer'; }
    });
  }

  async function createVehicle(d) {
    const name=String(d.get('clientName')).trim().split(/\s+/);
    const first=name.shift()||'Client', last=name.join(' ');
    const {data:c,error:ce}=await client.from('clients').insert({
      garage_id:garageId,first_name:first,last_name:last||null,phone:String(d.get('phone')||'').trim()||null
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
    const v=records.find(x=>x.id===d.get('id')); if(!v||!v.orderId)throw new Error('Ordre de travail introuvable.');
    const conclusion=[String(d.get('workDone')||'').trim(),...String(d.get('tasks')||'').split('\n').map(x=>x.trim()).filter(Boolean)].filter(Boolean).join('\n');
    const {error}=await client.from('work_orders').update({conclusion}).eq('id',v.orderId).eq('garage_id',garageId);
    if(error)throw error;
  }

  async function addQuote(d) {
    const v=records.find(x=>x.id===d.get('id')); if(!v||!v.orderId)throw new Error('Ordre de travail introuvable.');
    const {error}=await client.from('quotes').insert({
      garage_id:garageId,work_order_id:v.orderId,vehicle_id:v.id,
      quote_number:'AF-'+Date.now(),title:String(d.get('description')).trim(),
      amount:Number(d.get('amount')),status:'pending',created_by:user.id
    });
    if(error)throw error;
    const {error:statusError}=await client.from('work_orders').update({status:'awaiting_customer'}).eq('id',v.orderId);
    if(statusError)throw statusError;
  }

  async function changeStatus(id,label) {
    const v=records.find(x=>x.id===id); if(!v||!v.orderId)return;
    if(label==='Clôturé') { alert('La clôture exige les kilométrages d’entrée et de sortie. Cette saisie sera ajoutée avant d’activer cette action.'); render(); return; }
    const status=TO_DB[label]; if(!status)return;
    const {error}=await client.from('work_orders').update({status}).eq('id',v.orderId).eq('garage_id',garageId);
    if(error)alert('Statut non modifié : '+errorMessage(error));
    await loadRecords(); render();
  }

  function sms(v) {
    if(!v.phone){alert('Aucun numéro de téléphone enregistré.');return;}
    const message='Bonjour '+v.clientName+', votre '+v.brand+' '+v.model+' ('+v.plate+') est prêt à être récupéré. Vous pouvez venir le chercher. Merci.';
    window.location.href='sms:'+encodeURIComponent(v.phone)+'?&body='+encodeURIComponent(message);
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
    const people=staff.filter(s=>s.mechanic);
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
    $('#app').innerHTML='<section class="panel settings-panel"><div class="panel-heading"><div><h2>'+t('settingsTitle')+'</h2><p class="muted">Personnalisez votre espace AtelierFlow.</p></div></div><div class="settings-row"><div><label for="language-setting"><b>'+t('language')+'</b></label><p class="muted">'+t('languageHint')+'</p></div><select id="language-setting" class="settings-select" disabled><option value="fr" selected>Français</option></select></div><p class="muted settings-note">Toute l’interface AtelierFlow est réglée en français. D’autres langues pourront être ajoutées ultérieurement.</p></section>';
  }

  function renderTeam(){
    const candidates=staff.filter(s=>!s.mechanic);
    $('#app').innerHTML='<section class="panel"><div class="panel-heading"><div><h2>Équipe de l’atelier</h2><p class="muted">Ajoutez un compte existant en un seul clic.</p></div>'+(isAdmin()?'<button class="primary-btn" data-action="open-add-mechanic">+ Ajouter un mécanicien</button>':'')+'</div><div class="team-list">'+(staff.length?staff.map(s=>'<article class="team-row"><div><b>'+esc(s.profile.full_name||'Compte sans nom')+'</b><small>'+(s.role==='admin'?'Administrateur':'Membre de l’atelier')+(s.profile.is_active===false?' · Inactif':'')+'</small></div><div>'+(s.mechanic?'<span class="badge green">Mécanicien créé</span>':(isAdmin()?'<span class="muted">Pas encore mécanicien</span>':'<span class="muted">Non configuré</span>'))+'</div></article>').join(''):'<p class="empty">Aucun membre n’est encore rattaché à cet atelier.</p>')+'</div>'+(isAdmin()?'<p class="muted team-help">Le compte du mécanicien doit déjà avoir rejoint cet atelier. Sélectionnez-le ensuite pour lui créer son profil et l’ajouter au planning.</p>':'')+'</section>';
  }
  function openAddMechanicDialog(){
    if(!isAdmin())return;
    const candidates=staff.filter(s=>!s.mechanic);
    if(!candidates.length){alert('Tous les membres actuels ont déjà un profil mécanicien. Pour ajouter une nouvelle personne, elle doit d’abord créer son compte et rejoindre cet atelier.');return;}
    const options=candidates.map(s=>'<option value="'+esc(s.profileId)+'">'+esc(s.profile.full_name||'Compte sans nom')+' · '+esc(s.role==='admin'?'Administrateur':'Membre')+'</option>').join('');
    const old=$('#data-dialog');if(old)old.remove();
    document.body.insertAdjacentHTML('beforeend','<dialog id="data-dialog"><form id="add-mechanic-form"><div class="dialog-head"><h2>Ajouter un mécanicien</h2><button class="icon-btn" type="button" data-action="close">×</button></div><p class="muted">Choisissez une personne déjà membre de votre atelier. Son profil sera ajouté au planning.</p><div class="form-grid"><label class="full">Membre à ajouter<select name="mechanic_profile_id" required>'+options+'</select></label></div><div class="dialog-actions"><button class="secondary-btn" type="button" data-action="close">Annuler</button><button class="primary-btn" type="submit">Créer le profil mécanicien</button></div></form></dialog>');
    const dlg=$('#data-dialog');dlg.showModal();
    $('#add-mechanic-form').addEventListener('submit',async ev=>{
      ev.preventDefault();const form=ev.currentTarget,btn=form.querySelector('[type=submit]');btn.disabled=true;
      try{await addMechanic(form.elements.mechanic_profile_id.value);dlg.close();dlg.remove();}
      catch(err){alert('Impossible de créer le profil : '+errorMessage(err));btn.disabled=false;}
    });
  }
  async function addMechanic(profileId){
    if(!isAdmin())throw new Error('Réservé à l’administrateur.');
    const {error}=await client.from('mechanic_profiles').insert({garage_id:garageId,profile_id:profileId});
    if(error)throw error;await loadRecords();render();
  }
  function openAppointmentForm(){
    if(!isAdmin())return;
    const options=records.filter(v=>v.orderId).map(v=>'<option value="'+esc(v.orderId)+'">'+esc(v.brand+' '+v.model+' · '+v.plate+' — '+v.clientName)+'</option>').join('');
    const mechanics=staff.filter(s=>s.mechanic).map(s=>'<option value="'+esc(s.mechanic.id)+'">'+esc(s.profile.full_name||'Mécanicien')+'</option>').join('');
    if(!mechanics){alert('Ajoutez d’abord les profils des mécaniciens dans Équipe & administration.');return;}
    const d=new Date();d.setMinutes(0,0,0);d.setHours(Math.max(7,Math.min(17,d.getHours()+1)));
    const finish=new Date(d.getTime()+3600000);
    const start=dateInputValue(d)+'T'+String(d.getHours()).padStart(2,'0')+':00';
    const end=dateInputValue(finish)+'T'+String(finish.getHours()).padStart(2,'0')+':00';
    showAppointmentDialog('<h2>Planifier une intervention</h2><div class="form-grid"><label class="full">Travail / intervention<input name="title" required maxlength="160" placeholder="Ex. Remplacement des freins"></label><label class="full">Dossier véhicule<select name="work_order_id"><option value="">Intervention sans dossier lié</option>'+options+'</select></label><label>Mécanicien<select name="mechanic_id" required>'+mechanics+'</select></label><label>Début<input type="datetime-local" name="starts_at" value="'+start+'" required></label><label>Fin<input type="datetime-local" name="ends_at" value="'+end+'" required></label><label class="full">Notes<textarea name="notes" rows="2"></textarea></label></div>');
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
    const {data:a,error}=await client.from('appointments').insert({garage_id:garageId,work_order_id:String(d.get('work_order_id')||'')||null,title:String(d.get('title')).trim(),starts_at:starts.toISOString(),ends_at:ends.toISOString(),notes:String(d.get('notes')||'').trim()||null,created_by:user.id}).select().single();
    if(error)throw error;
    const {error:ae}=await client.from('appointment_mechanics').insert({garage_id:garageId,appointment_id:a.id,mechanic_profile_id:String(d.get('mechanic_id'))});
    if(ae){await client.from('appointments').delete().eq('id',a.id);throw ae;}
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
  async function openInspection(workOrderId){
    await ensureChecklist();
    const {data:ins,error}=await client.from('inspections').select('*').eq('work_order_id',workOrderId).eq('template_id',checklistTemplate.id).order('created_at',{ascending:false}).limit(1);
    if(error)throw error;activeInspection=ins?.[0]||null;
    if(!activeInspection){
      if(!isAdmin())throw new Error('L’administrateur doit démarrer ce contrôle.');
      const {data:i,error:ie}=await client.from('inspections').insert({garage_id:garageId,work_order_id:workOrderId,template_id:checklistTemplate.id,conducted_by:user.id,status:'in_progress'}).select().single();
      if(ie)throw ie;activeInspection=i;
    }
    const {data:r,error:re}=await client.from('inspection_results').select('*').eq('inspection_id',activeInspection.id);
    if(re)throw re;inspectionResults=r||[];renderInspection(workOrderId);
  }
  function renderInspection(workOrderId){
    const v=records.find(x=>x.orderId===workOrderId);
    const sections=checklistCategories.map(cat=>{
      const items=checklistItems.filter(i=>i.category_id===cat.id);
      return '<section class="check-group"><h3>'+esc(cat.name)+'</h3>'+items.map(item=>{
        const result=inspectionResults.find(r=>r.item_id===item.id),state=result?.state||'';
        return '<div class="check-row"><b>'+esc(item.name)+'</b><select data-action="check-result" data-item="'+esc(item.id)+'" '+(!isAdmin()?'disabled':'')+'><option value="ok" '+(state==='ok'?'selected':'')+'>Conforme</option><option value="anomaly" '+(state==='anomaly'?'selected':'')+'>Anomalie</option><option value="n/a" '+(state==='n/a'?'selected':'')+'>Non applicable</option></select><input class="check-note" data-action="check-note" data-item="'+esc(item.id)+'" placeholder="Observation" value="'+esc(result?.note||'')+'" '+(!isAdmin()?'disabled':'')+'></div>';
      }).join('')+'</section>';
    }).join('');
    $('#page-title').textContent='Contrôle véhicule';
    const done=inspectionResults.filter(r=>r.state==='ok'||r.state==='anomaly'||r.state==='n/a').length;
    $('#app').innerHTML='<section class="panel"><div class="panel-heading"><div><h2>'+esc(v?v.brand+' '+v.model:'Contrôle')+'</h2><p class="muted">'+esc(v?v.plate:'')+' · '+esc(v?v.clientName:'')+'</p></div><button class="secondary-btn" data-action="back-orders">Retour aux ordres</button></div><div class="inspection-progress">'+done+' / '+checklistItems.length+' contrôles enregistrés</div>'+sections+'<div class="button-row">'+(isAdmin()?'<button class="primary-btn" data-action="finish-inspection">Terminer le contrôle</button>':'<span class="muted">Consultation en lecture seule pour ce compte.</span>')+'</div></section>';
  }
  async function saveInspectionResult(itemId,patch){
    if(!isAdmin())throw new Error('Les droits actuels autorisent uniquement l’administrateur à modifier les contrôles.');
    const current=inspectionResults.find(r=>r.item_id===itemId);
    const payload={garage_id:garageId,inspection_id:activeInspection.id,item_id:itemId,...(current?{}:{state:'ok'}),...patch};
    const {data,error}=await client.from('inspection_results').upsert(payload,{onConflict:'inspection_id,item_id'}).select().single();
    if(error)throw error;
    const idx=inspectionResults.findIndex(r=>r.item_id===itemId);if(idx>=0)inspectionResults[idx]=data;else inspectionResults.push(data);
  }
  async function finishInspection(){
    if(!isAdmin())return;
    const missing=checklistItems.filter(i=>!inspectionResults.some(r=>r.item_id===i.id));
    if(missing.length){alert('Il reste '+missing.length+' contrôle(s) sans résultat.');return;}
    const {error}=await client.from('inspections').update({status:'completed'}).eq('id',activeInspection.id);
    if(error)throw error;alert('Contrôle terminé et enregistré.');
  }

  /* WORKSHOP_PLANNING_MODULE */
  document.addEventListener('click',async ev=>{
    const nav=ev.target.closest('[data-view]');
    if(nav){view=nav.dataset.view;render();return;}
    const viewBtn=ev.target.closest('[data-view-action]');
    if(viewBtn){view=viewBtn.dataset.viewAction;render();return;}
    const btn=ev.target.closest('[data-action]');
    if(!btn)return;
    const id=btn.dataset.id, action=btn.dataset.action;
    if(action==='open'){selectedId=id;view='orders';render();}
    if(action==='edit')openForm('edit',id);
    if(action==='add-quote')openForm('quote',id);
    if(action==='close'){const dlg=btn.closest('dialog');if(dlg){dlg.close();dlg.remove();}}
    if(action==='status')return;
    if(action==='ready'){const v=records.find(x=>x.id===id);if(v&&confirm('Préparer un SMS indiquant que le véhicule est prêt ?'))sms(v);}
    if(action==='new-appointment')openAppointmentForm();
    if(action==='open-add-mechanic')openAddMechanicDialog();
    if(action==='add-mechanic')addMechanic(id).catch(err=>alert(errorMessage(err)));
    if(action==='appointment'){const a=appointments.find(x=>x.id===id);if(a)alert(a.title+' | '+timeLabel(a.starts_at)+' – '+timeLabel(a.ends_at)+' | '+(a.notes||'Aucune note'));}
    if(action==='inspection'){const v=records.find(x=>x.id===id);if(v?.orderId)openInspection(v.orderId).catch(err=>alert(errorMessage(err)));}
    if(action==='back-orders'){view='orders';render();}
    if(action==='finish-inspection')finishInspection().catch(err=>alert(errorMessage(err)));
  });
  document.addEventListener('change',async ev=>{
    const el=ev.target;
    if(el.dataset.action==='status')changeStatus(el.dataset.id,el.value);
    if(el.dataset.action==='check-result')saveInspectionResult(el.dataset.item,{state:el.value}).then(()=>renderInspection(activeInspection.work_order_id)).catch(err=>alert(errorMessage(err)));
    if(el.dataset.action==='check-note')saveInspectionResult(el.dataset.item,{note:el.value}).catch(err=>alert(errorMessage(err)));
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
      if(data.session){user=data.session.user;await continueAfterAuth();} else showScreen('auth');
    } catch(err) { showScreen('auth');notice('#auth-message',errorMessage(err),'error'); }
  })();
})();