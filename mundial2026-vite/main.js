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
let liveCommentCache = {};
let statsReqToken = 0;

const pad = n => String(n).padStart(2,'0');
const flag = a => {
  const abbr=(a||'unk').toLowerCase();
  if(abbr==='unk') return 'https://a.espncdn.com/i/leaguelogos/soccer/500/4.png';
  return `https://a.espncdn.com/i/teamlogos/countries/500/${abbr}.png`;
};

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
  const liveBtn=document.getElementById('liveNavBtn');
  if(liveBtn) liveBtn.classList.toggle('live-on',live.length>0);
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

function isPlaceholderTeam(team={}) {
  const rawName=team.shortDisplayName||team.displayName||team.name||'';
  const rawAbbr=(team.abbreviation||'').toUpperCase();
  return rawAbbr==='3RD'
    || /^([12])[A-L]$/.test(rawAbbr)
    || /Group\s+[A-L]\s+(Winner|2nd Place)/i.test(rawName)
    || /Third Place Group/i.test(rawName)
    || /Round of 32\s+\d+\s+Winner/i.test(rawName)
    || /Round of 16\s+\d+\s+Winner/i.test(rawName)
    || /Quarterfinal\s+\d+\s+Winner/i.test(rawName)
    || /Semifinal\s+\d+\s+Winner/i.test(rawName)
    || /^RD32$/i.test(rawAbbr)
    || /^RD16\s*W?(\d+)$/i.test(rawAbbr)
    || /^QF?W?(\d+)$/i.test(rawAbbr)
    || /^SFW?(\d+)$/i.test(rawAbbr);
}

function isR32TentativeTeam(team={}) {
  const rawName=team.shortDisplayName||team.displayName||team.name||'';
  const rawAbbr=(team.abbreviation||'').toUpperCase();
  return rawAbbr==='3RD'
    || /^([12])[A-L]$/.test(rawAbbr)
    || /Group\s+[A-L]\s+(Winner|2nd Place)/i.test(rawName)
    || /Third Place Group/i.test(rawName);
}

function winnerPlaceholderLabel(team={}) {
  const rawName=team.shortDisplayName||team.displayName||team.name||team.abbreviation||'Por definir';
  const rawAbbr=(team.abbreviation||'').toUpperCase();

  const r32n=parseInt((rawName.match(/Round of 32\s+(\d+)\s+Winner/i)||[])[1]||0,10);
  if(r32n) return `Ganador R32 ${r32n}`;

  const r16n=parseInt((rawName.match(/Round of 16\s+(\d+)\s+Winner/i)||rawAbbr.match(/^RD16\s*W?(\d+)$/i)||[])[1]||0,10);
  if(r16n) return `Ganador Octavos ${r16n}`;

  const qfn=parseInt((rawName.match(/Quarterfinal\s+(\d+)\s+Winner/i)||rawAbbr.match(/^QF?W?(\d+)$/i)||[])[1]||0,10);
  if(qfn) return `Ganador Cuartos ${qfn}`;

  const sfn=parseInt((rawName.match(/Semifinal\s+(\d+)\s+Winner/i)||rawAbbr.match(/^SFW?(\d+)$/i)||[])[1]||0,10);
  if(sfn) return `Ganador Semifinal ${sfn}`;

  if(/^RD32$/i.test(rawAbbr)) return 'Ganador R32';
  return nameES(rawName);
}

function resolveTentativeTeam(team={}) {
  const rawName=team.shortDisplayName||team.displayName||team.name||team.abbreviation||'Por definir';
  const rawAbbr=(team.abbreviation||'unk').toUpperCase();
  const base={name:isPlaceholderTeam(team)?winnerPlaceholderLabel(team):nameES(rawName),abbr:(team.abbreviation||'unk').toLowerCase()};

  const directSeed=rawAbbr.match(/^([12])([A-L])$/);
  if(directSeed) {
    const pos=parseInt(directSeed[1],10);
    const grp=directSeed[2];
    const row=groupStandings[grp]?.[pos-1];
    const s=row?seedFromStanding(row,grp,pos):null;
    if(s) return {name:s.name,abbr:s.abbr};
  }

  const byNameSeed=rawName.match(/Group\s+([A-L])\s+(Winner|2nd Place)/i);
  if(byNameSeed) {
    const grp=byNameSeed[1].toUpperCase();
    const pos=/winner/i.test(byNameSeed[2])?1:2;
    const row=groupStandings[grp]?.[pos-1];
    const s=row?seedFromStanding(row,grp,pos):null;
    if(s) return {name:s.name,abbr:s.abbr};
  }

  if(rawAbbr==='3RD' || /Third Place Group/i.test(rawName)) {
    const pool=rawName.match(/Group\s+([A-L](?:\/[A-L])*)/i)?.[1]?.split('/').map(x=>x.toUpperCase())||Object.keys(groupStandings);
    const candidates=pool
      .map(g=>({g,row:groupStandings[g]?.[2]}))
      .filter(x=>x.row)
      .map(x=>seedFromStanding(x.row,x.g,3));
    candidates.sort((a,b)=>b.score-a.score);
    if(candidates[0]) return {name:candidates[0].name,abbr:candidates[0].abbr};
  }

  return base;
}

