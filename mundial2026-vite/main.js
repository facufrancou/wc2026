// ─── APIS ────────────────────────────────────────────────────────────────────
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const FIFA_BASE = 'https://api.fifa.com/api/v3';
const FIFA_COMP = 17, FIFA_SEASON = 285023;

// ─── ESTADO GLOBAL ───────────────────────────────────────────────────────────
let allEvents = [], groupStandings = {}, curView = 'res', curPhase = 'hoy';
let autoRef = null, cdInterval = null, statsEid = null;
let fifaMatches = [], fifaMatchMap = {}; // mapa idFifaMatch → datos FIFA

// ─── UTILS ───────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2,'0');
const flag = a => `https://a.espncdn.com/i/teamlogos/countries/500/${(a||'unk').toLowerCase()}.png`;

function nowAR() { return new Date(Date.now() - 3*3600000); }
function dateStrAR(ms) {
  const ar = new Date(ms - 3*3600000);
  return `${ar.getUTCFullYear()}${pad(ar.getUTCMonth()+1)}${pad(ar.getUTCDate())}`;
}
function isTodayEvent(ev) {
  return dateStrAR(new Date(ev.date).getTime()) === dateStrAR(nowAR().getTime());
}
function isNowLive(ev) {
  const state = ev.competitions?.[0]?.status?.type?.state;
  const sid = parseInt(ev.competitions?.[0]?.status?.type?.id||0);
  return state === 'in' || [23,24,43,44].includes(sid);
}
function fmtAR(iso) {
  try { return new Date(iso).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Buenos_Aires'}); }
  catch { return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
}
function fmtDateAR(iso) {
  try { return new Date(iso).toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short',timeZone:'America/Argentina/Buenos_Aires'}); }
  catch { return new Date(iso).toLocaleDateString(); }
}
function fmtDateShort(iso) {
  try { return new Date(iso).toLocaleDateString('es-AR',{day:'numeric',month:'short',timeZone:'America/Argentina/Buenos_Aires'}); }
  catch { return ''; }
}
function statusInfo(comp) {
  const st=comp.status, sid=parseInt(st.type.id), state=st.type.state;
  let cls='s-pre', lbl='';
  if(sid===23)              {cls='s-ht';   lbl='DESCANSO';}
  else if(sid===24||sid===43){cls='s-live';lbl='PRÓRROGA';}
  else if(sid===44)         {cls='s-live'; lbl='PENALES';}
  else if(sid===47)         {cls='s-fin';  lbl='FINAL PEN';}
  else if(sid===45)         {cls='s-fin';  lbl='FINAL ET';}
  else if(state==='in')     {cls='s-live'; lbl=st.displayClock||'EN VIVO';}
  else if(state==='post')   {cls='s-fin';  lbl='FINAL';}
  else                      {lbl=fmtAR(comp.date)+' AR';}
  return {cls,lbl,isLive:state==='in'||[23,24,43,44].includes(sid),isFin:state==='post'||[45,47].includes(sid),isPre:state==='pre'};
}
function setStatus(state,txt) {
  const dot=document.getElementById('updDot'), t=document.getElementById('updTxt');
  dot.className='upd-dot'+(state==='fetching'?' fetching':state==='err'?' err':'');
  if(txt) t.textContent=txt;
}

// ─── FETCH ESPN ──────────────────────────────────────────────────────────────
async function fetchESPN() {
  try {
    const r = await fetch(ESPN_BASE);
    if(!r.ok) throw new Error(r.status);
    return (await r.json()).events||[];
  } catch(e) { console.warn('ESPN fetch failed',e); return []; }
}

// ─── FETCH FIFA (calendario completo + live) ─────────────────────────────────
async function fetchFIFACalendar() {
  try {
    const r = await fetch(`${FIFA_BASE}/calendar/matches?idCompetition=${FIFA_COMP}&idSeason=${FIFA_SEASON}&count=200&language=es`);
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    return d.Results||d.results||[];
  } catch(e) { console.warn('FIFA calendar failed',e); return []; }
}

async function fetchFIFALive(idStage, idMatch) {
  try {
    const r = await fetch(`${FIFA_BASE}/live/football/${FIFA_COMP}/${FIFA_SEASON}/${idStage}/${idMatch}?language=es`);
    if(!r.ok) throw new Error(r.status);
    return await r.json();
  } catch(e) { console.warn('FIFA live failed',e); return null; }
}

async function fetchFIFATopScorers() {
  try {
    const r = await fetch(`${FIFA_BASE}/topseasonplayerstatistics/season/${FIFA_SEASON}/topscorers?language=es&count=10`);
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    return d.Results||d.results||[];
  } catch(e) { console.warn('FIFA topscorers failed',e); return []; }
}

// ─── INIT ────────────────────────────────────────────────────────────────────
async function init() {
  setStatus('fetching','Cargando...');
  // Carga ESPN (datos de hoy rápido)
  const espnEvents = await fetchESPN();
  allEvents = espnEvents;
  buildStandings();
  updateCounters();
  renderView();
  // Carga FIFA en background
  const [fifaCal] = await Promise.all([fetchFIFACalendar()]);
  fifaMatches = fifaCal;
  // Mapear por nombre de equipos para cruzar con ESPN
  fifaMatches.forEach(m => {
    const key = matchKey(m.Home?.IdTeam, m.Away?.IdTeam, m.Date);
    fifaMatchMap[m.IdMatch] = m;
  });
  const now = new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
  setStatus('ok',`${now} · ${espnEvents.length} partidos hoy · ${fifaMatches.length} total FIFA`);
  renderView();
  scheduleRefresh();
}

function matchKey(homeId, awayId, date) {
  return `${homeId}-${awayId}-${date?.substring(0,10)}`;
}

async function loadData() {
  setStatus('fetching','Actualizando...');
  const events = await fetchESPN();
  if(events.length) { allEvents = events; buildStandings(); updateCounters(); }
  const now = new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
  setStatus('ok',`${now} · ${allEvents.length} partidos`);
  renderView();
  scheduleRefresh();
}

function scheduleRefresh() {
  clearInterval(autoRef);
  const liveNow = allEvents.filter(isNowLive).length;
  autoRef = setInterval(loadData, liveNow>0 ? 30000 : 90000);
}

function updateCounters() {
  const today = allEvents.filter(isTodayEvent);
  const live = allEvents.filter(isNowLive);
  document.getElementById('mc').textContent = today.length;
  document.getElementById('lc').textContent = live.length;
  const li = document.getElementById('live-indicator');
  if(li) li.style.display = live.length>0 ? 'inline-flex' : 'none';
}

// ─── STANDINGS ───────────────────────────────────────────────────────────────
function buildStandings() {
  const g = {};
  for(const ev of allEvents) {
    const comp = ev.competitions?.[0]; if(!comp) continue;
    const gm = (comp.altGameNote||'').match(/Group ([A-Z])/); if(!gm) continue;
    const grp = gm[1]; if(!g[grp]) g[grp]={};
    const done = comp.status?.type?.state==='post'||comp.status?.type?.completed;
    for(const ct of comp.competitors) {
      const id = ct.team.id;
      if(!g[grp][id]) g[grp][id]={team:ct.team,pj:0,gg:0,e:0,p:0,gf:0,gc:0,pts:0,wcForm:''};
      const t = g[grp][id];
      if(done) {
        const my=parseInt(ct.score)||0, opp=parseInt(comp.competitors.find(x=>x.homeAway!==ct.homeAway)?.score)||0;
        t.pj++; t.gf+=my; t.gc+=opp;
        if(my>opp){t.gg++;t.pts+=3;t.wcForm+='G';}
        else if(my===opp){t.e++;t.pts+=1;t.wcForm+='E';}
        else{t.p++;t.wcForm+='P';}
      }
    }
  }
  for(const grp of Object.keys(g)) {
    g[grp]=Object.values(g[grp]).sort((a,b)=>{
      if(b.pts!==a.pts) return b.pts-a.pts;
      const gdA=a.gf-a.gc,gdB=b.gf-b.gc;
      return gdB!==gdA ? gdB-gdA : b.gf-a.gf;
    });
  }
  groupStandings=g;
}

function resolvePlaceholder(name) {
  const m=(name||'').match(/3RD ([A-Z/]+)/i); if(!m) return null;
  let best=null;
  for(const g of m[1].split('/')) {
    const third=groupStandings[g]?.[2]; if(!third) continue;
    if(!best||third.pts>best.pts||(third.pts===best.pts&&(third.gf-third.gc)>(best.gf-best.gc))) best=third;
  }
  return best;
}

// ─── MATCH CARD ──────────────────────────────────────────────────────────────
function renderCard(ev, showDate=false) {
  const c=ev.competitions?.[0]; if(!c) return '';
  const h=c.competitors.find(x=>x.homeAway==='home'), a=c.competitors.find(x=>x.homeAway==='away');
  if(!h||!a) return '';
  const {cls,lbl,isLive,isFin}=statusInfo(c);
  const hs=parseInt(h.score)||0, as2=parseInt(a.score)||0;
  const grp=(c.altGameNote||'').match(/Group ([A-Z])/);
  const venue=(c.venue?.fullName||c.venue?.displayName||'').split(',')[0];
  const tv=(c.geoBroadcasts||[]).map(g=>g.media?.shortName).filter(Boolean).slice(0,3);
  const od=c.odds?.[0];
  let oHtml='';
  if(od&&!isLive&&!isFin){
    const hml=od.moneyline?.home?.close?.odds||od.moneyline?.home?.open?.odds||'–';
    const aml=od.moneyline?.away?.close?.odds||od.moneyline?.away?.open?.odds||'–';
    const dr=od.drawOdds?.moneyLine, dl=dr?(dr>0?'+'+dr:String(dr)):'–';
    oHtml=`<div class="orow">
      <div class="och"><div class="olb">${a.team.abbreviation}</div><div class="ov">${aml}</div></div>
      <div class="och"><div class="olb">Empate</div><div class="ov">${dl}</div></div>
      <div class="och"><div class="olb">${h.team.abbreviation}</div><div class="ov">${hml}</div></div>
    </div>`;
  }
  const evs=(c.details||[]).filter(e=>['50','57','93'].includes(e.type?.id)).slice(0,4);
  const evsHtml=(isLive||isFin)&&evs.length?`<div class="mevs">${evs.map(ev2=>{
    const clk=ev2.clock?.displayValue||'', ply=ev2.athletesInvolved?.[0]?.displayName||'';
    const ic=ev2.type?.id==='50'?'⚽':ev2.type?.id==='57'?'🟨':'🟥';
    return`<div class="mev"><span class="mev-min">${clk}'</span>${ic} ${ply}</div>`;
  }).join('')}</div>`:'';
  const dateBadge=showDate?`<span class="ev-date">${fmtDateShort(ev.date)}</span>`:'';

  return`<div class="mc${isLive?' lv':''}" onclick="openStats('${ev.id}')">
    <div class="mhdr">
      <span class="mgrp">${grp?'Grupo '+grp[1]:'Copa Mundial FIFA 2026'} ${dateBadge}</span>
      <span class="sb ${cls}">${isLive?'<span class="ldot"></span>':''}${lbl}</span>
    </div>
    <div class="mbody">
      <div class="mt">
        <div class="tb">
          <img class="tf" src="${flag(a.team.abbreviation)}" onerror="this.style.opacity=.2" alt="${a.team.shortDisplayName}">
          <div style="min-width:0"><div class="tn">${a.team.shortDisplayName}</div></div>
        </div>
        <div class="sc">
          <div class="sn${isLive?' lv':''}">${isFin||isLive?`${as2}<span style="color:var(--mu2);margin:0 2px">·</span>${hs}`:'<span style="font-size:15px;color:var(--mu)">vs</span>'}</div>
          <div class="sk">${isLive?c.status.displayClock:isFin?'Final':fmtAR(c.date)+' AR'}</div>
        </div>
        <div class="tb aw">
          <img class="tf" src="${flag(h.team.abbreviation)}" onerror="this.style.opacity=.2" alt="${h.team.shortDisplayName}">
          <div style="min-width:0"><div class="tn">${h.team.shortDisplayName}</div></div>
        </div>
      </div>${oHtml}
    </div>
    ${evsHtml}
    <div class="mfoot">
      <span class="ven">📍 ${venue||'–'}</span>
      <div class="tvrow">${tv.map(t=>`<span class="tvch">${t}</span>`).join('')}<span class="sarr">ver stats →</span></div>
    </div>
  </div>`;
}

// Tarjeta próximos partidos (FIFA calendar)
function renderNextCard(fifaMatch) {
  const homeTeam = fifaMatch.Home, awayTeam = fifaMatch.Away;
  const homeName = homeTeam?.TeamName?.[0]?.Description || homeTeam?.Abbreviation || '?';
  const awayName = awayTeam?.TeamName?.[0]?.Description || awayTeam?.Abbreviation || '?';
  const homeAbbr = (homeTeam?.Abbreviation||'unk').toLowerCase();
  const awayAbbr = (awayTeam?.Abbreviation||'unk').toLowerCase();
  const date = fifaMatch.Date||fifaMatch.LocalDate;
  const stadium = fifaMatch.Stadium?.Name?.[0]?.Description || '';
  const city = fifaMatch.Stadium?.CityName?.[0]?.Description || '';
  const groupName = fifaMatch.GroupName?.[0]?.Description || '';

  return`<div class="mc next-card" onclick="openFIFAMatch('${fifaMatch.IdMatch}','${fifaMatch.IdStage}')">
    <div class="mhdr">
      <span class="mgrp">${groupName||'Copa Mundial FIFA 2026'}</span>
      <span class="sb s-pre">${fmtDateShort(date)} · ${fmtAR(date)} AR</span>
    </div>
    <div class="mbody">
      <div class="mt">
        <div class="tb">
          <img class="tf" src="${flag(awayAbbr)}" onerror="this.style.opacity=.2" alt="${awayName}">
          <div style="min-width:0"><div class="tn">${awayName}</div></div>
        </div>
        <div class="sc">
          <div class="sn"><span style="font-size:15px;color:var(--mu)">vs</span></div>
          <div class="sk">${fmtAR(date)} AR</div>
        </div>
        <div class="tb aw">
          <img class="tf" src="${flag(homeAbbr)}" onerror="this.style.opacity=.2" alt="${homeName}">
          <div style="min-width:0"><div class="tn">${homeName}</div></div>
        </div>
      </div>
    </div>
    <div class="mfoot">
      <span class="ven">📍 ${stadium}${city?', '+city:''}</span>
      <span class="sarr">ver detalles →</span>
    </div>
  </div>`;
}

// ─── FASES ───────────────────────────────────────────────────────────────────
function setPhase(phase, btn) {
  curPhase = phase;
  document.querySelectorAll('.pchip').forEach(c=>c.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderRes();
}

function getPhaseEvents() {
  const now = new Date();
  if(curPhase==='hoy') return allEvents.filter(isTodayEvent);
  if(curPhase==='todos-espn') return allEvents;
  // Para fases futuras (datos FIFA)
  const phaseSlug = {
    'grupo':'group-stage','r32':'round-of-32','octavos':'round-of-16',
    'cuartos':'quarterfinals','semis':'semifinals','final':'final'
  }[curPhase];
  if(phaseSlug) {
    // Intentar con ESPN primero
    const espnPhase = allEvents.filter(e=>(e.season?.slug||'').includes(phaseSlug));
    if(espnPhase.length) return espnPhase;
    // Si no hay en ESPN, usar FIFA calendar
    return [];
  }
  return allEvents.filter(isTodayEvent);
}

function getFIFAPhaseMatches() {
  const phaseFilter = {
    'grupo':'Group Stage','r32':'Round of 32','octavos':'Round of 16',
    'cuartos':'Quarter-final','semis':'Semi-final','final':'Final'
  }[curPhase];
  if(!phaseFilter || !fifaMatches.length) return [];
  return fifaMatches.filter(m => {
    const sn = m.StageName?.[0]?.Description||'';
    return sn.toLowerCase().includes(phaseFilter.toLowerCase().replace(' stage',''));
  }).sort((a,b) => new Date(a.Date) - new Date(b.Date));
}

// ─── RENDER RESULTADOS ───────────────────────────────────────────────────────
function renderRes() {
  const c = document.getElementById('mc-cont');
  const titleEl = document.getElementById('resSectionTitle');
  const titles = {
    hoy:'Partidos de hoy', 'todos-espn':'Todos los partidos',
    grupo:'Fase de grupos', r32:'Ronda de 32', octavos:'Octavos de final',
    cuartos:'Cuartos de final', semis:'Semifinales', final:'Final'
  };
  if(titleEl) titleEl.textContent = titles[curPhase]||'Partidos';

  const espnEvs = getPhaseEvents();
  const fifaEvs = getFIFAPhaseMatches();

  if(!espnEvs.length && !fifaEvs.length) {
    const msgs = {
      hoy:`Sin partidos hoy · ${fmtDateAR(new Date())}`,
      r32:'Ronda de 32 · 28 jun – 3 jul', octavos:'Octavos · 4 – 7 jul',
      cuartos:'Cuartos · 9 – 11 jul', semis:'Semifinales · 14 – 15 jul', final:'Final · 19 jul'
    };
    c.innerHTML=`<div class="empty"><div class="ei">📅</div><p>${msgs[curPhase]||'Sin partidos en esta fase aún'}</p></div>`;
    return;
  }

  document.getElementById('mc').textContent = espnEvs.length || fifaEvs.length;

  if(espnEvs.length) {
    // Agrupar por fecha si no es hoy
    if(curPhase==='hoy') {
      c.innerHTML = espnEvs.map(e=>renderCard(e,false)).join('');
    } else {
      const byDate={};
      espnEvs.forEach(ev=>{const dk=dateStrAR(new Date(ev.date).getTime());if(!byDate[dk])byDate[dk]=[];byDate[dk].push(ev);});
      let html='';
      Object.keys(byDate).sort().forEach(dk=>{
        html+=`<div class="date-group-hdr">${fmtDateAR(byDate[dk][0].date)}</div>`;
        html+=byDate[dk].map(e=>renderCard(e,false)).join('');
      });
      c.innerHTML=html;
    }
  } else if(fifaEvs.length) {
    // Usar datos FIFA cuando ESPN no tiene aún la fase
    const byDate={};
    fifaEvs.forEach(m=>{const dk=(m.Date||'').substring(0,10);if(!byDate[dk])byDate[dk]=[];byDate[dk].push(m);});
    let html='';
    Object.keys(byDate).sort().forEach(dk=>{
      const sample=byDate[dk][0];
      html+=`<div class="date-group-hdr">${fmtDateAR(sample.Date)}</div>`;
      html+=byDate[dk].map(m=>renderNextCard(m)).join('');
    });
    c.innerHTML=html;
  }
}

// ─── EN VIVO ─────────────────────────────────────────────────────────────────
function renderLive() {
  const c=document.getElementById('lv-cont');
  const live=allEvents.filter(isNowLive);
  document.getElementById('lc').textContent=live.length;
  if(!live.length){
    const now=new Date();
    // Próximo de ESPN
    let nxt=allEvents.filter(e=>new Date(e.date)>now&&e.competitions?.[0]?.status?.type?.state==='pre')
      .sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
    // Si no hay próximo en ESPN, buscar en FIFA
    let nxtFifa=null;
    if(!nxt && fifaMatches.length){
      nxtFifa=fifaMatches.filter(m=>new Date(m.Date)>now&&m.MatchStatus!==0)
        .sort((a,b)=>new Date(a.Date)-new Date(b.Date))[0];
    }
    let nHtml='';
    if(nxt){
      const nc=nxt.competitions[0];
      const nh=nc.competitors.find(x=>x.homeAway==='home'), na=nc.competitors.find(x=>x.homeAway==='away');
      const grp=(nc.altGameNote||'').match(/Group ([A-Z])/);
      nHtml=`<div class="nextcard" onclick="openStats('${nxt.id}')">
        <div class="nextlbl">⏱ Próximo partido</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <img class="tf" src="${flag(na.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${na.team.shortDisplayName} vs ${nh.team.shortDisplayName}</div>
            <div style="font-size:10px;color:var(--mu);margin-top:2px">${grp?'Grupo '+grp[1]+' · ':''} ${(nc.venue?.fullName||'').split(',')[0]}</div>
            <div style="font-size:11px;color:var(--cy);margin-top:2px;font-weight:600">${fmtDateAR(nxt.date)} · ${fmtAR(nxt.date)}</div>
          </div>
          <img class="tf" src="${flag(nh.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
        </div>
        <div class="cdwn" id="cdwn">--:--:--</div>
        <div class="cdlbl">hasta el partido · tocá para ver detalles</div>
      </div>`;
      startCd(nxt.date);
    } else if(nxtFifa){
      const hAbbr=(nxtFifa.Home?.Abbreviation||'unk').toLowerCase();
      const aAbbr=(nxtFifa.Away?.Abbreviation||'unk').toLowerCase();
      const hName=nxtFifa.Home?.TeamName?.[0]?.Description||nxtFifa.Home?.Abbreviation||'?';
      const aName=nxtFifa.Away?.TeamName?.[0]?.Description||nxtFifa.Away?.Abbreviation||'?';
      const grpN=nxtFifa.GroupName?.[0]?.Description||'';
      nHtml=`<div class="nextcard" onclick="openFIFAMatch('${nxtFifa.IdMatch}','${nxtFifa.IdStage}')">
        <div class="nextlbl">⏱ Próximo partido</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <img class="tf" src="${flag(aAbbr)}" onerror="this.style.opacity=.2" alt="">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${aName} vs ${hName}</div>
            <div style="font-size:10px;color:var(--mu);margin-top:2px">${grpN}</div>
            <div style="font-size:11px;color:var(--cy);margin-top:2px;font-weight:600">${fmtDateAR(nxtFifa.Date)} · ${fmtAR(nxtFifa.Date)}</div>
          </div>
          <img class="tf" src="${flag(hAbbr)}" onerror="this.style.opacity=.2" alt="">
        </div>
        <div class="cdwn" id="cdwn">--:--:--</div>
        <div class="cdlbl">hasta el partido · tocá para ver detalles</div>
      </div>`;
      startCd(nxtFifa.Date);
    }
    c.innerHTML=`<div class="empty"><div class="ei">📡</div><p style="margin-bottom:6px">Sin partidos en vivo</p><p style="font-size:11px">Auto-actualización cada 30s</p></div>${nHtml}`;
    return;
  }
  c.innerHTML=live.map(e=>renderCard(e,true)).join('');
}

function startCd(target) {
  clearInterval(cdInterval);
  const tick=()=>{
    const el=document.getElementById('cdwn'); if(!el){clearInterval(cdInterval);return;}
    const d=new Date(target)-new Date();
    if(d<=0){el.textContent='¡Ya comenzó!';return;}
    const h=Math.floor(d/3600000),m=Math.floor((d%3600000)/60000),s=Math.floor((d%60000)/1000);
    el.textContent=`${pad(h)}:${pad(m)}:${pad(s)}`;
  };
  tick(); cdInterval=setInterval(tick,1000);
}

// ─── TABLAS ──────────────────────────────────────────────────────────────────
function renderTbl() {
  const c=document.getElementById('tb-cont');
  const keys=Object.keys(groupStandings).sort();
  if(!keys.length){c.innerHTML=`<div class="empty">Calculando tablas...</div>`;return;}
  let html='';
  keys.forEach(g=>{
    const teams=groupStandings[g];
    html+=`<div class="gb"><div class="gtt">Grupo ${g}</div>
    <table class="stbl"><thead><tr><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th><th>WC</th></tr></thead><tbody>`;
    teams.forEach((t,i)=>{
      const pos=i+1,pc=pos<=2?'p12':pos===3?'p3':'p4',rc=pos<=2?'q2':pos===3?'q3':'';
      const gd=t.gf-t.gc;
      html+=`<tr class="${rc}"><td><div class="ste">
        <span class="sp ${pc}">${pos}</span>
        <img class="sfl" src="${flag(t.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
        <span class="snm">${t.team.abbreviation}</span>
      </div></td>
      <td>${t.pj}</td><td>${t.gg}</td><td>${t.e}</td><td>${t.p}</td>
      <td>${t.gf}</td><td>${t.gc}</td>
      <td class="${gd>0?'gdp':gd<0?'gdn':''}">${gd>=0?'+'+gd:gd}</td>
      <td class="pts">${t.pts}</td>
      <td><div class="fdots">${t.wcForm.split('').map(f=>`<div class="fdot ${f}">${f}</div>`).join('')}</div></td>
      </tr>`;
    });
    html+=`</tbody></table></div>`;
  });
  c.innerHTML=html;
}

// ─── BRACKET ─────────────────────────────────────────────────────────────────
function renderBrk() {
  const c=document.getElementById('bk-cont');
  const ko=allEvents.filter(e=>e.season?.slug&&e.season.slug!=='group-stage');
  function teamRow(ct,showScore,scoreVal,isWinner){
    if(!ct) return`<div class="bt tbd"><div class="btbd-icon">?</div><span class="btn" style="color:var(--mu2)">Por definir</span><span class="bsc">–</span></div>`;
    const dName=ct.team?.shortDisplayName||ct.team?.displayName||'';
    const is3rd=dName.startsWith('3RD')||dName.startsWith('3rd');
    let resolved=null; if(is3rd) resolved=resolvePlaceholder(dName);
    const abbr=resolved?resolved.team.abbreviation:ct.team?.abbreviation||'';
    const name=resolved?resolved.team.shortDisplayName:dName;
    const tent=is3rd&&resolved;
    return`<div class="bt${isWinner?' win':''}${tent?' tent':''}">
      <img class="bfl" src="${flag(abbr)}" onerror="this.style.opacity=.2" alt="">
      <div style="flex:1;min-width:0"><div class="btn">${name}${tent?'<span class="tent-badge">tentativo</span>':''}</div>
      ${is3rd&&!resolved?`<div style="font-size:9px;color:var(--mu2)">${dName}</div>`:''}</div>
      <span class="bsc">${showScore?scoreVal:'–'}</span></div>`;
  }
  const phases=[
    {lbl:'Ronda de 32',det:'28 jun–3 jul',slugs:['round-of-32']},
    {lbl:'Octavos de final',det:'4–7 jul',slugs:['round-of-16','rd-of-16']},
    {lbl:'Cuartos de final',det:'9–11 jul',slugs:['quarterfinals','quarter']},
    {lbl:'Semifinales',det:'14–15 jul',slugs:['semifinals','semi']},
    {lbl:'Tercer lugar',det:'18 jul',slugs:['3rd-place','3rd place']},
    {lbl:'🏆 Final',det:'19 jul',slugs:['final']},
  ];
  let html='';
  if(!ko.length){
    html=`<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="color:var(--cy);font-size:13px;font-weight:700;margin-bottom:6px">⏳ Fase de grupos en curso</div>
      <div style="font-size:11px;color:var(--mu);line-height:1.7">La llave se completará con los clasificados.<br><b style="color:var(--tx)">Clasifican:</b> 1° y 2° de cada grupo + 8 mejores terceros → 32 equipos.</div>
    </div>`;
  }
  phases.forEach(ph=>{
    const pevs=ko.filter(ev=>ph.slugs.some(s=>(ev.season?.slug||'').includes(s))).sort((a,b)=>new Date(a.date)-new Date(b.date));
    html+=`<div class="bph"><div class="bptitle"><span class="bpdot"></span>${ph.lbl}<span style="color:var(--mu2);font-weight:400;margin-left:4px">· ${ph.det}</span></div>`;
    if(!pevs.length){
      html+=`<div class="bm"><div class="bt tbd"><div class="btbd-icon">?</div><span class="btn" style="color:var(--mu2)">Por definir</span><span class="bsc">–</span></div>
        <div class="bt tbd"><div class="btbd-icon">?</div><span class="btn" style="color:var(--mu2)">Por definir</span><span class="bsc">–</span></div></div>`;
    } else {
      pevs.forEach(ev=>{
        const c2=ev.competitions?.[0]; if(!c2) return;
        const hh=c2.competitors?.find(x=>x.homeAway==='home'), aa=c2.competitors?.find(x=>x.homeAway==='away');
        const{isLive,isFin,cls,lbl}=statusInfo(c2);
        const show=isFin||isLive;
        html+=`<div class="bm" onclick="openStats('${ev.id}')">
          ${teamRow(aa,show,aa?.score,aa?.winner)}
          ${teamRow(hh,show,hh?.score,hh?.winner)}
          <div class="bdt"><span class="sb ${cls}" style="font-size:9px;padding:1px 6px;margin-right:5px">${isLive?'<span class="ldot"></span>':''}${lbl}</span>${fmtDateShort(ev.date)} · ${(c2.venue?.fullName||'').split(',')[0]}</div>
        </div>`;
      });
    }
    html+=`</div>`;
  });
  c.innerHTML=html;
}

// ─── CANCHA SVG ──────────────────────────────────────────────────────────────
function renderPitch(homeTeam, awayTeam, homeFormation, awayFormation, homePlayers, awayPlayers) {
  const W=300, H=420;
  // Dibuja el campo
  let svg=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:320px;display:block;margin:0 auto">
    <defs>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a5c2a"/>
        <stop offset="50%" stop-color="#1e6b30"/>
        <stop offset="100%" stop-color="#1a5c2a"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#grass)" rx="6"/>
    <!-- Rayas de césped -->
    ${Array.from({length:7},(_,i)=>`<rect x="0" y="${i*60}" width="${W}" height="30" fill="rgba(255,255,255,0.03)"/>`).join('')}
    <!-- Borde campo -->
    <rect x="12" y="12" width="${W-24}" height="${H-24}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
    <!-- Línea media -->
    <line x1="12" y1="${H/2}" x2="${W-12}" y2="${H/2}" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
    <!-- Círculo central -->
    <circle cx="${W/2}" cy="${H/2}" r="40" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
    <circle cx="${W/2}" cy="${H/2}" r="2.5" fill="rgba(255,255,255,0.7)"/>
    <!-- Área grande home (abajo) -->
    <rect x="${W/2-70}" y="${H-62}" width="140" height="50" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
    <!-- Área chica home -->
    <rect x="${W/2-36}" y="${H-38}" width="72" height="26" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
    <!-- Punto penal home -->
    <circle cx="${W/2}" cy="${H-24}" r="2" fill="rgba(255,255,255,0.6)"/>
    <!-- Área grande away (arriba) -->
    <rect x="${W/2-70}" y="12" width="140" height="50" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
    <!-- Área chica away -->
    <rect x="${W/2-36}" y="12" width="72" height="26" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
    <!-- Punto penal away -->
    <circle cx="${W/2}" cy="24" r="2" fill="rgba(255,255,255,0.6)"/>
    <!-- Porterías -->
    <rect x="${W/2-22}" y="${H-12}" width="44" height="8" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
    <rect x="${W/2-22}" y="4" width="44" height="8" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>`;

  // Renderizar jugadores
  function renderPlayer(x, y, name, number, color, isHome) {
    const shortName = name.split(' ').pop().substring(0,8);
    return `<g>
      <circle cx="${x}" cy="${y}" r="11" fill="${color}" stroke="rgba(255,255,255,0.8)" stroke-width="1.5"/>
      <text x="${x}" y="${y+4}" text-anchor="middle" font-size="9" font-weight="700" fill="white" font-family="Inter,sans-serif">${number||''}</text>
      <rect x="${x-18}" y="${y+13}" width="36" height="11" rx="3" fill="rgba(0,0,0,0.55)"/>
      <text x="${x}" y="${y+21}" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,0.9)" font-family="Inter,sans-serif">${shortName}</text>
    </g>`;
  }

  // Posicionar jugadores según formación
  function positionPlayers(players, formation, isHome) {
    const lines = (formation||'4-4-2').split('-').map(Number);
    const color = isHome ? '#0066cc' : '#cc0000';
    const yStart = isHome ? H-40 : 40;
    const yDir = isHome ? -1 : 1;
    let svgPlayers = '';
    let playerIdx = 0;

    // Portero
    if(players[0]) {
      const p = players[0];
      svgPlayers += renderPlayer(W/2, yStart, p.ShortName||p.Name||'POR', p.ShirtNumber||'1', color, isHome);
      playerIdx = 1;
    }

    // Líneas
    lines.forEach((count, lineIdx) => {
      const y = yStart + yDir * (lineIdx+1) * (H*0.38/(lines.length));
      const xStep = (W-40) / (count+1);
      for(let i=0; i<count; i++) {
        const p = players[playerIdx];
        if(!p) break;
        const x = 20 + xStep*(i+1);
        svgPlayers += renderPlayer(x, y, p.ShortName||p.Name||'–', p.ShirtNumber||playerIdx, color, isHome);
        playerIdx++;
      }
    });
    return svgPlayers;
  }

  // Si tenemos datos reales de jugadores
  if(homePlayers?.length) svg += positionPlayers(homePlayers.filter(p=>p.Status===1||p.Status===0), homeFormation, true);
  if(awayPlayers?.length) svg += positionPlayers(awayPlayers.filter(p=>p.Status===1||p.Status===0), awayFormation, false);

  // Si no hay datos, mostrar formación estimada con posiciones genéricas
  if(!homePlayers?.length && homeFormation) {
    const lines = homeFormation.split('-').map(Number);
    const genericPlayers = [{ShirtNumber:1,Name:'POR'},...lines.flatMap((n,i)=>Array.from({length:n},(_,j)=>({ShirtNumber:i*10+j+2,Name:['DEF','MED','DEL'][i>0?Math.min(i-1,2):0]})))];
    svg += positionPlayers(genericPlayers, homeFormation, true);
  }
  if(!awayPlayers?.length && awayFormation) {
    const lines = awayFormation.split('-').map(Number);
    const genericPlayers = [{ShirtNumber:1,Name:'POR'},...lines.flatMap((n,i)=>Array.from({length:n},(_,j)=>({ShirtNumber:i*10+j+2,Name:['DEF','MED','DEL'][i>0?Math.min(i-1,2):0]})))];
    svg += positionPlayers(genericPlayers, awayFormation, false);
  }

  svg += '</svg>';
  return svg;
}

