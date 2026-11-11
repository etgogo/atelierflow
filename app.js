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
        const result = await client.auth.signUp({email, password, options:{data:{full_name:fullName}}});
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
      client.from('quotes').select('*').eq('garage_id',garageId).order('created_at',{ascending:false})
    ]);
    for (const r of results) if (r.error) throw r.error;
    const clients=results[0].data||[], vehicles=results[1].data||[], orders=results[2].data||[], quotes=results[3].data||[];
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
    const titles={dashboard:'Tableau de bord',vehicles:'Véhicules',orders:'Ordres de travail',quotes:'Devis',planning:'Planning'};
    $('#page-title').textContent=titles[view]||titles.dashboard;
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    if(view==='dashboard') {
      const pending=records.reduce((n,v)=>n+v.quotes.filter(q=>q.decision==='En attente').length,0);
      $('#app').innerHTML='<section class="stats"><article><span>Dossiers actifs</span><strong>'+activeVehicles().length+'</strong></article><article><span>En cours</span><strong>'+records.filter(v=>v.status==='En cours').length+'</strong></article><article><span>Devis en attente</span><strong>'+pending+'</strong></article><article><span>Prêts à récupérer</span><strong>'+records.filter(v=>v.status==='Prêt à récupérer').length+'</strong></article></section><section class="panel"><div class="panel-heading"><h2>Activité atelier</h2><button class="secondary-btn" data-view-action="vehicles">Tous les véhicules</button></div>'+vehicleRows(activeVehicles())+'</section>';
    } else if(view==='vehicles') {
      $('#app').innerHTML='<section class="panel"><div class="panel-heading"><h2>Tous les dossiers</h2><input id="vehicle-search" class="search" type="search" placeholder="Rechercher client, véhicule, immatriculation…"></div><div id="vehicle-table">'+vehicleRows(records)+'</div></section>';
      $('#vehicle-search').addEventListener('input',e=>{const q=e.target.value.toLocaleLowerCase('fr');$('#vehicle-table').innerHTML=vehicleRows(records.filter(v=>[v.clientName,v.brand,v.model,v.plate].some(x=>String(x||'').toLocaleLowerCase('fr').includes(q))));});
    } else if(view==='orders') {
      const selected=records.find(v=>v.id===selectedId)||records[0];
      $('#app').innerHTML='<section class="two-col"><div class="panel"><div class="panel-heading"><h2>Dossiers atelier</h2></div>'+vehicleRows(activeVehicles())+'</div><div class="panel">'+(selected?orderDetail(selected):'<p class="empty">Créez un dossier pour commencer.</p>')+'</div></section>';
    } else if(view==='quotes') {
      const rows=[];records.forEach(v=>v.quotes.forEach(q=>rows.push({v,q})));
      $('#app').innerHTML='<section class="panel"><div class="panel-heading"><h2>Devis complémentaires</h2></div>'+(rows.length?'<div class="table-wrap"><table><thead><tr><th>Véhicule / client</th><th>Proposition</th><th>Montant</th><th>Décision</th></tr></thead><tbody>'+rows.map(x=>'<tr><td><strong>'+esc(x.v.brand)+' '+esc(x.v.model)+'</strong><small>'+esc(x.v.clientName)+'</small></td><td>'+esc(x.q.description)+'</td><td>'+money(x.q.amount)+'</td><td>'+esc(x.q.decision)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="empty">Aucun devis enregistré.</p>')+'</section>';
    } else {
      const list=records.slice().sort((a,b)=>String(a.plannedDate||'').localeCompare(String(b.plannedDate||'')));
      $('#app').innerHTML='<section class="panel"><div class="panel-heading"><h2>Planning des entrées</h2><p class="muted">Trié par date prévue</p></div>'+(list.length?'<div class="planning-list">'+list.map(v=>'<article class="planning-item"><div class="planning-date"><strong>'+date(v.plannedDate)+'</strong></div><div class="planning-info"><strong>'+esc(v.brand)+' '+esc(v.model)+' · '+esc(v.plate)+'</strong><span>'+esc(v.clientName)+' · '+esc(v.workRequested)+'</span></div><span class="badge '+statusClass(v.status)+'">'+esc(v.status)+'</span><button class="text-btn" data-action="open" data-id="'+esc(v.id)+'">Ouvrir</button></article>').join('')+'</div>':'<p class="empty">Aucun rendez-vous planifié.</p>')+'</section>';
    }
  }
  function orderDetail(v) {
    const statusOptions=['À planifier','En cours','En attente client','Prêt à récupérer','Annulé'];
    return '<div class="panel-heading"><div><h2>'+esc(v.brand)+' '+esc(v.model)+'</h2><p class="muted">'+esc(v.clientName)+' · '+esc(v.plate)+'</p></div><button class="secondary-btn" data-action="edit" data-id="'+esc(v.id)+'">Modifier</button></div>'+
      '<div class="detail-block"><b>Travail demandé</b><p>'+esc(v.workRequested||'—')+'</p></div><div class="detail-block"><b>Travail effectué / notes</b><p>'+esc(v.workDone||'À renseigner')+'</p></div>'+
      '<div class="detail-block"><label class="inline-label">Statut <select data-action="status" data-id="'+esc(v.id)+'">'+statusOptions.map(s=>'<option '+(v.status===s?'selected':'')+'>'+s+'</option>').join('')+'</select></label></div>'+
      '<div class="button-row"><button class="secondary-btn" data-action="edit" data-id="'+esc(v.id)+'">Mettre à jour l’ordre</button><button class="primary-btn" data-action="add-quote" data-id="'+esc(v.id)+'">Ajouter un devis</button><button class="primary-btn" data-action="ready" data-id="'+esc(v.id)+'">Préparer SMS</button></div>';
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
  });
  document.addEventListener('change',ev=>{
    const el=ev.target;
    if(el.dataset.action==='status')changeStatus(el.dataset.id,el.value);
  });
  $('#new-vehicle').addEventListener('click',()=>openForm('new'));
  client.auth.onAuthStateChange(async (_event,session)=>{
    if(session && !user){user=session.user; try{await continueAfterAuth();}catch(err){showScreen('auth');notice('#auth-message',errorMessage(err),'error');}}
    if(!session){user=null;garageId=null;showScreen('auth');}
  });
  (async()=>{
    try {
      const {data,error}=await client.auth.getSession(); if(error)throw error;
      if(data.session){user=data.session.user;await continueAfterAuth();} else showScreen('auth');
    } catch(err) { showScreen('auth');notice('#auth-message',errorMessage(err),'error'); }
  })();
})();