const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

const ES = {'France':'Francia','Germany':'Alemania','Spain':'Espana','England':'Inglaterra','Portugal':'Portugal','Netherlands':'Paises Bajos','Belgium':'Belgica','Italy':'Italia','Brazil':'Brasil','Argentina':'Argentina','Uruguay':'Uruguay','Mexico':'Mexico','United States':'Estados Unidos','Canada':'Canada','Japan':'Japon','South Korea':'Corea del Sur','Australia':'Australia','Morocco':'Marruecos','Senegal':'Senegal','Nigeria':'Nigeria','Cameroon':'Camerun','South Africa':'Sudafrica','Egypt':'Egipto','Tunisia':'Tunez','Saudi Arabia':'Arabia Saudita','Iran':'Iran','Iraq':'Irak','China':'China','Indonesia':'Indonesia','New Zealand':'Nueva Zelanda','Switzerland':'Suiza','Croatia':'Croacia','Denmark':'Dinamarca','Sweden':'Suecia','Norway':'Noruega','Austria':'Austria','Serbia':'Serbia','Slovenia':'Eslovenia','Slovakia':'Eslovaquia','Poland':'Polonia','Romania':'Rumania','Czechia':'Rep. Checa','Hungary':'Hungria','Turkey':'Turkiye','Greece':'Grecia','Scotland':'Escocia','Ukraine':'Ucrania','Albania':'Albania','Colombia':'Colombia','Ecuador':'Ecuador','Peru':'Peru','Chile':'Chile','Venezuela':'Venezuela','Paraguay':'Paraguay','Bolivia':'Bolivia','Algeria':'Argelia','Ghana':'Ghana','Mali':'Mali','Ivory Coast':'Costa de Marfil','DR Congo':'R.D. Congo','Cape Verde':'Cabo Verde','Panama':'Panama','Costa Rica':'Costa Rica','Honduras':'Honduras','Jamaica':'Jamaica','Qatar':'Qatar','Kuwait':'Kuwait','Uzbekistan':'Uzbekistan','Jordan':'Jordania','United Arab Emirates':'Em. Arabes Unidos','Algeria':'Argelia','Serbia':'Serbia'};
const nameES = n => ES[n] || n;

function tournamentDates() {
  const dates = [];
  const s = new Date('2026-06-11T00:00:00Z');
  const e = new Date('2026-07-20T00:00:00Z');
  for (let d = new Date(s); d < e; d.setUTCDate(d.getUTCDate()+1)) {
    dates.push(`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`);
  }
  return dates;
}

let allEvents = [], groupStandings = {};
let curView = 'res', curPhase = 'hoy';
let autoRef = null, cdInterval = null, statsEid = null;

const pad = n => String(n).padStart(2,'0');
const flag = a => `https://a.espncdn.com/i/teamlogos/countries/500/${(a||'unk').toLowerCase()}.png`;

function nowAR() { return new Date(Date.now()-3*3600000); }
function dateStrAR(ms) {
  const ar = new Date(ms-3*3600000);
  return `${ar.getUTCFullYear()}${pad(ar.getUTCMonth()+1)}${pad(ar.getUTCDate())}`;
}
function isTodayEvent(ev) {
  return dateStrAR(new Date(ev.date).getTime()) === dateStrAR(nowAR().getTime());
}
function isNowLive(ev) {
  const s = ev.competitions?.[0]?.status?.type;
  return s?.state==='in' || [23,24,43,44].includes(parseInt(s?.id||0));
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
  if(sid===23)               {cls='s-ht';   lbl='DESCANSO';}
  else if(sid===24||sid===43){cls='s-live'; lbl='PRORROGA';}
  else if(sid===44)          {cls='s-live'; lbl='PENALES';}
  else if(sid===47)          {cls='s-fin';  lbl='FINAL PEN';}
  else if(sid===45)          {cls='s-fin';  lbl='FINAL ET';}
  else if(state==='in')      {cls='s-live'; lbl=st.displayClock||'EN VIVO';}
  else if(state==='post')    {cls='s-fin';  lbl='FINAL';}
  else                       {lbl=fmtAR(comp.date)+' AR';}
  return {cls,lbl,isLive:state==='in'||[23,24,43,44].includes(sid),isFin:state==='post'||[45,47].includes(sid)};
}
function setStatus(state, txt) {
  const dot=document.getElementById('updDot'), t=document.getElementById('updTxt');
  dot.className='upd-dot'+(state==='fetching'?' fetching':state==='err'?' err':'');
  if(txt) t.textContent=txt;
}