// ─── ESTADÍSTICAS (ESPN) ─────────────────────────────────────────────────────
function openStats(eid) {
  statsEid = eid;
  renderStats(eid);
  document.getElementById('app').classList.add('hidden');
  const sv = document.getElementById('statsv');
  sv.classList.add('on');
  sv.querySelector('.statsscroll').scrollTop = 0;
}

async function openFIFAMatch(idMatch, idStage) {
  document.getElementById('app').classList.add('hidden');
  const sv = document.getElementById('statsv');
  sv.classList.add('on');
  sv.querySelector('.statsscroll').scrollTop = 0;
  document.getElementById('st-title').textContent = 'Cargando...';
  document.getElementById('st-cont').innerHTML = `<div class="empty"><div class="ei" style="font-size:24px">⏳</div><p>Cargando datos del partido...</p></div>`;
  const data = await fetchFIFALive(idStage, idMatch);
  if(!data) {
    document.getElementById('st-cont').innerHTML = `<div class="empty"><div class="ei">❌</div><p>No hay datos disponibles aún para este partido.</p></div>`;
    return;
  }
  renderFIFAStats(data);
}

function closeStats() {
  statsEid = null;
  document.getElementById('statsv').classList.remove('on');
  document.getElementById('app').classList.remove('hidden');
}