function createPhaseTeamResolver(events=[], options={}) {
  const allowTentatives=options.allowTentatives===true;
  if(!allowTentatives) {
    return (team={})=>{
      if(isPlaceholderTeam(team)) return {name:winnerPlaceholderLabel(team),abbr:'unk'};
      return {
        name:nameES(team.shortDisplayName||team.displayName||team.name||team.abbreviation||'--'),
        abbr:(team.abbreviation||'unk').toLowerCase()
      };
    };
  }

  const assigned=new Map();
  const usedThirdSrc=new Set();
  const usedAbbr=new Set();

  const parseThirdCandidates=(rawName)=>{
    const pool=rawName.match(/Group\s+([A-L](?:\/[A-L])*)/i)?.[1]?.split('/').map(x=>x.toUpperCase())||Object.keys(groupStandings);
    return pool
      .map(g=>({g,row:groupStandings[g]?.[2]}))
      .filter(x=>x.row)
      .map(x=>seedFromStanding(x.row,x.g,3))
      .sort((a,b)=>b.score-a.score);
  };

  const allCandidates=Object.keys(groupStandings)
    .sort()
    .flatMap(g=>{
      const rows=groupStandings[g]||[];
      return [
        rows[0]?seedFromStanding(rows[0],g,1):null,
        rows[1]?seedFromStanding(rows[1],g,2):null,
        rows[2]?seedFromStanding(rows[2],g,3):null
      ].filter(Boolean);
    })
    .sort((a,b)=>b.score-a.score);

  // Reserve official teams already present in the fixture list to avoid duplicating them as tentative picks.
  events.forEach(ev=>{
    const cts=ev.competitions?.[0]?.competitors||[];
    cts.forEach(ct=>{
      const t=ct.team||{};
      if(isPlaceholderTeam(t)) return;
      const ab=(t.abbreviation||'').toLowerCase();
      if(ab && ab!=='unk') usedAbbr.add(ab);
    });
  });

  events.forEach(ev=>{
    const comp=ev.competitions?.[0];
    const cts=comp?.competitors||[];
    cts.forEach(ct=>{
      const t=ct.team||{};
      const rawName=t.shortDisplayName||t.displayName||t.name||'';
      const rawAbbr=(t.abbreviation||'').toUpperCase();
      if(!(rawAbbr==='3RD' || /Third Place Group/i.test(rawName))) return;

      const candidates=parseThirdCandidates(rawName);
      const picked=
        candidates.find(x=>!usedThirdSrc.has(x.src)&&!usedAbbr.has(x.abbr))
        || candidates.find(x=>!usedThirdSrc.has(x.src))
        || candidates.find(x=>!usedAbbr.has(x.abbr))
        || candidates[0]
        || null;
      if(!picked) return;
      usedThirdSrc.add(picked.src);
      if(picked.abbr&&picked.abbr!=='unk') usedAbbr.add(picked.abbr);
      assigned.set(`${ev.id}:${ct.homeAway}`,{name:picked.name,abbr:picked.abbr});
    });
  });

  return (team, ev, homeAway)=>{
    const key=`${ev?.id||''}:${homeAway||''}`;
    if(assigned.has(key)) return assigned.get(key);
    if(!isPlaceholderTeam(team)) {
      const fixed={
        name:nameES(team.shortDisplayName||team.displayName||team.name||team.abbreviation||'--'),
        abbr:(team.abbreviation||'unk').toLowerCase()
      };
      if(fixed.abbr&&fixed.abbr!=='unk') usedAbbr.add(fixed.abbr);
      return fixed;
    }

    const rawName=team.shortDisplayName||team.displayName||team.name||'';
    let picked=resolveTentativeTeam(team);
    if(picked?.abbr&&picked.abbr!=='unk'&&!usedAbbr.has(picked.abbr)) {
      usedAbbr.add(picked.abbr);
      assigned.set(key,picked);
      return picked;
    }

    if((team.abbreviation||'').toUpperCase()==='3RD' || /Third Place Group/i.test(rawName)) {
      const candidates=parseThirdCandidates(rawName);
      const alt=
        candidates.find(x=>!usedThirdSrc.has(x.src)&&!usedAbbr.has(x.abbr))
        || candidates.find(x=>!usedAbbr.has(x.abbr))
        || null;
      if(alt) {
        usedThirdSrc.add(alt.src);
        if(alt.abbr&&alt.abbr!=='unk') usedAbbr.add(alt.abbr);
        picked={name:alt.name,abbr:alt.abbr};
        assigned.set(key,picked);
        return picked;
      }
    }

    const nextAny=allCandidates.find(x=>!usedAbbr.has(x.abbr));
    if(nextAny) {
      usedAbbr.add(nextAny.abbr);
      picked={name:nextAny.name,abbr:nextAny.abbr};
      assigned.set(key,picked);
      return picked;
    }

    assigned.set(key,picked);
    return picked;
  };
}