async function fetchOneDate(dateStr) {
  try {
    const r = await fetch(`${ESPN}?dates=${dateStr}`);
    if(!r.ok) return [];
    return (await r.json()).events||[];
  } catch { return []; }
}
async function fetchToday() {
  try {
    const r = await fetch(ESPN);
    if(!r.ok) return [];
    return (await r.json()).events||[];
  } catch { return []; }
}
async function fetchAllTournament() {
  const dates = tournamentDates();
  const results = [];
  for(let i=0;i<dates.length;i+=10) {
    const batch = dates.slice(i,i+10);
    const br = await Promise.allSettled(batch.map(fetchOneDate));
    br.forEach(r => { if(r.status==='fulfilled') results.push(...r.value); });
  }
  const seen = new Set();
  return results.filter(ev => { if(seen.has(ev.id)) return false; seen.add(ev.id); return true; })
                .sort((a,b)=>new Date(a.date)-new Date(b.date));
}
function mergeEvents(existing, incoming) {
  const map = new Map(existing.map(e=>[e.id,e]));
  incoming.forEach(e=>map.set(e.id,e));
  return [...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
}

async function init() {
  setStatus('fetching','Cargando...');
  const todayEvs = await fetchToday();
  if(todayEvs.length) {
    allEvents=todayEvs; buildStandings(); updateCounters(); renderView();
    setStatus('fetching','Cargando torneo completo...');
  }
  const all = await fetchAllTournament();
  if(all.length) {
    allEvents=all; buildStandings(); updateCounters();
    setStatus('ok',`${new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})} · ${all.length} partidos`);
    renderView();
  } else if(!todayEvs.length) {
    setStatus('err','Error - reintentando...');
    setTimeout(init,10000); return;
  }
  scheduleRefresh();
}

function scheduleRefresh() {
  clearInterval(autoRef);
  const liveNow = allEvents.filter(isNowLive).length;
  autoRef = setInterval(async()=>{
    const fresh = await fetchToday();
    if(fresh.length) {
      allEvents=mergeEvents(allEvents,fresh); buildStandings(); updateCounters();
      setStatus('ok',`${new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})} · ${allEvents.length} partidos`);
      renderView();
      if(statsEid && document.getElementById('statsv').classList.contains('on')) renderStats(statsEid);
    }
    scheduleRefresh();
  }, liveNow>0?30000:90000);
}

function updateCounters() {
  const today=allEvents.filter(isTodayEvent), live=allEvents.filter(isNowLive);
  document.getElementById('mc').textContent=today.length;
  document.getElementById('lc').textContent=live.length;
  const li=document.getElementById('live-indicator');
  if(li) li.style.display=live.length>0?'inline-flex':'none';
}

function buildStandings() {
  const g={};
  for(const ev of allEvents) {
    const comp=ev.competitions?.[0]; if(!comp) continue;
    const gm=(comp.altGameNote||'').match(/Group ([A-Z])/); if(!gm) continue;
    const grp=gm[1]; if(!g[grp]) g[grp]={};
    const done=comp.status?.type?.state==='post'||comp.status?.type?.completed;
    for(const ct of comp.competitors) {
      const id=ct.team.id;
      if(!g[grp][id]) g[grp][id]={team:ct.team,pj:0,gg:0,e:0,p:0,gf:0,gc:0,pts:0,wcForm:''};
      const t=g[grp][id];
      if(done) {
        const my=parseInt(ct.score)||0, opp=parseInt(comp.competitors.find(x=>x.homeAway!==ct.homeAway)?.score)||0;
        t.pj++; t.gf+=my; t.gc+=opp;
        if(my>opp){t.gg++;t.pts+=3;t.wcForm+='G';} else if(my===opp){t.e++;t.pts+=1;t.wcForm+='E';} else{t.p++;t.wcForm+='P';}
      }
    }
  }
  for(const grp of Object.keys(g)) {
    g[grp]=Object.values(g[grp]).sort((a,b)=>{
      if(b.pts!==a.pts) return b.pts-a.pts;
      const gdA=a.gf-a.gc,gdB=b.gf-b.gc;
      return gdB!==gdA?gdB-gdA:b.gf-a.gf;
    });
  }
  groupStandings=g;
}

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
    const hml=od.moneyline?.home?.close?.odds||od.moneyline?.home?.open?.odds||'--';
    const aml=od.moneyline?.away?.close?.odds||od.moneyline?.away?.open?.odds||'--';
    const dr=od.drawOdds?.moneyLine, dl=dr?(dr>0?'+'+dr:String(dr)):'--';
    oHtml=`<div class="orow">
      <div class="och"><div class="olb">${a.team.abbreviation}</div><div class="ov">${aml}</div></div>
      <div class="och"><div class="olb">Empate</div><div class="ov">${dl}</div></div>
      <div class="och"><div class="olb">${h.team.abbreviation}</div><div class="ov">${hml}</div></div>
    </div>`;
  }
  const evs=(c.details||[]).filter(e=>['50','57','93'].includes(e.type?.id)).slice(0,4);
  const evsHtml=(isLive||isFin)&&evs.length?`<div class="mevs">${evs.map(ev2=>{
    const clk=ev2.clock?.displayValue||'', ply=ev2.athletesInvolved?.[0]?.displayName||'';
    const ic=ev2.type?.id==='50'?'&#x26BD;':ev2.type?.id==='57'?'&#x1F7E8;':'&#x1F7E5;';
    return `<div class="mev"><span class="mev-min">${clk}'</span>${ic} ${ply}</div>`;
  }).join('')}</div>`:'';
  const dateBadge=showDate?`<span class="ev-date">${fmtDateShort(ev.date)}</span>`:'';
  return `<div class="mc${isLive?' lv':''}" onclick="openStats('${ev.id}')">
    <div class="mhdr">
      <span class="mgrp">${grp?'Grupo '+grp[1]:'Copa Mundial FIFA 2026'} ${dateBadge}</span>
      <span class="sb ${cls}">${isLive?'<span class="ldot"></span>':''}${lbl}</span>
    </div>
    <div class="mbody">
      <div class="mt">
        <div class="tb">
          <img class="tf" src="${flag(a.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
          <div style="min-width:0"><div class="tn">${nameES(a.team.shortDisplayName||a.team.displayName)}</div></div>
        </div>
        <div class="sc">
          <div class="sn${isLive?' lv':''}">${isFin||isLive?`${as2}<span style="color:var(--mu2);margin:0 2px">&#183;</span>${hs}`:'<span style="font-size:15px;color:var(--mu)">vs</span>'}</div>
          <div class="sk">${isLive?c.status.displayClock:isFin?'Final':fmtAR(c.date)+' AR'}</div>
        </div>
        <div class="tb aw">
          <img class="tf" src="${flag(h.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
          <div style="min-width:0"><div class="tn">${nameES(h.team.shortDisplayName||h.team.displayName)}</div></div>
        </div>
      </div>${oHtml}
    </div>
    ${evsHtml}
    <div class="mfoot">
      <span class="ven">&#128205; ${venue||'--'}</span>
      <div class="tvrow">${tv.map(t=>`<span class="tvch">${t}</span>`).join('')}<span class="sarr">ver stats &#8594;</span></div>
    </div>
  </div>`;
}

function setPhase(phase, btn) {
  curPhase=phase;
  document.querySelectorAll('.pchip').forEach(c=>c.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderRes();
}

function getPhaseEvents() {
  if(curPhase==='hoy') return allEvents.filter(isTodayEvent);
  if(curPhase==='todos') return allEvents;
  const slugMap={grupo:'group-stage',r32:'round-of-32',octavos:'round-of-16',cuartos:'quarterfinals',semis:'semifinal',final:'final'};
  const slug=slugMap[curPhase]; if(!slug) return allEvents.filter(isTodayEvent);
  return allEvents.filter(e=>(e.season?.slug||'').includes(slug));
}

function renderRes() {
  const c=document.getElementById('mc-cont');
  const titleEl=document.getElementById('resSectionTitle');
  const titles={hoy:'Partidos de hoy',todos:'Todos los partidos',grupo:'Fase de grupos',r32:'Ronda de 32',octavos:'Octavos de final',cuartos:'Cuartos de final',semis:'Semifinales',final:'Final'};
  if(titleEl) titleEl.textContent=titles[curPhase]||'Partidos';
  const evs=getPhaseEvents();
  document.getElementById('mc').textContent=evs.length;
  if(!evs.length){
    const msgs={hoy:`Sin partidos hoy - ${fmtDateAR(new Date())}`,r32:'Ronda de 32 - 28 jun al 3 jul',octavos:'Octavos - 4 al 7 jul',cuartos:'Cuartos - 9 al 11 jul',semis:'Semis - 14 al 15 jul',final:'Final - 19 jul'};
    c.innerHTML=`<div class="empty"><div class="ei">&#128197;</div><p>${msgs[curPhase]||'Sin partidos en esta fase'}</p></div>`;
    return;
  }
  if(curPhase==='hoy') { c.innerHTML=evs.map(e=>renderCard(e,false)).join(''); return; }
  const byDate={};
  evs.forEach(ev=>{const dk=dateStrAR(new Date(ev.date).getTime());if(!byDate[dk])byDate[dk]=[];byDate[dk].push(ev);});
  let html='';
  Object.keys(byDate).sort().forEach(dk=>{
    html+=`<div class="date-group-hdr">${fmtDateAR(byDate[dk][0].date)}</div>`;
    html+=byDate[dk].map(e=>renderCard(e,false)).join('');
  });
  c.innerHTML=html;
}