function renderStats(eid) {
  const ev = allEvents.find(e=>e.id===eid); if(!ev) return;
  const comp = ev.competitions?.[0]; if(!comp) return;
  const h = comp.competitors.find(x=>x.homeAway==='home');
  const a = comp.competitors.find(x=>x.homeAway==='away');
  const {lbl,isLive,isFin} = statusInfo(comp);
  const hs=parseInt(h.score)||0, as2=parseInt(a.score)||0;
  const hasD=isLive||isFin;
  document.getElementById('st-title').textContent=`${a.team.abbreviation} vs ${h.team.abbreviation}`;

  // Intentar cargar datos FIFA para formaciones
  loadFIFAForESPNMatch(ev, h, a, lbl, isLive, isFin, hs, as2, hasD, comp);
}

async function loadFIFAForESPNMatch(ev, h, a, lbl, isLive, isFin, hs, as2, hasD, comp) {
  // Mostrar stats básicas primero
  renderESPNStats(ev, h, a, lbl, isLive, isFin, hs, as2, hasD, comp, null);

  // Buscar partido en FIFA por fecha y equipos
  const evDate = ev.date?.substring(0,10);
  const fifaMatch = fifaMatches.find(m => {
    const mDate = (m.Date||'').substring(0,10);
    if(mDate !== evDate) return false;
    const hAbbr = h.team.abbreviation.toLowerCase();
    const aAbbr = a.team.abbreviation.toLowerCase();
    const mHome = (m.Home?.Abbreviation||'').toLowerCase();
    const mAway = (m.Away?.Abbreviation||'').toLowerCase();
    return (mHome===hAbbr&&mAway===aAbbr)||(mHome===aAbbr&&mAway===hAbbr);
  });

  if(fifaMatch && hasD) {
    const fifaLive = await fetchFIFALive(fifaMatch.IdStage, fifaMatch.IdMatch);
    if(fifaLive) renderESPNStats(ev, h, a, lbl, isLive, isFin, hs, as2, hasD, comp, fifaLive);
  }
}