function renderCard(ev, showDate=false, teamResolver=null, liveComment='') {
  const c=ev.competitions?.[0]; if(!c) return '';
  const h=c.competitors.find(x=>x.homeAway==='home'), a=c.competitors.find(x=>x.homeAway==='away');
  if(!h||!a) return '';
  const awayTentative=curPhase==='r32'&&isR32TentativeTeam(a.team);
  const homeTentative=curPhase==='r32'&&isR32TentativeTeam(h.team);
  const away=teamResolver?teamResolver(a.team,ev,a.homeAway):resolveTentativeTeam(a.team);
  const home=teamResolver?teamResolver(h.team,ev,h.homeAway):resolveTentativeTeam(h.team);
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
      <div class="och"><div class="olb">${(away.abbr||'unk').toUpperCase()}</div><div class="ov">${aml}</div></div>
      <div class="och"><div class="olb">Empate</div><div class="ov">${dl}</div></div>
      <div class="och"><div class="olb">${(home.abbr||'unk').toUpperCase()}</div><div class="ov">${hml}</div></div>
    </div>`;
  }
  const evs=(c.details||[]).filter(e=>['50','57','93'].includes(e.type?.id)).slice(0,4);
  const liveCommentHtml=isLive&&liveComment
    ? `<div class="live-cmt"><b>Comentario:</b>${liveComment}</div>`
    : '';
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
          <img class="tf" src="${flag(away.abbr)}" onerror="this.style.opacity=.2" alt="">
          <div style="min-width:0"><div class="tn">${away.name}${awayTentative?' <span class="tent-badge">TENTATIVO</span>':''}</div></div>
        </div>
        <div class="sc">
          <div class="sn${isLive?' lv':''}">${isFin||isLive?`${as2}<span style="color:var(--mu2);margin:0 2px">&#183;</span>${hs}`:'<span style="font-size:15px;color:var(--mu)">vs</span>'}</div>
          <div class="sk">${isLive?c.status.displayClock:isFin?'Final':fmtAR(c.date)+' AR'}</div>
        </div>
        <div class="tb aw">
          <img class="tf" src="${flag(home.abbr)}" onerror="this.style.opacity=.2" alt="">
          <div style="min-width:0"><div class="tn">${home.name}${homeTentative?' <span class="tent-badge">TENTATIVO</span>':''}</div></div>
        </div>
      </div>${liveCommentHtml}${oHtml}
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

function seedFromStanding(teamRow, group, pos) {
  if(!teamRow?.team) return null;
  const gd=(teamRow.gf||0)-(teamRow.gc||0);
  return {
    name:nameES(teamRow.team.shortDisplayName||teamRow.team.displayName||teamRow.team.abbreviation||'--'),
    abbr:(teamRow.team.abbreviation||'unk').toLowerCase(),
    score:(teamRow.pts||0)*100 + gd*10 + (teamRow.gf||0) + (4-pos),
    src:`${group}${pos}`
  };
}

function placeholderSeed(label) {
  return {name:label,abbr:'unk',score:-1,src:label};
}

function pairSeeds(seeds, count, labelPrefix) {
  const out=[];
  for(let i=0;i<count;i++) {
    out.push({
      id:`${labelPrefix}-${i+1}`,
      a:seeds[i*2]||placeholderSeed('Por definir'),
      b:seeds[i*2+1]||placeholderSeed('Por definir')
    });
  }
  return out;
}

function probableWinner(match) {
  return (match.a.score>=match.b.score?match.a:match.b) || placeholderSeed('Por definir');
}

function buildTentativeKnockout() {
  const groups=Object.keys(groupStandings).sort();
  if(!groups.length) return null;

  const firsts=[], seconds=[], thirds=[];
  for(const g of groups) {
    const rows=groupStandings[g]||[];
    const s1=seedFromStanding(rows[0],g,1), s2=seedFromStanding(rows[1],g,2), s3=seedFromStanding(rows[2],g,3);
    if(s1) firsts.push(s1);
    if(s2) seconds.push(s2);
    if(s3) thirds.push(s3);
  }

  thirds.sort((a,b)=>b.score-a.score);
  const bestThirds=thirds.slice(0,8);

  const r32Seeds=[...firsts,...seconds,...bestThirds];
  while(r32Seeds.length<32) r32Seeds.push(placeholderSeed('Por definir'));
  if(r32Seeds.length>32) r32Seeds.length=32;

  // Mix top and bottom seeds to avoid pairing contiguous groups only.
  const mixed=[];
  for(let i=0;i<16;i++) {
    mixed.push(r32Seeds[i]);
    mixed.push(r32Seeds[31-i]);
  }

  const r32=pairSeeds(mixed,16,'R32');
  const octavos=pairSeeds(r32.map(probableWinner),8,'OCT');
  const cuartos=pairSeeds(octavos.map(probableWinner),4,'CUA');
  const semis=pairSeeds(cuartos.map(probableWinner),2,'SEM');
  const final=pairSeeds(semis.map(probableWinner),1,'FIN');

  return {r32,octavos,cuartos,semis,final};
}

function renderTentativeKnockoutPhase(phase) {
  const phaseLabel={r32:'Ronda de 32',octavos:'Octavos',cuartos:'Cuartos',semis:'Semifinal',final:'Final'}[phase]||'Fase';
  if(phase==='r32') {
    const map=buildTentativeKnockout();
    if(!map) return '';
    const phaseMatches=map.r32||[];
    if(!phaseMatches.length) return '';
    const cards=phaseMatches.map((m,idx)=>`<div class="mc">
      <div class="mhdr">
        <span class="mgrp">${phaseLabel} · Cruce ${idx+1}</span>
        <span class="sb s-pre">PROBABLE</span>
      </div>
      <div class="mbody">
        <div class="mt" style="margin-bottom:8px">
          <div class="tb">
            <img class="tf" src="${flag(m.a.abbr)}" onerror="this.style.opacity=.2" alt="">
            <div style="min-width:0"><div class="tn">${m.a.name} <span class="tent-badge">TENTATIVO</span></div></div>
          </div>
        </div>
        <div class="mt">
          <div class="tb">
            <img class="tf" src="${flag(m.b.abbr)}" onerror="this.style.opacity=.2" alt="">
            <div style="min-width:0"><div class="tn">${m.b.name} <span class="tent-badge">TENTATIVO</span></div></div>
          </div>
        </div>
      </div>
    </div>`).join('');
    return `<div class="date-group-hdr">Cruces probables segun tabla actual</div>${cards}`;
  }

  const cfg={octavos:{count:8,from:'R32'},cuartos:{count:4,from:'Octavos'},semis:{count:2,from:'Cuartos'},final:{count:1,from:'Semifinal'}}[phase];
  if(!cfg) return '';
  const cards=Array.from({length:cfg.count},(_,idx)=>{
    const a=idx*2+1, b=idx*2+2;
    return `<div class="mc">
    <div class="mhdr">
      <span class="mgrp">${phaseLabel} · Cruce ${idx+1}</span>
      <span class="sb s-pre">POR JUGAR</span>
    </div>
    <div class="mbody">
      <div class="mt" style="margin-bottom:8px">
        <div class="tb">
          <img class="tf" src="${flag('unk')}" onerror="this.style.opacity=.2" alt="">
          <div style="min-width:0"><div class="tn">Ganador ${cfg.from} ${a}</div></div>
        </div>
      </div>
      <div class="mt">
        <div class="tb">
          <img class="tf" src="${flag('unk')}" onerror="this.style.opacity=.2" alt="">
          <div style="min-width:0"><div class="tn">Ganador ${cfg.from} ${b}</div></div>
        </div>
      </div>
    </div>
  </div>`;
  }).join('');

  return `<div class="date-group-hdr">Pasan los ganadores de la ronda anterior</div>${cards}`;
}

function renderRes() {
  const c=document.getElementById('mc-cont');
  const titleEl=document.getElementById('resSectionTitle');
  const titles={hoy:'Partidos de hoy',todos:'Todos los partidos',grupo:'Fase de grupos',r32:'Ronda de 32',octavos:'Octavos de final',cuartos:'Cuartos de final',semis:'Semifinales',final:'Final'};
  if(titleEl) titleEl.textContent=titles[curPhase]||'Partidos';
  const evs=getPhaseEvents();
  document.getElementById('mc').textContent=evs.length;
  if(!evs.length){
    if(['r32','octavos','cuartos','semis','final'].includes(curPhase)) {
      const tentative=renderTentativeKnockoutPhase(curPhase);
      if(tentative){ c.innerHTML=tentative; return; }
    }
    const msgs={hoy:`Sin partidos hoy - ${fmtDateAR(new Date())}`,r32:'Ronda de 32 - 28 jun al 3 jul',octavos:'Octavos - 4 al 7 jul',cuartos:'Cuartos - 9 al 11 jul',semis:'Semis - 14 al 15 jul',final:'Final - 19 jul'};
    c.innerHTML=`<div class="empty"><div class="ei">&#128197;</div><p>${msgs[curPhase]||'Sin partidos en esta fase'}</p></div>`;
    return;
  }
  if(curPhase==='hoy') { c.innerHTML=evs.map(e=>renderCard(e,false)).join(''); return; }
  const isKoPhase=['r32','octavos','cuartos','semis','final'].includes(curPhase);
  const phaseResolver=isKoPhase?createPhaseTeamResolver(evs,{allowTentatives:curPhase==='r32'}):null;
  const byDate={};
  evs.forEach(ev=>{const dk=dateStrAR(new Date(ev.date).getTime());if(!byDate[dk])byDate[dk]=[];byDate[dk].push(ev);});
  let html='';
  Object.keys(byDate).sort().forEach(dk=>{
    html+=`<div class="date-group-hdr">${fmtDateAR(byDate[dk][0].date)}</div>`;
    html+=byDate[dk].map(e=>renderCard(e,false,phaseResolver)).join('');
  });
  c.innerHTML=html;
}

function toSpanishComment(text='') {
  let out=(text||'').replace(/\s+/g,' ').trim();
  if(!out) return '';

  const tpl=[
    [/^Lineups are announced and players are warming up\.?$/i,()=> 'Ya estan confirmadas las alineaciones y los jugadores hacen la entrada en calor.'],
    [/^The match is about to start\.?$/i,()=> 'El partido esta por comenzar.'],
    [/^Kick off\.?$/i,()=> 'Comenzo el partido.'],
    [/^Half time\.?$/i,()=> 'Final del primer tiempo.'],
    [/^Second half begins\.?$/i,()=> 'Comenzo el segundo tiempo.'],
    [/^Full time\.?$/i,()=> 'Final del partido.'],
    [/^Foul by\s+(.+)\.$/i,(m,p1)=>`Falta de ${p1}.`],
    [/^(.+)\s+wins a free kick in the defensive half\.$/i,(m,p1)=>`${p1} gana un tiro libre en campo propio.`],
    [/^(.+)\s+wins a free kick in the attacking half\.$/i,(m,p1)=>`${p1} gana un tiro libre en campo rival.`],
    [/^Corner,\s*([^\.]+)\.\s*Conceded by\s+(.+)\.$/i,(m,p1,p2)=>`Corner para ${p1}. Cedido por ${p2}.`],
    [/^Attempt missed\.\s*(.+)$/i,(m,p1)=>`Remate desviado. ${p1}`],
    [/^Goal!\s*(.+)$/i,(m,p1)=>`Gol! ${p1}`],
    [/^Substitution[:|,]\s*([^\.]+)\.\s*(.+?)\s+replaces\s+(.+?)(?:\s+because of an injury)?\.?$/i,(m,p1,p2,p3)=>`Sustitucion: ${p1}. ${p2} reemplaza a ${p3}.`],
    [/^Substitution[:|,]\s*([^\.]+)\.?$/i,(m,p1)=>`Sustitucion: ${p1}.`],
    [/^(.+)\s+is shown the yellow card for a bad foul\.$/i,(m,p1)=>`${p1} recibe tarjeta amarilla por una falta.`],
    [/^(.+)\s+is shown the red card\.?$/i,(m,p1)=>`${p1} recibe tarjeta roja.`],
    [/^(.+)\s+is shown the red card for a bad foul\.$/i,(m,p1)=>`${p1} recibe tarjeta roja por una falta.`],
    [/^Offside,\s*(.+)$/i,(m,p1)=>`Fuera de juego de ${p1}.`],
    [/^Penalty\s+([^\.]+)\.$/i,(m,p1)=>`Penal: ${p1}.`]
  ];

  for(const [rx,fn] of tpl){
    const m=out.match(rx);
    if(m) return fn(...m).replace(/\s+/g,' ').trim();
  }

  const reps=[
    [/Assisted by\s+(.+)\s+following a fast break\./ig,'Asistencia de $1 tras un contraataque.'],
    [/following a set piece situation\./ig,'tras una jugada de pelota parada.'],
    [/hits the left post/ig,'pega en el palo izquierdo'],
    [/hits the right post/ig,'pega en el palo derecho'],
    [/header from the centre of the box/ig,'cabezazo desde el centro del area'],
    [/from outside the box/ig,'desde fuera del area'],
    [/from the centre of the box/ig,'desde el centro del area'],
    [/right footed shot/ig,'remate de derecha'],
    [/left footed shot/ig,'remate de izquierda'],
    [/wins a free kick/ig,'gana un tiro libre'],
    [/in the defensive half/ig,'en campo propio'],
    [/in the attacking half/ig,'en campo rival'],
    [/conceded by/ig,'cedido por'],
    [/attempt missed/ig,'remate desviado'],
    [/saved/ig,'atajado'],
    [/blocked/ig,'bloqueado'],
    [/free kick/ig,'tiro libre'],
    [/yellow card/ig,'tarjeta amarilla'],
    [/red card/ig,'tarjeta roja'],
    [/substitution/ig,'sustitucion'],
    [/offside/ig,'fuera de juego'],
    [/penalty/ig,'penal'],
    [/goal/ig,'gol'],
    [/foul/ig,'falta'],
    [/because of an injury/ig,'por una lesion'],
    [/first half begins\.?/ig,'comenzo el primer tiempo.'],
    [/second half begins\.?/ig,'comenzo el segundo tiempo.'],
    [/first half ends\.?/ig,'final del primer tiempo.'],
    [/second half ends\.?/ig,'final del segundo tiempo.'],
    [/match ends\.?/ig,'final del partido.'],
    [/replaces/ig,'reemplaza a'],
    [/is shown the yellow card/ig,'recibe tarjeta amarilla'],
    [/is shown the red card/ig,'recibe tarjeta roja'],
    [/ by /ig,' de '],
    [/ following /ig,' tras '],
    [/ from /ig,' desde '],
    [/ with /ig,' con '],
    [/ and /ig,' y ']
  ];
  reps.forEach(([from,to])=>{ out=out.replace(from,to); });

  out=out.replace(/\s+/g,' ').trim();
  if(!/[a-zA-Z]/.test(out.replace(/[A-Z][a-z]+\s*[A-Z]?[a-z]*/g,''))) return out;
  return out;
}

async function fetchLatestLiveComment(eventId) {
  try {
    const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`);
    if(!r.ok) return '';
    const data=await r.json();
    const commentary=Array.isArray(data.commentary)?data.commentary:[];
    if(!commentary.length) return '';
    commentary.sort((a,b)=>(a.sequence||0)-(b.sequence||0));
    return toSpanishComment((commentary[commentary.length-1]?.text||'').trim());
  } catch {
    return '';
  }
}

async function renderLive() {
  const c=document.getElementById('lv-cont');
  const live=allEvents.filter(isNowLive);
  document.getElementById('lc').textContent=live.length;
  if(!live.length){
    const upcoming=allEvents
      .filter(e=>isTodayEvent(e)&&new Date(e.date)>new Date()&&e.competitions?.[0]?.status?.type?.state==='pre')
      .sort((a,b)=>new Date(a.date)-new Date(b.date));
    let nHtml='';
    if(upcoming.length){
      nHtml=upcoming.map((ev,idx)=>{
        const comp=ev.competitions[0];
        const h=comp.competitors.find(x=>x.homeAway==='home'), a=comp.competitors.find(x=>x.homeAway==='away');
        const grp=(comp.altGameNote||'').match(/Group ([A-Z])/);
        return `<div class="nextcard" onclick="openStats('${ev.id}')">
          <div class="nextlbl">${idx===0?'&#9201; Proximo partido':'&#128339; Por arrancar'}</div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <img class="tf" src="${flag(a.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${nameES(a.team.shortDisplayName)} vs ${nameES(h.team.shortDisplayName)}</div>
              <div style="font-size:10px;color:var(--mu);margin-top:2px">${grp?'Grupo '+grp[1]+' - ':''} ${(comp.venue?.fullName||'').split(',')[0]}</div>
              <div style="font-size:11px;color:var(--cy);margin-top:2px;font-weight:600">${fmtDateAR(ev.date)} - ${fmtAR(ev.date)}</div>
            </div>
            <img class="tf" src="${flag(h.team.abbreviation)}" onerror="this.style.opacity=.2" alt="">
          </div>
          <div class="cdwn" data-target="${ev.date}">--:--:--</div>
          <div class="cdlbl">hasta el partido</div>
        </div>`;
      }).join('');
      startCd();
    } else {
      clearInterval(cdInterval);
    }
    c.innerHTML=nHtml;
    return;
  }
  clearInterval(cdInterval);
  const comments=await Promise.allSettled(live.map(e=>fetchLatestLiveComment(e.id)));
  comments.forEach((r,i)=>{
    if(r.status==='fulfilled'&&r.value) liveCommentCache[live[i].id]=r.value;
  });
  c.innerHTML=live.map(e=>renderCard(e,true,null,liveCommentCache[e.id]||'')).join('');
}

function startCd() {
  clearInterval(cdInterval);
  const tick=()=>{
    const els=document.querySelectorAll('.cdwn[data-target]');
    if(!els.length){clearInterval(cdInterval);return;}
    const now=new Date();
    els.forEach(el=>{
      const target=el.getAttribute('data-target');
      const d=new Date(target)-now;
      if(d<=0){el.textContent='Ya comenzo!'; return;}
      const h=Math.floor(d/3600000),m=Math.floor((d%3600000)/60000),s=Math.floor((d%60000)/1000);
      el.textContent=`${pad(h)}:${pad(m)}:${pad(s)}`;
    });
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

function renderBracketEventMatch(ev, resolver, hasNext=false) {
  const comp=ev.competitions?.[0]; if(!comp) return '';
  const h=comp.competitors.find(x=>x.homeAway==='home'), a=comp.competitors.find(x=>x.homeAway==='away');
  if(!h||!a) return '';

  const isR32Event=(ev.season?.slug||'').includes('round-of-32');
  const awayTentative=isR32Event&&isR32TentativeTeam(a.team);
  const homeTentative=isR32Event&&isR32TentativeTeam(h.team);
  const away=resolver(a.team,ev,a.homeAway);
  const home=resolver(h.team,ev,h.homeAway);
  const hs=parseInt(h.score)||0, as2=parseInt(a.score)||0;
  const {isLive,isFin,lbl}=statusInfo(comp);
  const awayWin=isFin&&as2>hs;
  const homeWin=isFin&&hs>as2;
  const venue=(comp.venue?.fullName||comp.venue?.displayName||'').split(',')[0]||'Sede por confirmar';

  return `<div class="bm${hasNext?' br-link':''}" onclick="openStats('${ev.id}')">
    <div class="bt${awayWin?' win':''}${awayTentative?' tent':''}">
      <img class="bfl" src="${flag(away.abbr)}" onerror="this.style.opacity=.2" alt="">
      <div class="btn">${away.name}${awayTentative?' <span class="tent-badge">TENTATIVO</span>':''}</div>
      <div class="bsc">${isLive||isFin?as2:'-'}</div>
    </div>
    <div class="bt${homeWin?' win':''}${homeTentative?' tent':''}">
      <img class="bfl" src="${flag(home.abbr)}" onerror="this.style.opacity=.2" alt="">
      <div class="btn">${home.name}${homeTentative?' <span class="tent-badge">TENTATIVO</span>':''}</div>
      <div class="bsc">${isLive||isFin?hs:'-'}</div>
    </div>
    <div class="bdt">${fmtDateAR(ev.date)} · ${isLive?lbl:fmtAR(ev.date)+' AR'} · ${venue}</div>
  </div>`;
}

function renderBracketTentativeMatch(match, hasNext=false) {
  return `<div class="bm${hasNext?' br-link':''}">
    <div class="bt tent">
      <img class="bfl" src="${flag(match.a.abbr)}" onerror="this.style.opacity=.2" alt="">
      <div class="btn">${match.a.name} <span class="tent-badge">TENTATIVO</span></div>
      <div class="bsc">-</div>
    </div>
    <div class="bt tent">
      <img class="bfl" src="${flag(match.b.abbr)}" onerror="this.style.opacity=.2" alt="">
      <div class="btn">${match.b.name} <span class="tent-badge">TENTATIVO</span></div>
      <div class="bsc">-</div>
    </div>
    <div class="bdt">Cruce probable segun tabla actual</div>
  </div>`;
}

function buildBracketCarryMatches(phaseKey) {
  const cfg={octavos:{count:8,from:'R32'},cuartos:{count:4,from:'Octavos'},semis:{count:2,from:'Cuartos'},final:{count:1,from:'Semifinal'}}[phaseKey];
  if(!cfg) return [];
  return Array.from({length:cfg.count},(_,idx)=>({
    a:{name:`Ganador ${cfg.from} ${idx*2+1}`,abbr:'unk'},
    b:{name:`Ganador ${cfg.from} ${idx*2+2}`,abbr:'unk'}
  }));
}

function renderBracketCarryMatch(match, hasNext=false) {
  return `<div class="bm${hasNext?' br-link':''}">
    <div class="bt">
      <img class="bfl" src="${flag('unk')}" onerror="this.style.opacity=.2" alt="">
      <div class="btn">${match.a.name}</div>
      <div class="bsc">-</div>
    </div>
    <div class="bt">
      <img class="bfl" src="${flag('unk')}" onerror="this.style.opacity=.2" alt="">
      <div class="btn">${match.b.name}</div>
      <div class="bsc">-</div>
    </div>
    <div class="bdt">Pasan los ganadores de la ronda anterior</div>
  </div>`;
}

function initBracketDragScroll() {
  const el=document.getElementById('br-cont');
  if(!el || el.dataset.dragReady==='1') return;
  el.dataset.dragReady='1';

  let isDown=false, startX=0, startLeft=0, moved=false;

  el.addEventListener('mousedown',(e)=>{
    isDown=true;
    moved=false;
    startX=e.pageX;
    startLeft=el.scrollLeft;
    el.classList.add('dragging');
  });

  window.addEventListener('mouseup',()=>{
    if(!isDown) return;
    isDown=false;
    el.classList.remove('dragging');
    if(moved) {
      el.dataset.suppressClick='1';
      setTimeout(()=>{ el.dataset.suppressClick='0'; },80);
    }
  });

  el.addEventListener('mouseleave',()=>{
    if(!isDown) return;
    isDown=false;
    el.classList.remove('dragging');
  });

  el.addEventListener('mousemove',(e)=>{
    if(!isDown) return;
    const dx=e.pageX-startX;
    if(Math.abs(dx)>4) moved=true;
    e.preventDefault();
    el.scrollLeft=startLeft-dx;
  });

  el.addEventListener('click',(e)=>{
    if(el.dataset.suppressClick==='1') {
      e.preventDefault();
      e.stopPropagation();
    }
  },true);
}

function renderBracketSlot(content, connectFromPrev=false) {
  return `<div class="br-slot${connectFromPrev?' connect':''}">${content}</div>`;
}

function renderLlave() {
  const c=document.getElementById('br-cont');
  const phaseOrder=[
    {key:'r32',slug:'round-of-32',title:'Ronda de 32'},
    {key:'octavos',slug:'round-of-16',title:'Octavos de final'},
    {key:'cuartos',slug:'quarterfinals',title:'Cuartos de final'},
    {key:'semis',slug:'semifinal',title:'Semifinales'},
    {key:'final',slug:'final',title:'Final'}
  ];
  const tentativeMap=buildTentativeKnockout();
  const slotCountByPhase={r32:16,octavos:8,cuartos:4,semis:2,final:1};
  const cols=phaseOrder.map(phase=>{
    const evs=allEvents.filter(e=>(e.season?.slug||'').includes(phase.slug)).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const hasNext=phase.key!=='final';
    let cards=[];

    if(evs.length) {
      const resolver=createPhaseTeamResolver(evs,{allowTentatives:phase.key==='r32'});
      cards=evs.map(ev=>renderBracketEventMatch(ev,resolver,hasNext));
    } else {
      if(phase.key==='r32') {
        const tent=tentativeMap?.r32||[];
        cards=tent.map(m=>renderBracketTentativeMatch(m,hasNext));
      } else {
        const carry=buildBracketCarryMatches(phase.key);
        cards=carry.map(m=>renderBracketCarryMatch(m,hasNext));
      }
    }

    const expected=slotCountByPhase[phase.key]||cards.length;
    while(cards.length<expected) {
      cards.push(renderBracketCarryMatch({a:{name:'A definir',abbr:'unk'},b:{name:'A definir',abbr:'unk'}},hasNext));
    }
    if(cards.length>expected) cards=cards.slice(0,expected);

    const body=cards
      .map(card=>renderBracketSlot(card,phase.key!=='r32'))
      .join('');

    return `<section class="br-col br-col-${phase.key}"><div class="br-col-title">${phase.title}</div><div class="br-col-list">${body}</div></section>`;
  }).join('');

  c.innerHTML=`<div class="bracket-board">${cols}</div>`;
  initBracketDragScroll();
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
        const teamData=(data.boxScore?.teams||data.boxscore?.teams||[]).find(t=>t.team?.id===tid);
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
        const isGoalByFlag=det.scoringPlay===true;
        const typeText=(det.type?.text||'').toLowerCase();
        const isGoalByType=det.type?.id==='50'||typeText.includes('goal')||typeText.includes('gol');
        if(!isGoalByFlag&&!isGoalByType) continue;
        const ply=det.participants?.[0]?.athlete||det.athletesInvolved?.[0];
        if(!ply) continue;
        const tid=det.team?.id||'';
        const teamData=(data.boxScore?.teams||data.boxscore?.teams||[]).find(t=>t.team?.id===tid);
        const key=ply.id||ply.displayName;
        if(!goalMap[key]) goalMap[key]={
          name:ply.displayName||'--',
          team:nameES(teamData?.team?.shortDisplayName||teamData?.team?.displayName||det.team?.displayName||''),
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
    <div class="scorer-goals">${s.goals}</div>
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
async function renderStats(eid) {
  const reqId=++statsReqToken;
  const ev=allEvents.find(e=>e.id===eid); if(!ev) return;
  const baseComp=ev.competitions?.[0]; if(!baseComp) return;

  const stCont=document.getElementById('st-cont');
  if(stCont) stCont.innerHTML=`<div class="empty" style="padding:14px"><p style="font-size:11px">Cargando estadisticas reales...</p></div>`;

  let summary=null;
  try {
    const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eid}`);
    if(r.ok) summary=await r.json();
  } catch {}
  if(reqId!==statsReqToken||statsEid!==eid) return;

  const sumComp=summary?.header?.competitions?.[0]||null;
  const comp=sumComp||baseComp;
  const h=comp.competitors?.find(x=>x.homeAway==='home')||baseComp.competitors.find(x=>x.homeAway==='home');
  const a=comp.competitors?.find(x=>x.homeAway==='away')||baseComp.competitors.find(x=>x.homeAway==='away');
  if(!h||!a) return;

  const {lbl,isLive,isFin}=statusInfo(comp);
  const hs=parseInt(h.score)||0, as2=parseInt(a.score)||0;
  const hasD=isLive||isFin;
  document.getElementById('st-title').textContent=`${a.team.abbreviation} vs ${h.team.abbreviation}`;

  const boxTeams=summary?.boxscore?.teams||[];
  const hBox=boxTeams.find(t=>t.homeAway==='home')||{};
  const aBox=boxTeams.find(t=>t.homeAway==='away')||{};
  const hSt=hBox.statistics||[];
  const aSt=aBox.statistics||[];

  const getSt=(arr,n)=>{
    const f=arr.find(x=>x.name===n||x.abbreviation===n);
    if(!f) return null;
    const raw=f.displayValue??f.value??'';
    if(raw===null||raw===undefined||raw==='') return null;
    const v=parseFloat(String(raw).replace('%','').replace(',','.'));
    return Number.isFinite(v)?v:null;
  };

  const statDefs=[
    {l:'Posesion',k:'possessionPct',pct:true},
    {l:'Tiros totales',k:'totalShots'},
    {l:'Al arco',k:'shotsOnTarget'},
    {l:'Corners',k:'cornerKicks'},
    {l:'Faltas',k:'foulsCommitted'},
    {l:'Amarillas',k:'yellowCards'},
    {l:'Rojas',k:'redCards'},
    {l:'Fuera de juego',k:'offsides'},
    {l:'Pases %',k:'passingAccuracy',pct:true},
    {l:'Atajadas',k:'saves'}
  ];

  const stats=statDefs
    .map(d=>({l:d.l,hn:getSt(hSt,d.k),an:getSt(aSt,d.k),pct:!!d.pct}))
    .filter(s=>s.hn!==null||s.an!==null)
    .map(s=>({
      ...s,
      hn:s.hn??0,
      an:s.an??0,
      hv:(s.pct?`${s.hn??0}%`:`${s.hn??0}`),
      av:(s.pct?`${s.an??0}%`:`${s.an??0}`)
    }));

  const stHtml=stats.map(s=>{
    const tot=s.pct?100:((s.hn||0)+(s.an||0))||1;
    const hp=Math.round((s.hn||0)/tot*100), ap=Math.round((s.an||0)/tot*100);
    return `<div class="strow">
      <div class="svv aw">${s.av}</div>
      <div class="sbar aw"><div class="sba" style="width:${ap}%"></div></div>
      <div class="slbl">${s.l}</div>
      <div class="sbar"><div class="sbh" style="width:${hp}%"></div></div>
      <div class="svv">${s.hv}</div>
    </div>`;
  }).join('');

  const norm=s=>String(s||'').toLowerCase().trim();
  const homeNames=[h.team.displayName,h.team.shortDisplayName,h.team.name,h.team.abbreviation,h.team.location].map(norm).filter(Boolean);
  const awayNames=[a.team.displayName,a.team.shortDisplayName,a.team.name,a.team.abbreviation,a.team.location].map(norm).filter(Boolean);
  const sideFrom=(teamId='',text='')=>{
    if(teamId&&teamId===h.team.id) return '(Local)';
    if(teamId&&teamId===a.team.id) return '(Visit.)';
    const m=String(text||'').match(/\(([^)]+)\)/);
    const tn=norm(m?.[1]||'');
    if(!tn) return '';
    if(homeNames.some(n=>n===tn||n.includes(tn)||tn.includes(n))) return '(Local)';
    if(awayNames.some(n=>n===tn||n.includes(tn)||tn.includes(n))) return '(Visit.)';
    return '';
  };

  const rawInc=(sumComp?.details&&sumComp.details.length)?sumComp.details:(summary?.keyEvents||[]);
  const baseIncidents=(rawInc||[]).map(ev2=>{
    const clk=ev2.clock?.displayValue||ev2.time?.displayValue||'';
    const ply=ev2.participants?.[0]?.athlete?.displayName||ev2.athletesInvolved?.[0]?.displayName||'';
    const descRaw=ev2.text||ev2.detail||ev2.type?.text||ev2.type?.name||'';
    const descLc=descRaw.toLowerCase();
    const ttxt=(ev2.type?.text||ev2.type?.name||'').toLowerCase();
    const isG=ev2.scoringPlay===true||ev2.ownGoal===true||ttxt.includes('goal')||ttxt.includes('gol');
    const isR=ev2.redCard===true||ttxt.includes('red')||descLc.includes('red card')||descLc.includes('tarjeta roja');
    const isY=ev2.yellowCard===true||ttxt.includes('yellow')||descLc.includes('yellow card')||descLc.includes('tarjeta amarilla');
    const isSub=ttxt.includes('substitution')||descLc.includes('substitution')||descLc.includes('replaces');
    const textRaw=(ply&&descRaw)?`${ply} - ${descRaw}`:(ply||descRaw||'Incidencia');
    const text=toSpanishComment(textRaw);
    return {
      clk,
      text,
      teamId:ev2.team?.id||'',
      isG,
      isY,
      isR,
      isSub,
      side:sideFrom(ev2.team?.id||'',text),
      tVal:ev2.clock?.value??ev2.time?.value??null,
      seq:ev2.sequence??null
    };
  });

  const commentaryIncidents=(summary?.commentary||[])
    .filter(c=>/yellow card|red card|substitution|replaces/i.test(c.text||''))
    .map(c=>{
      const t=String(c.text||'').trim();
      const lc=t.toLowerCase();
      return {
        clk:c.time?.displayValue||'',
        text:toSpanishComment(t),
        teamId:'',
        isG:false,
        isY:lc.includes('yellow card'),
        isR:lc.includes('red card'),
        isSub:lc.includes('substitution')||lc.includes('replaces'),
        side:sideFrom('',t),
        tVal:c.time?.value??null,
        seq:c.sequence??null
      };
    });

  const seen=new Set();
  const parseClkValue=clk=>{
    const s=String(clk||'').replace(/\s/g,'');
    const m=s.match(/^(\d+)(?:'\+?(\d+))?/);
    if(!m) return Number.MAX_SAFE_INTEGER;
    return (parseInt(m[1],10)||0)*60 + (parseInt(m[2]||'0',10)||0);
  };

  const incidents=[...baseIncidents,...commentaryIncidents].filter(x=>{
    const k=`${x.clk}|${x.text}|${x.isY}|${x.isR}|${x.isSub}`;
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a,b)=>{
    const ta=a.tVal??parseClkValue(a.clk);
    const tb=b.tVal??parseClkValue(b.clk);
    if(ta!==tb) return ta-tb;
    const sa=a.seq??Number.MAX_SAFE_INTEGER;
    const sb=b.seq??Number.MAX_SAFE_INTEGER;
    return sa-sb;
  });

  const tlHtml=incidents.length?`<div class="stlbl">Incidencias</div><div class="tl">${incidents.map(x=>{
    const ic=x.isG?'&#x26BD;':x.isY?'&#x1F7E8;':x.isR?'&#x1F7E5;':x.isSub?'&#x2194;':'&#x2194;';
    const side=x.side||'';
    return `<div class="ti"><div class="tdot ${x.isG?'g':x.isY?'y':x.isR?'r':''}"></div>
      <div class="tcon"><div class="tmin">${x.clk}</div>
      <div class="tdesc">${ic} ${x.text} <span style="color:var(--mu);font-weight:400">${side}</span></div></div></div>`;
  }).join('')}</div>`:'';

  const od=(comp.odds?.[0]||baseComp.odds?.[0]||null);
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
    ${stats.length?`<div class="stlbl">Estadisticas</div>${stHtml}`:`<div class="empty" style="padding:14px"><p style="font-size:11px">Estadisticas reales no disponibles para este partido</p></div>`}
    ${odHtml}${tlHtml}
    <div style="height:24px"></div>`;
}

function nav(id, btn) {
  curView=id;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  document.getElementById('v-'+id).classList.add('on');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  else document.querySelectorAll('.nav button')[['res','live','tbl','llave','gol'].indexOf(id)]?.classList.add('on');
  document.getElementById('mainScroll').scrollTop=0;
  renderView();
}
function renderView() {
  if(curView==='res')       renderRes();
  else if(curView==='live') renderLive();
  else if(curView==='tbl')  renderTbl();
  else if(curView==='llave') renderLlave();
  else if(curView==='gol')  renderGoleadores();
}
window.nav=nav; window.openStats=openStats; window.closeStats=closeStats; window.setPhase=setPhase;
init();
