const STORAGE_KEY = 'atelierflow-v2';
const STATUSES = ['À planifier', 'En cours', 'En attente client', 'Prêt à récupérer', 'Clôturé'];
const initialState = {
  vehicles: [
    {id:'demo-1',clientName:'Martin Dupont',phone:'06 12 34 56 78',brand:'Renault',model:'Clio',plate:'AB-123-CD',plannedDate:'2026-11-12',status:'En cours',workRequested:'Vidange et contrôle des freins',workDone:'Vidange effectuée, contrôle visuel réalisé.',tasks:['Vidange','Contrôle des freins'],parts:['Filtre à huile'],quotes:[{id:'q-demo-1',description:'Plaquettes avant usées, remplacement recommandé.',amount:180,decision:'En attente',createdAt:new Date().toISOString()}]},
    {id:'demo-2',clientName:'Sophie Bernard',phone:'07 98 76 54 32',brand:'Peugeot',model:'208',plate:'XY-456-ZT',plannedDate:'2026-11-13',status:'En attente client',workRequested:'Diagnostic bruit à l’avant',workDone:'Bruit localisé aux rotules avant.',tasks:['Diagnostic','Contrôle train avant'],parts:[],quotes:[{id:'q-demo-2',description:'Remplacement des rotules avant.',amount:220,decision:'En attente',createdAt:new Date().toISOString()}]},
    {id:'demo-3',clientName:'Nicolas Martin',phone:'06 65 44 33 22',brand:'Citroën',model:'C3',plate:'ZZ-999-KL',plannedDate:'2026-11-14',status:'Prêt à récupérer',workRequested:'Diagnostic et remplacement batterie',workDone:'Diagnostic terminé. Batterie remplacée.',tasks:['Diagnostic','Remplacement batterie'],parts:['Batterie 12 V'],quotes:[]}
  ], selectedId:'demo-1'
};
let state = loadState();
let currentView = 'dashboard';
const app = document.querySelector('#app');
const vehicleDialog = document.querySelector('#vehicle-dialog');
const quoteDialog = document.querySelector('#quote-dialog');
const editDialog = document.querySelector('#edit-dialog');