function renderESPNStats(ev, h, a, lbl, isLive, isFin, hs, as2, hasD, comp, fifaData) {
  const hSt=h.statistics||[], aSt=a.statistics||[];
  const getSt=(arr,n)=>parseFloat(arr.find(x=>x.name===n||x.abbreviation===n)?.value||0);
  const rng=(b,v)=>Math.max(0,Math.round(b+(Math.random()*v-v/2)));

  let stats=[], fromAPI=false;
  if(hasD&&hSt.length>0&&getSt(hSt,'possessionPct')>0){
    fromAPI=true;
    stats=[
      {l:'Posesión',hn:getSt(hSt,'possessionPct'),an:getSt(aSt,'possessionPct'),pct:true},
      {l:'Tiros totales',hn:getSt(hSt,'totalShots'),an:getSt(aSt,'totalShots')},
      {l:'Al arco',hn:getSt(hSt,'shotsOnTarget'),an:getSt(aSt,'shotsOnTarget')},
      {l:'Córners',hn:getSt(hSt,'cornerKicks'),an:getSt(aSt,'cornerKicks')},
      {l:'Faltas',hn:getSt(hSt,'foulsCommitted'),an:getSt(aSt,'foulsCommitted')},
      {l:'Amarillas',hn:getSt(hSt,'yellowCards'),an:getSt(aSt,'yellowCards')},
      {l:'Rojas',hn:getSt(hSt,'redCards'),an:getSt(aSt,'redCards')},
      {l:'Fuera de juego',hn:getSt(hSt,'offsides'),an:getSt(aSt,'offsides')},
      {l:'Pases %',hn:getSt(hSt,'passingAccuracy'),an:getSt(aSt,'passingAccuracy'),pct:true},
      {l:'Atajadas',hn:getSt(hSt,'saves'),an:getSt(aSt,'saves')},
    ];
  } else if(hasD){
    stats=[
      {l:'Posesión',hn:rng(52,22),isPoss:true},
      {l:'Tiros totales',hn:rng(12,8),an:rng(8,6)},
      {l:'Al arco',hn:rng(5,4),an:rng(3,3)},
      {l:'Córners',hn:rng(5,4),an:rng(4,3)},
      {l:'Faltas',hn:rng(11,6),an:rng(9,6)},
      {l:'Amarillas',hn:rng(1,2),an:rng(1,2)},
      {l:'Fuera de juego',hn:rng(2,3),an:rng(2,3)},
      {l:'Pases %',hn:rng(82,12),an:rng(76,14),pct:true},
      {l:'Atajadas',hn:rng(4,3),an:rng(5,4)},
    ];
  }
  stats.forEach(s=>{
    if(s.isPoss) s.an=100-s.hn;
    s.hv=(s.pct||s.isPoss)?s.hn+'%':s.hn;
    s.av=(s.pct||s.isPoss)?s.an+'%':s.an;
  });
  const stHtml=stats.map(s=>{
    const tot=(s.isPoss||s.pct)?100:((s.hn||0)+(s.an||0))||1;
    const hp=Math.round((s.hn||0)/tot*100),ap=Math.round((s.an||0)/tot*100);
    return`<div class="strow"><div class="svv aw">${s.av}</div>
      <div class="sbar aw"><div class="sba" style="width:${ap}%"></div></div>
      <div class="slbl">${s.l}</div>
      <div class="sbar"><div class="sbh" style="width:${hp}%"></div></div>
      <div class="svv">${s.hv}</div></div>`;
  }).join('');

  // Formaciones desde FIFA
  let pitchHtml='';
  if(fifaData) {
    const hTeamData = fifaData.HomeTeam||fifaData.LocalTeam;
    const aTeamData = fifaData.AwayTeam||fifaData.VisitorTeam;
    const hForm = hTeamData?.Formation||'';
    const aForm = aTeamData?.Formation||'';
    const hPlayers = hTeamData?.Players||hTeamData?.Lineup||[];
    const aPlayers = aTeamData?.Players||aTeamData?.Lineup||[];

    if(hForm||aForm||hPlayers.length) {
      pitchHtml=`
        <div class="stlbl">Formaciones</div>
        <div class="pitch-legend">
          <div class="pl-item"><span class="pl-dot" style="background:#0066cc"></span>${a.team.shortDisplayName} ${aForm?'('+aForm+')':''}</div>
          <div class="pl-item"><span class="pl-dot" style="background:#cc0000"></span>${h.team.shortDisplayName} ${hForm?'('+hForm+')':''}</div>
        </div>
        ${renderPitch(h.team, a.team, hForm, aForm, hPlayers, aPlayers)}
        <div style="font-size:9px;color:var(--mu2);text-align:center;margin-top:6px">Local arriba · Visitante abajo</div>`;
    }
  } else if(hasD) {
    pitchHtml=`<div class="stlbl">Formaciones</div>
      <div style="text-align:center;padding:12px;color:var(--mu);font-size:11px">Cargando formaciones de FIFA...</div>`;
  } else {
    pitchHtml=`<div class="stlbl">Formaciones</div>
      <div style="text-align:center;padding:12px;color:var(--mu);font-size:11px">Disponibles al inicio del partido</div>`;
  }

  // Incidencias
  const evs=comp.details||[];
  const tlHtml=evs.length?`<div class="stlbl">Incidencias</div><div class="tl">${evs.map(ev2=>{
    const clk=ev2.clock?.displayValue||'', ply=ev2.athletesInvolved?.[0]?.displayName||'';
    const id=ev2.type?.id, tp=(ev2.type?.text||'').toLowerCase();
    const isG=id==='50'||tp.includes('goal'), isY=id==='57'||tp.includes('yellow'), isR=id==='93'||tp.includes('red');
    const ic=isG?'⚽':isY?'🟨':isR?'🟥':'↔';
    const side=ev2.team?.id===h.team.id?'(Local)':'(Visit.)';
    return`<div class="ti"><div class="tdot ${isG?'g':isY?'y':isR?'r':''}"></div>
      <div class="tcon"><div class="tmin">${clk}'</div>
      <div class="tdesc">${ic} ${ply} <span style="color:var(--mu);font-weight:400">${side}</span></div></div></div>`;
  }).join('')}</div>`:'';

  // Cuotas
  const od=comp.odds?.[0];
  let odHtml='';
  if(od){
    const hml=od.moneyline?.home?.close?.odds||od.moneyline?.home?.open?.odds||'–';
    const aml=od.moneyline?.away?.close?.odds||od.moneyline?.away?.open?.odds||'–';
    const dr=od.drawOdds?.moneyLine, dl=dr?(dr>0?'+'+dr:String(dr)):'–';
    const ou=od.overUnder||'–', ov=od.total?.over?.close?.odds||'–', un2=od.total?.under?.close?.odds||'–';
    odHtml=`<div class="stlbl">Cuotas (DraftKings)</div>
    <div class="orow">
      <div class="och"><div class="olb">${a.team.abbreviation}</div><div class="ov">${aml}</div></div>
      <div class="och"><div class="olb">Empate</div><div class="ov">${dl}</div></div>
      <div class="och"><div class="olb">${h.team.abbreviation}</div><div class="ov">${hml}</div></div>
    </div>
    <div class="orow">
      <div class="och"><div class="olb">Over ${ou}</div><div class="ov">${ov}</div></div>
      <div class="och"><div class="olb">Under ${ou}</div><div class="ov">${un2}</div></div>
    </div>`;
  }

  document.getElementById('st-cont').innerHTML=`
    <div class="sboard">
      <div class="ste2">
        <div class="stt"><img class="sfl2" src="${flag(a.team.abbreviation)}" onerror="this.style.opacity=.2" alt=""><div class="stname">${a.team.shortDisplayName}</div></div>
        <div style="text-align:center">
          <div class="bscore">${hasD?`${as2} · ${hs}`:'–'}</div>
          <div class="stime">${lbl}</div>
          <div style="font-size:9px;color:var(--mu2);margin-top:3px">${fmtDateAR(ev.date)}</div>
          ${comp.venue?.fullName?`<div style="font-size:9px;color:var(--mu2)">📍 ${comp.venue.fullName.split(',')[0]}</div>`:''}
        </div>
        <div class="stt"><img class="sfl2" src="${flag(h.team.abbreviation)}" onerror="this.style.opacity=.2" alt=""><div class="stname">${h.team.shortDisplayName}</div></div>
      </div>
    </div>
    ${pitchHtml}
    ${stats.length?`<div class="stlbl">Estadísticas${!fromAPI&&hasD?' <span style="font-size:9px;color:var(--mu2)">(estimadas)</span>':''}</div>${stHtml}`:`<div class="empty" style="padding:14px"><p style="font-size:11px">Estadísticas disponibles durante el partido</p></div>`}
    ${odHtml}${tlHtml}
    <div style="height:24px"></div>`;
}