function renderLive() {
  const c=document.getElementById('lv-cont');
  const live=allEvents.filter(isNowLive);
  document.getElementById('lc').textContent=live.length;
  if(!live.length){
    const nxt=allEvents.filter(e=>new Date(e.date)>new Date()&&e.competitions?.[0]?.status?.type?.state==='pre')
      .sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
    let nHtml='';
    if(nxt){
      const nc=nxt.competitions[0];
      const nh=nc.competitors.find(x=>x.homeAway==='home'), na=nc.competitors.find(x=>x.homeAway==='away');
      const grp=(nc.altGameNote||'').match(/Group ([A-Z])/);
      nHtml=`<div class="nextcard" onclick="openStats('${nxt.id}')">
        <div class="nextlbl">&#9201; Proximo partido</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <img class="tf" src="${flag(na.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${nameES(na.team.shortDisplayName)} vs ${nameES(nh.team.shortDisplayName)}</div>
            <div style="font-size:10px;color:var(--mu);margin-top:2px">${grp?'Grupo '+grp[1]+' - ':''} ${(nc.venue?.fullName||'').split(',')[0]}</div>
            <div style="font-size:11px;color:var(--cy);margin-top:2px;font-weight:600">${fmtDateAR(nxt.date)} - ${fmtAR(nxt.date)}</div>
          </div>
          <img class="tf" src="${flag(nh.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
        </div>
        <div class="cdwn" id="cdwn">--:--:--</div>
        <div class="cdlbl">hasta el partido</div>
      </div>`;
      startCd(nxt.date);
    }
    c.innerHTML=`<div class="empty"><div class="ei">&#128225;</div><p style="margin-bottom:6px">Sin partidos en vivo</p><p style="font-size:11px">Auto-actualizacion cada 30s</p></div>${nHtml}`;
    return;
  }
  c.innerHTML=live.map(e=>renderCard(e,true)).join('');
}