function loadState(){
  try { const saved=localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved) : structuredClone(initialState); }
  catch { return structuredClone(initialState); }
}
function save(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
function esc(value=''){ return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function money(value){ return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(value)||0); }
function date(value){ if(!value)return '—'; const d=new Date(`${value}T00:00:00`); return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',year:'numeric'}).format(d); }
function statusClass(s){ return {'En cours':'blue','En attente client':'amber','Prêt à récupérer':'green','Clôturé':'gray','À planifier':'gray'}[s]||'gray'; }
function activeVehicles(){ return state.vehicles.filter(v=>v.status!=='Clôturé'); }
function setView(view){ currentView=view; document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); render(); }
function render(){
 const titles={dashboard:'Tableau de bord',vehicles:'Véhicules',orders:'Ordres de travail',quotes:'Devis',planning:'Planning'};
 document.querySelector('#page-title').textContent=titles[currentView]||titles.dashboard;
 if(currentView==='dashboard') return renderDashboard();
 if(currentView==='vehicles') return renderVehicles();
 if(currentView==='orders') return renderOrders();
 if(currentView==='quotes') return renderQuotes();
 if(currentView==='planning') return renderPlanning();
}
function vehicleRows(list){
 if(!list.length)return '<p class="empty">Aucun dossier à afficher.</p>';
 return `<div class="table-wrap"><table><thead><tr><th>Véhicule</th><th>Client</th><th>Prévu</th><th>Statut</th><th></th></tr></thead><tbody>${list.map(v=>`<tr><td><strong>${esc(v.brand)} ${esc(v.model)}</strong><small>${esc(v.plate)}</small></td><td>${esc(v.clientName)}<small>${esc(v.phone)}</small></td><td>${date(v.plannedDate)}</td><td><span class="badge ${statusClass(v.status)}">${esc(v.status)}</span></td><td><button class="text-btn" data-action="open" data-id="${esc(v.id)}">Dossier</button></td></tr>`).join('')}</tbody></table></div>`;
}
function renderDashboard(){
 const list=activeVehicles();
 const pending=state.vehicles.reduce((n,v)=>n+(v.quotes||[]).filter(q=>q.decision==='En attente').length,0);
 const ready=state.vehicles.filter(v=>v.status==='Prêt à récupérer').length;
 app.innerHTML=`<section class="stats"><article><span>Dossiers actifs</span><strong>${list.length}</strong></article><article><span>En cours</span><strong>${state.vehicles.filter(v=>v.status==='En cours').length}</strong></article><article><span>Devis en attente</span><strong>${pending}</strong></article><article><span>Prêts à récupérer</span><strong>${ready}</strong></article></section><section class="panel"><div class="panel-heading"><h2>Activité atelier</h2><button class="secondary-btn" data-view-action="vehicles">Tous les véhicules</button></div>${vehicleRows(list)}</section>`;
}
function renderVehicles(){
 app.innerHTML=`<section class="panel"><div class="panel-heading"><h2>Tous les dossiers</h2><input id="vehicle-search" class="search" type="search" placeholder="Rechercher client, véhicule, immatriculation…"></div><div id="vehicle-table">${vehicleRows(state.vehicles)}</div></section>`;
 document.querySelector('#vehicle-search').addEventListener('input',e=>{const q=e.target.value.trim().toLocaleLowerCase('fr'); const filtered=state.vehicles.filter(v=>[v.clientName,v.brand,v.model,v.plate].some(x=>String(x).toLocaleLowerCase('fr').includes(q)));document.querySelector('#vehicle-table').innerHTML=vehicleRows(filtered);});
}
function renderOrders(){
 const selected=state.vehicles.find(v=>v.id===state.selectedId)||state.vehicles[0];
 app.innerHTML=`<section class="two-col"><div class="panel"><div class="panel-heading"><h2>Dossiers atelier</h2></div>${vehicleRows(activeVehicles())}</div><div class="panel">${selected?orderDetail(selected):'<p class="empty">Créez un dossier pour commencer.</p>'}</div></section>`;
}
function orderDetail(v){return `<div class="panel-heading"><div><h2>${esc(v.brand)} ${esc(v.model)}</h2><p class="muted">${esc(v.clientName)} · ${esc(v.plate)}</p></div><button class="secondary-btn" data-action="edit" data-id="${esc(v.id)}">Modifier</button></div><div class="detail-block"><b>Travail demandé</b><p>${esc(v.workRequested||'—')}</p></div><div class="detail-block"><b>Travail effectué / notes</b><p>${esc(v.workDone||'À renseigner')}</p></div><div class="detail-block"><b>Tâches</b>${lineList(v.tasks)}</div><div class="detail-block"><b>Pièces remplacées</b>${lineList(v.parts)}</div><div class="detail-block"><label class="inline-label">Statut<select data-action="status" data-id="${esc(v.id)}">${STATUSES.map(s=>`<option ${v.status===s?'selected':''}>${s}</option>`).join('')}</select></label></div><div class="button-row"><button class="secondary-btn" data-action="edit" data-id="${esc(v.id)}">Mettre à jour l’ordre</button><button class="primary-btn" data-action="ready" data-id="${esc(v.id)}">Valider et préparer SMS</button></div></div>`;}
function lineList(lines=[]){return lines.length?`<ul>${lines.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="muted">Aucun élément saisi.</p>';}
function renderQuotes(){
 const rows=[]; state.vehicles.forEach(v=>(v.quotes||[]).forEach(q=>rows.push({v,q})));
 app.innerHTML=`<section class="panel"><div class="panel-heading"><h2>Devis complémentaires</h2></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Véhicule / client</th><th>Anomalie et proposition</th><th>Montant</th><th>Décision</th><th>Actions</th></tr></thead><tbody>${rows.map(({v,q})=>`<tr><td><strong>${esc(v.brand)} ${esc(v.model)}</strong><small>${esc(v.clientName)} · ${esc(v.plate)}</small></td><td>${esc(q.description)}</td><td>${money(q.amount)}</td><td><select data-action="quote-decision" data-id="${esc(v.id)}" data-quote-id="${esc(q.id)}">${['En attente','Accepté','Refusé'].map(x=>`<option ${q.decision===x?'selected':''}>${x}</option>`).join('')}</select></td><td><button class="text-btn" data-action="sms-quote" data-id="${esc(v.id)}" data-quote-id="${esc(q.id)}">Préparer SMS</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Aucun devis enregistré. Ajoutez une anomalie depuis un dossier véhicule.</p>'}</section>`;
}
function renderPlanning(){
 const list=[...state.vehicles].sort((a,b)=>(a.plannedDate||'').localeCompare(b.plannedDate||''));
 app.innerHTML=`<section class="panel"><div class="panel-heading"><h2>Planning des entrées</h2><p class="muted">Trié par date prévue</p></div>${list.length?`<div class="planning-list">${list.map(v=>`<article class="planning-item"><div class="planning-date"><strong>${date(v.plannedDate)}</strong></div><div class="planning-info"><strong>${esc(v.brand)} ${esc(v.model)} · ${esc(v.plate)}</strong><span>${esc(v.clientName)} · ${esc(v.workRequested||'Travail à définir')}</span></div><span class="badge ${statusClass(v.status)}">${esc(v.status)}</span><button class="text-btn" data-action="open" data-id="${esc(v.id)}">Ouvrir</button></article>`).join('')}</div>`:'<p class="empty">Aucun rendez-vous planifié.</p>'}</section>`;
}
function openVehicle(id){state.selectedId=id;save();setView('orders');}
function createVehicle(form){const d=new FormData(form);const v={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),clientName:d.get('clientName').trim(),phone:d.get('phone').trim(),brand:d.get('brand').trim(),model:d.get('model').trim(),plate:d.get('plate').trim().toUpperCase(),plannedDate:d.get('plannedDate'),status:'À planifier',workRequested:d.get('workRequested').trim(),workDone:'',tasks:d.get('workRequested').trim()?d.get('workRequested').trim().split(/[,\n]+/).map(x=>x.trim()).filter(Boolean):[],parts:[],quotes:[]};state.vehicles.unshift(v);state.selectedId=v.id;save();vehicleDialog.close();form.reset();setView('orders');}
function editVehicle(id){const v=state.vehicles.find(x=>x.id===id);if(!v)return;const f=document.querySelector('#edit-form');f.elements.vehicleId.value=v.id;f.elements.status.value=v.status;f.elements.workDone.value=v.workDone||'';f.elements.parts.value=(v.parts||[]).join('\n');f.elements.tasks.value=(v.tasks||[]).join('\n');editDialog.showModal();}
function saveEdit(form){const d=new FormData(form);const v=state.vehicles.find(x=>x.id===d.get('vehicleId'));if(!v)return;v.status=d.get('status');v.workDone=d.get('workDone').trim();v.parts=d.get('parts').split('\n').map(x=>x.trim()).filter(Boolean);v.tasks=d.get('tasks').split('\n').map(x=>x.trim()).filter(Boolean);state.selectedId=v.id;save();editDialog.close();render();}
function addQuote(form){const d=new FormData(form);const v=state.vehicles.find(x=>x.id===d.get('vehicleId'));if(!v)return;v.quotes.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),description:d.get('description').trim(),amount:Number(d.get('amount')),decision:d.get('decision'),createdAt:new Date().toISOString()});if(d.get('decision')==='En attente')v.status='En attente client';save();quoteDialog.close();form.reset();render();}
function prepareSms(phone,message){if(!phone){alert('Aucun numéro de téléphone enregistré.');return;}window.location.href=`sms:${encodeURIComponent(phone)}?&body=${encodeURIComponent(message)}`;}
function handleAction(button){const action=button.dataset.action,id=button.dataset.id;
 if(action==='new-vehicle')vehicleDialog.showModal();
 if(action==='close-dialog')button.closest('dialog').close();
 if(action==='open')openVehicle(id);
 if(action==='edit')editVehicle(id);
 if(action==='add-quote'){const f=document.querySelector('#quote-form');f.elements.vehicleId.value=id;quoteDialog.showModal();}
 if(action==='ready'){const v=state.vehicles.find(x=>x.id===id);if(!v)return;if((v.quotes||[]).some(q=>q.decision==='En attente')){if(!confirm('Un devis est encore en attente. Valider quand même la prestation ?'))return;}v.status='Prêt à récupérer';save();const message=`Bonjour ${v.clientName}, votre ${v.brand} ${v.model} (${v.plate}) est prêt à être récupéré. Vous pouvez venir le chercher. Merci.`;if(confirm('Dossier marqué prêt. Ouvrir l’application SMS avec un message prérempli ?'))prepareSms(v.phone,message);render();}
 if(action==='sms-quote'){const v=state.vehicles.find(x=>x.id===id),q=v?.quotes.find(x=>x.id===button.dataset.quoteId);if(v&&q)prepareSms(v.phone,`Bonjour ${v.clientName}, nous avons constaté : ${q.description} Devis complémentaire : ${money(q.amount)}. Répondez à ce message ou contactez l’atelier pour donner votre accord.`);}
}

document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
document.addEventListener('click',e=>{const viewButton=e.target.closest('[data-view-action]');if(viewButton){setView(viewButton.dataset.viewAction);return;}const button=e.target.closest('[data-action]');if(button)handleAction(button);});
document.addEventListener('change',e=>{const el=e.target;if(el.dataset.action==='status'){const v=state.vehicles.find(x=>x.id===el.dataset.id);if(v){v.status=el.value;save();render();}}if(el.dataset.action==='quote-decision'){const v=state.vehicles.find(x=>x.id===el.dataset.id),q=v?.quotes.find(x=>x.id===el.dataset.quoteId);if(q){q.decision=el.value;if(el.value==='Accepté'&&v.status==='En attente client')v.status='En cours';save();render();}}});
document.querySelector('#vehicle-form').addEventListener('submit',e=>{e.preventDefault();createVehicle(e.currentTarget);});
document.querySelector('#edit-form').addEventListener('submit',e=>{e.preventDefault();saveEdit(e.currentTarget);});
document.querySelector('#quote-form').addEventListener('submit',e=>{e.preventDefault();addQuote(e.currentTarget);});
render();