function renderFIFAStats(data) {
  const hTeam = data.HomeTeam||data.LocalTeam||{};
  const aTeam = data.AwayTeam||data.VisitorTeam||{};
  const hName = hTeam.TeamName?.[0]?.Description||hTeam.Abbreviation||'Local';
  const aName = aTeam.TeamName?.[0]?.Description||aTeam.Abbreviation||'Visita';
  const hAbbr = (hTeam.Abbreviation||'unk').toLowerCase();
  const aAbbr = (aTeam.Abbreviation||'unk').toLowerCase();
  const hForm = hTeam.Formation||'', aForm = aTeam.Formation||'';
  const hPlayers = hTeam.Players||hTeam.Lineup||[];
  const aPlayers = aTeam.Players||aTeam.Lineup||[];
  const hScore = data.HomeGoals??data.LocalGoals??'–';
  const aScore = data.AwayGoals??data.VisitorGoals??'–';

  document.getElementById('st-title').textContent = `${aAbbr.toUpperCase()} vs ${hAbbr.toUpperCase()}`;

  const pitchHtml = (hForm||aForm||hPlayers.length) ? `
    <div class="stlbl">Formaciones</div>
    <div class="pitch-legend">
      <div class="pl-item"><span class="pl-dot" style="background:#0066cc"></span>${aName} ${aForm?'('+aForm+')':''}</div>
      <div class="pl-item"><span class="pl-dot" style="background:#cc0000"></span>${hName} ${hForm?'('+hForm+')':''}</div>
    </div>
    ${renderPitch(hTeam, aTeam, hForm, aForm, hPlayers, aPlayers)}
    <div style="font-size:9px;color:var(--mu2);text-align:center;margin-top:6px">Arriba: ${aName} · Abajo: ${hName}</div>` : '';

  document.getElementById('st-cont').innerHTML=`
    <div class="sboard">
      <div class="ste2">
        <div class="stt"><img class="sfl2" src="${flag(aAbbr)}" onerror="this.style.opacity=.2" alt=""><div class="stname">${aName}</div></div>
        <div style="text-align:center">
          <div class="bscore">${aScore} · ${hScore}</div>
          <div class="stime">Datos FIFA</div>
        </div>
        <div class="stt"><img class="sfl2" src="${flag(hAbbr)}" onerror="this.style.opacity=.2" alt=""><div class="stname">${hName}</div></div>
      </div>
    </div>
    ${pitchHtml}
    <div style="height:24px"></div>`;
}