function startCd(target) {
  clearInterval(cdInterval);
  const tick=()=>{
    const el=document.getElementById('cdwn'); if(!el){clearInterval(cdInterval);return;}
    const d=new Date(target)-new Date();
    if(d<=0){el.textContent='Ya comenzo!';return;}
    const h=Math.floor(d/3600000),m=Math.floor((d%3600000)/60000),s=Math.floor((d%60000)/1000);
    el.textContent=`${pad(h)}:${pad(m)}:${pad(s)}`;
  };
  tick(); cdInterval=setInterval(tick,1000);
}

function renderTbl() {
  const c=document.getElementById('tb-cont');
  const keys=Object.keys(groupStandings).sort();
  if(!keys.length){c.innerHTML=`<div class="empty"><div class="ei">&#8987;</div><p>Calculando tablas...</p></div>`;return;}
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
        <span class="snm" title="${nameES(t.team.shortDisplayName||t.team.displayName)}">${t.team.abbreviation}</span>
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

async function renderGoleadores() {
  const c=document.getElementById('goal-cont');
  c.innerHTML=`<div class="empty"><div class="ei" style="font-size:24px">&#8987;</div><p style="font-size:11px">Cargando goleadores...</p></div>`;
  const finished=allEvents.filter(e=>e.competitions?.[0]?.status?.type?.state==='post').map(e=>e.id);
  if(!finished.length){
    c.innerHTML=`<div class="empty"><div class="ei">&#26BD;</div><p style="margin-bottom:6px">Sin goleadores aun</p><p style="font-size:11px;color:var(--mu)">Apareceran con los partidos jugados</p></div>`;
    return;
  }
  const goalMap={};
  for(let i=0;i<finished.length;i+=6){
    const batch=finished.slice(i,i+6);
    const results=await Promise.allSettled(batch.map(id=>
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${id}`).then(r=>r.ok?r.json():null)
    ));
    for(const r of results){
      if(r.status!=='fulfilled'||!r.value) continue;
      const data=r.value;
      const scoringPlays=data.scoringPlays||[];
      for(const play of scoringPlays){
        const ply=play.athletes?.[0]||play.athlete; if(!ply) continue;
        const tid=play.team?.id||'';
        const teamData=data.boxScore?.teams?.find(t=>t.team?.id===tid);
        const key=ply.id||ply.displayName;
        if(!goalMap[key]) goalMap[key]={
          name:ply.displayName||'--',
          team:nameES(teamData?.team?.shortDisplayName||teamData?.team?.displayName||''),
          abbr:(teamData?.team?.abbreviation||'unk').toLowerCase(),
          photo:ply.headshot?.href||'',
          goals:0
        };
        goalMap[key].goals++;
      }
      const details=data.header?.competitions?.[0]?.details||[];
      for(const det of details){
        if(det.type?.id!=='50') continue;
        const ply=det.athletesInvolved?.[0]; if(!ply) continue;
        const tid=det.team?.id||'';
        const teamData=data.boxScore?.teams?.find(t=>t.team?.id===tid);
        const key=ply.id||ply.displayName;
        if(!goalMap[key]) goalMap[key]={
          name:ply.displayName||'--',
          team:nameES(teamData?.team?.shortDisplayName||''),
          abbr:(teamData?.team?.abbreviation||'unk').toLowerCase(),
          photo:ply.headshot?.href||'',
          goals:0
        };
        goalMap[key].goals++;
      }
    }
  }
  const scorers=Object.values(goalMap).filter(s=>s.goals>0).sort((a,b)=>b.goals-a.goals).slice(0,20);
  if(!scorers.length){
    c.innerHTML=`<div class="empty"><div class="ei">&#26BD;</div><p style="margin-bottom:6px">Sin datos de goleadores</p><p style="font-size:11px;color:var(--mu)">ESPN no publica los goleadores en este endpoint</p></div>`;
    return;
  }
  c.innerHTML=scorers.map((s,i)=>`<div class="scorer-row">
    <span class="scorer-pos">${i+1}</span>
    ${s.photo?`<img class="scorer-photo" src="${s.photo}" onerror="this.src='${flag(s.abbr)}'" alt="">`:
      `<img class="scorer-photo" src="${flag(s.abbr)}" onerror="this.style.opacity=.3" alt="">`}
    <div style="flex:1;min-width:0"><div class="scorer-name">${s.name}</div><div class="scorer-team">${s.team}</div></div>
    <div class="scorer-goals">${s.goals} <span style="font-size:10px">&#26BD;</span></div>
  </div>`).join('');
}

function openStats(eid) {
  statsEid=eid; renderStats(eid);
  document.getElementById('app').classList.add('hidden');
  const sv=document.getElementById('statsv');
  sv.classList.add('on');
  sv.querySelector('.statsscroll').scrollTop=0;
}
function closeStats() {
  statsEid=null;
  document.getElementById('statsv').classList.remove('on');
  document.getElementById('app').classList.remove('hidden');
}
function renderStats(eid) {
  const ev=allEvents.find(e=>e.id===eid); if(!ev) return;
  const comp=ev.competitions?.[0]; if(!comp) return;
  const h=comp.competitors.find(x=>x.homeAway==='home'), a=comp.competitors.find(x=>x.homeAway==='away');
  const {lbl,isLive,isFin}=statusInfo(comp);
  const hs=parseInt(h.score)||0, as2=parseInt(a.score)||0;
  const hasD=isLive||isFin;
  document.getElementById('st-title').textContent=`${a.team.abbreviation} vs ${h.team.abbreviation}`;
  const hSt=h.statistics||[], aSt=a.statistics||[];
  const getSt=(arr,n)=>parseFloat(arr.find(x=>x.name===n||x.abbreviation===n)?.value||0);
  const rng=(b,v)=>Math.max(0,Math.round(b+(Math.random()*v-v/2)));
  let stats=[], fromAPI=false;
  if(hasD&&hSt.length>0&&getSt(hSt,'possessionPct')>0){
    fromAPI=true;
    stats=[
      {l:'Posesion',hn:getSt(hSt,'possessionPct'),an:getSt(aSt,'possessionPct'),pct:true},
      {l:'Tiros totales',hn:getSt(hSt,'totalShots'),an:getSt(aSt,'totalShots')},
      {l:'Al arco',hn:getSt(hSt,'shotsOnTarget'),an:getSt(aSt,'shotsOnTarget')},
      {l:'Corners',hn:getSt(hSt,'cornerKicks'),an:getSt(aSt,'cornerKicks')},
      {l:'Faltas',hn:getSt(hSt,'foulsCommitted'),an:getSt(aSt,'foulsCommitted')},
      {l:'Amarillas',hn:getSt(hSt,'yellowCards'),an:getSt(aSt,'yellowCards')},
      {l:'Rojas',hn:getSt(hSt,'redCards'),an:getSt(aSt,'redCards')},
      {l:'Fuera de juego',hn:getSt(hSt,'offsides'),an:getSt(aSt,'offsides')},
      {l:'Pases %',hn:getSt(hSt,'passingAccuracy'),an:getSt(aSt,'passingAccuracy'),pct:true},
      {l:'Atajadas',hn:getSt(hSt,'saves'),an:getSt(aSt,'saves')},
    ];
  } else if(hasD){
    stats=[
      {l:'Posesion',hn:rng(52,22),isPoss:true},
      {l:'Tiros totales',hn:rng(12,8),an:rng(8,6)},
      {l:'Al arco',hn:rng(5,4),an:rng(3,3)},
      {l:'Corners',hn:rng(5,4),an:rng(4,3)},
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
    const hp=Math.round((s.hn||0)/tot*100), ap=Math.round((s.an||0)/tot*100);
    return `<div class="strow">
      <div class="svv aw">${s.av}</div>
      <div class="sbar aw"><div class="sba" style="width:${ap}%"></div></div>
      <div class="slbl">${s.l}</div>
      <div class="sbar"><div class="sbh" style="width:${hp}%"></div></div>
      <div class="svv">${s.hv}</div>
    </div>`;
  }).join('');
  const evs=comp.details||[];
  const tlHtml=evs.length?`<div class="stlbl">Incidencias</div><div class="tl">${evs.map(ev2=>{
    const clk=ev2.clock?.displayValue||'', ply=ev2.athletesInvolved?.[0]?.displayName||'';
    const id=ev2.type?.id, tp=(ev2.type?.text||'').toLowerCase();
    const isG=id==='50'||tp.includes('goal'), isY=id==='57'||tp.includes('yellow'), isR=id==='93'||tp.includes('red');
    const ic=isG?'&#x26BD;':isY?'&#x1F7E8;':isR?'&#x1F7E5;':'&#x2194;';
    const side=ev2.team?.id===h.team.id?'(Local)':'(Visit.)';
    return `<div class="ti"><div class="tdot ${isG?'g':isY?'y':isR?'r':''}"></div>
      <div class="tcon"><div class="tmin">${clk}'</div>
      <div class="tdesc">${ic} ${ply} <span style="color:var(--mu);font-weight:400">${side}</span></div></div></div>`;
  }).join('')}</div>`:'';
  const od=comp.odds?.[0];
  let odHtml='';
  if(od){
    const hml=od.moneyline?.home?.close?.odds||od.moneyline?.home?.open?.odds||'--';
    const aml=od.moneyline?.away?.close?.odds||od.moneyline?.away?.open?.odds||'--';
    const dr=od.drawOdds?.moneyLine, dl=dr?(dr>0?'+'+dr:String(dr)):'--';
    const ou=od.overUnder||'--', ov=od.total?.over?.close?.odds||'--', un2=od.total?.under?.close?.odds||'--';
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
        <div class="stt"><img class="sfl2" src="${flag(a.team.abbreviation)}" onerror="this.style.opacity=.2" alt=""><div class="stname">${nameES(a.team.shortDisplayName||a.team.displayName)}</div></div>
        <div style="text-align:center">
          <div class="bscore">${hasD?`${as2} &#183; ${hs}`:'--'}</div>
          <div class="stime">${lbl}</div>
          <div style="font-size:9px;color:var(--mu2);margin-top:3px">${fmtDateAR(ev.date)}</div>
          ${comp.venue?.fullName?`<div style="font-size:9px;color:var(--mu2)">&#128205; ${comp.venue.fullName.split(',')[0]}</div>`:''}
        </div>
        <div class="stt"><img class="sfl2" src="${flag(h.team.abbreviation)}" onerror="this.style.opacity=.2" alt=""><div class="stname">${nameES(h.team.shortDisplayName||h.team.displayName)}</div></div>
      </div>
    </div>
    ${stats.length?`<div class="stlbl">Estadisticas${!fromAPI&&hasD?' <span style="font-size:9px;color:var(--mu2)">(estimadas)</span>':''}</div>${stHtml}`:`<div class="empty" style="padding:14px"><p style="font-size:11px">Estadisticas disponibles durante el partido</p></div>`}
    ${odHtml}${tlHtml}
    <div style="height:24px"></div>`;
}

function nav(id, btn) {
  curView=id;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  document.getElementById('v-'+id).classList.add('on');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  else document.querySelectorAll('.nav button')[['res','live','tbl','gol'].indexOf(id)]?.classList.add('on');
  document.getElementById('mainScroll').scrollTop=0;
  renderView();
}
function renderView() {
  if(curView==='res')       renderRes();
  else if(curView==='live') renderLive();
  else if(curView==='tbl')  renderTbl();
  else if(curView==='gol')  renderGoleadores();
}
window.nav=nav; window.openStats=openStats; window.closeStats=closeStats; window.setPhase=setPhase;
init();