// ─── GOLEADORES (FIFA) ────────────────────────────────────────────────────────
async function renderGoleadores() {
  const c = document.getElementById('goal-cont');
  if(!c) return;
  c.innerHTML = `<div class="empty"><div class="ei" style="font-size:20px">⏳</div><p style="font-size:11px">Cargando goleadores...</p></div>`;
  const scorers = await fetchFIFATopScorers();
  if(!scorers.length) {
    c.innerHTML = `<div class="empty"><div class="ei">⚽</div><p>Goleadores disponibles cuando comience el torneo</p></div>`;
    return;
  }
  let html = '';
  scorers.slice(0,10).forEach((s,i) => {
    const name = s.Player?.ShortName||s.Player?.Name||s.PlayerName||'–';
    const team = s.Team?.Name||s.TeamName||'';
    const goals = s.Goals||s.GoalCount||0;
    const photo = s.Player?.PictureUrl||'';
    const teamAbbr = (s.Team?.Abbreviation||'unk').toLowerCase();
    html+=`<div class="scorer-row">
      <span class="scorer-pos">${i+1}</span>
      ${photo?`<img class="scorer-photo" src="${photo}" onerror="this.style.display='none'" alt="">`:`<img class="scorer-photo" src="${flag(teamAbbr)}" onerror="this.style.opacity=.3" alt="">`}
      <div style="flex:1;min-width:0">
        <div class="scorer-name">${name}</div>
        <div class="scorer-team">${team}</div>
      </div>
      <div class="scorer-goals">${goals} <span style="font-size:10px">⚽</span></div>
    </div>`;
  });
  c.innerHTML = html;
}

// ─── NAV ──────────────────────────────────────────────────────────────────────
function nav(id, btn) {
  curView=id;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  document.getElementById('v-'+id).classList.add('on');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  else document.querySelectorAll('.nav button')[['res','live','tbl','brk','gol'].indexOf(id)]?.classList.add('on');
  document.getElementById('mainScroll').scrollTop=0;
  renderView();
}
function renderView() {
  if(curView==='res')       renderRes();
  else if(curView==='live') renderLive();
  else if(curView==='tbl')  renderTbl();
  else if(curView==='brk')  renderBrk();
  else if(curView==='gol')  renderGoleadores();
}
window.nav=nav; window.openStats=openStats; window.closeStats=closeStats;
window.setPhase=setPhase; window.openFIFAMatch=openFIFAMatch;

init();
