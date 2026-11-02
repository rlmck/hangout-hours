import * as api from "./api.js";
import { download, exportAll } from "./export.js";

const PEOPLE = {
  Ross:{short:"Ross",ini:"R",c:"var(--ross)",bg:"var(--ross-bg)"},
  Baz:{short:"Baz",ini:"B",c:"var(--baz)",bg:"var(--baz-bg)"},
  Patrick:{short:"Pat",ini:"P",c:"var(--patrick)",bg:"var(--patrick-bg)"}
};
const STAFF = Object.keys(PEOPLE);
const CATS = [
  {id:"shift",label:"Shift",c:"var(--c-shift)"},{id:"setting",label:"Route setting / reset",c:"var(--c-setting)"},
  {id:"maintenance",label:"Maintenance",c:"var(--c-maintenance)"},{id:"website",label:"Website / SimplyBook",c:"var(--c-website)"},
  {id:"board",label:"Symmetry board",c:"var(--c-board)"},{id:"admin",label:"Management / admin",c:"var(--c-admin)"},
  {id:"other",label:"Other",c:"var(--c-other)"}
];
const CAT = Object.fromEntries(CATS.map(c=>[c.id,c]));
const METHODS = {cash_drawer:"Cash from drawer", bank:"Bank transfer", other:"Other"};
const ME_KEY = "hangout-me", CACHE = "hangout-cache2";
const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], DAYSL=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], MONSL=["January","February","March","April","May","June","July","August","September","October","November","December"];
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const iso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d=parse(s); d.setDate(d.getDate()+n); return iso(d); };
const tIso = () => iso(new Date());
const fd = s => { const d=parse(s); return DAYS[d.getDay()]+" "+d.getDate()+" "+MONS[d.getMonth()]; };   // "Fri 30 Oct"
const fmt = h => h==null ? "–" : String(Math.round(h*100)/100);
const gbp = n => "£"+(Math.round((n||0)*100)/100).toFixed(2);
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sum = a => a.reduce((x,y)=>x+(y||0),0);
const uid = () => crypto.randomUUID();
const store = { get(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }, del(k){ try{ localStorage.removeItem(k); }catch(e){} } };

/* ---------- shift pattern ----------
   A shift runs from 30 min before opening to 30 min after closing.
   To change the opening hours, add ONE line to PATTERNS with the date it starts (older dates keep their old hours).
   days = [Sun, Mon, Tue, Wed, Thu, Fri, Sat]; null = closed.
   One-off closed days (bank holidays, events…) are closed from the rota and stored in the database (state.closures). */
const PATTERNS = [
  {from:"2000-01-01", days:[["09:30","15:00"],["18:00","22:00"],["15:30","22:00"],["15:30","22:00"],["15:30","22:00"],["18:00","22:00"],["09:30","15:00"]]},
  {from:"2026-11-02", days:[["09:30","15:00"],["15:30","22:00"],["15:30","22:00"],["15:30","22:00"],["15:30","22:00"],null,["09:30","15:00"]]},
];
const mins = hm => { const [h,m]=hm.split(":").map(Number); return h*60+m; };
const closureOn = ds => (state.closures||[]).find(c=>c.date===ds);
function shiftPattern(ds){
  const c = closureOn(ds);
  return c ? {closed:true,oneOff:true,reason:c.reason||"",start:null,end:null,hours:0} : basePattern(ds);
}
function basePattern(ds){
  let p = PATTERNS[0]; for (const x of PATTERNS) if (ds>=x.from) p = x;
  const d = p.days[parse(ds).getDay()];
  return d ? {closed:false,start:d[0],end:d[1],hours:(mins(d[1])-mins(d[0]))/60} : {closed:true,start:null,end:null,hours:0};
}
const at = (ds,hm) => { const d=parse(ds); const [h,m]=hm.split(":").map(Number); d.setHours(h,m,0,0); return d; };
const sEnd = s => at(s.date, shiftPattern(s.date).end || "22:00");

/* ---------- state + saving ---------- */
let me = store.get(ME_KEY);   // "Ross" | "Baz" | "Patrick"
let state = {rota:[], closures:[], shifts:[], logs:[], expenses:[]};
const sync = t => { $("sync").textContent = (me ? me+" · " : "")+t; };
let loading = null;
function load(){
  if (loading) return loading;
  sync("Syncing…");
  loading = api.loadAll().then(d=>{ state = d; store.set(CACHE,state); render(); sync("Synced"); })
    .catch(e=>{ if (e && e.message==="AUTH") signedOut(); else sync("Offline – showing saved copy"); })
    .finally(()=>{ loading = null; });
  return loading;
}
let queue = Promise.resolve(), failed = false;
function save(...calls){            // optimistic: state is already changed; send calls to the server in order
  store.set(CACHE,state); render(); sync("Saving…");
  calls.forEach(fn=>{ queue = queue.then(()=>failed ? null : fn()).catch(e=>{ console.error(e); failed = true; }); });
  queue = queue.then(()=>{ if (failed){ failed = false; toast("Not saved – try again"); load(); } else sync("Synced"); });
}
function signedOut(){ store.del(ME_KEY); store.del(CACHE); me = null; showLogin("Please sign in again."); }

/* ---------- derived ---------- */
const whose = sel => sel==="all" ? STAFF : [sel];
const onDay = ds => STAFF.filter(p=>state.rota.some(r=>r.date===ds && r.person===p));
function shiftOf(person, ds){
  const n = state.shifts.find(s=>s.person===person && s.date===ds);
  const override = n && typeof n.hours==="number" ? n.hours : null;
  return {person, date:ds, override, note:n ? n.note : "", hours:override ?? shiftPattern(ds).hours};
}
const shiftsFor = ppl => state.rota.filter(r=>ppl.includes(r.person)).map(r=>shiftOf(r.person,r.date)).sort((a,b)=>a.date.localeCompare(b.date));
function derive(ppl){
  const now = new Date(), t = tIso(), shifts = shiftsFor(ppl);
  const ahead = shifts.filter(s=>sEnd(s)>now), past = shifts.filter(s=>sEnd(s)<=now);
  const done = past.map(s=>({person:s.person,cat:"shift",date:s.date,hours:s.hours}))
    .concat(state.logs.filter(l=>ppl.includes(l.person) && l.date<=t).map(l=>({person:l.person,cat:l.cat,date:l.date,hours:l.hours||0})));
  const mk = t.slice(0,7);
  return {now,t,ahead,past,done,worked:sum(done.map(x=>x.hours)),month:sum(done.filter(x=>x.date.startsWith(mk)).map(x=>x.hours)),booked:sum(ahead.map(s=>s.hours))};
}
function historyItems(ppl){
  return derive(ppl).past.map(s=>({k:"shift",id:s.date,person:s.person,date:s.date,cat:"shift",hours:s.hours,note:s.note}))
    .concat(state.logs.filter(l=>ppl.includes(l.person)).map(l=>({k:"log",id:l.id,person:l.person,date:l.date,cat:l.cat,hours:l.hours,note:l.note})))
    .sort((a,b)=>b.date.localeCompare(a.date) || a.person.localeCompare(b.person));
}
function whenTxt(s, now){
  const st = at(s.date, shiftPattern(s.date).start || "00:00");
  if (st<=now && now<sEnd(s)) return "On now";
  const t0 = new Date(now); t0.setHours(0,0,0,0);
  const n = Math.round((parse(s.date)-t0)/864e5);
  return n===0 ? "Today" : n===1 ? "Tomorrow" : n<14 ? "In "+n+" days" : "In "+Math.floor(n/7)+" weeks";
}
const sw = p => '<span class="sw" style="background:'+(PEOPLE[p] ? PEOPLE[p].c : "var(--closed)")+'"></span>';
const owedTo = p => sum(state.expenses.filter(e=>e.person===p && e.status==="unpaid").map(e=>e.amount));

/* ---------- who filter (Me / others / Everyone) ---------- */
let hoursWho = null, histWho = null, costWho = null;
function seg(name, cur){
  const opts = [[me,"Me"]].concat(STAFF.filter(p=>p!==me).map(p=>[p,p]), [["all","Everyone"]]);
  return '<div class="seg" role="group" aria-label="Whose">'+opts.map(([v,l])=>'<button type="button" data-seg="'+name+'" data-v="'+v+'" aria-pressed="'+(cur===v)+'">'+esc(l)+'</button>').join("")+'</div>';
}

/* ---------- render ---------- */
function render(){
  if (!me) return;
  const D = derive([me]), now = D.now;
  $("todayLbl").textContent = DAYSL[now.getDay()]+" "+now.getDate()+" "+MONSL[now.getMonth()];
  const n = D.ahead[0];
  if (n){
    const d = parse(n.date), p = shiftPattern(n.date);
    $("nextWrap").innerHTML = '<button class="next" data-shift="'+esc(n.date)+'" aria-label="Your next shift"><span class="k"><span>Your next shift</span><span class="when">'+whenTxt(n,now)+'</span></span>'+
      '<div class="nday">'+DAYSL[d.getDay()]+'</div><div class="date">'+d.getDate()+' '+MONSL[d.getMonth()]+'</div>'+
      '<div class="facts"><div><small>Shift</small><b class="num">'+(p.closed?"–":p.start+'–'+p.end)+'</b></div><div><small>Hours</small><b class="num">'+fmt(n.hours)+'</b></div><div><small>Shifts ahead</small><b class="num">'+D.ahead.length+'</b></div></div></button>';
  } else {
    $("nextWrap").innerHTML = '<button class="next" data-open="rota"><span class="k"><span>Your next shift</span></span><div class="nday">None booked</div><div class="date">Open the rota to add one</div></button>';
  }
  const lbls = ["Today","Tomorrow",DAYSL[parse(addDays(D.t,2)).getDay()]];
  $("who").innerHTML = [0,1,2].map(i=>{
    const ds = addDays(D.t,i), ppl = onDay(ds), closed = shiftPattern(ds).closed;
    const names = ppl.length ? ppl.map(p=>'<span class="pn">'+sw(p)+esc(PEOPLE[p].short)+'</span>').join("") : '<span class="pn">'+sw(null)+(closed?"Closed":"Not set")+'</span>';
    return '<button data-day="'+ds+'" aria-label="'+esc(lbls[i]+": "+(ppl.length?ppl.join(", "):closed?"closed":"not set"))+'"><small>'+lbls[i]+'</small><b>'+names+'</b></button>';
  }).join("");
  $("tRota").textContent = D.ahead.length ? D.ahead.length+" shift"+(D.ahead.length===1?"":"s")+" ahead" : "Who’s on when";
  $("tHours").textContent = fmt(D.worked)+"h";
  $("tHoursS").textContent = fmt(D.month)+"h in "+MONSL[now.getMonth()];
  const last = historyItems([me]).filter(x=>x.date<=D.t)[0];
  $("tHist").textContent = last ? "Last: "+CAT[last.cat].label+", "+fd(last.date) : "Nothing yet";
  const owed = owedTo(me);
  $("tCost").textContent = owed>0 ? gbp(owed)+" owed to you" : "Nothing owed to you";
  if ($("v-rota").classList.contains("open")) renderRota();
  if ($("v-hours").classList.contains("open")) renderHours();
  if ($("v-history").classList.contains("open")) renderHist();
  if ($("v-costs").classList.contains("open")) renderCosts();
  if ($("picker").open) renderPicker();
}

/* rota: current month + next two; page back through past months (read-only) */
let rotaOff = 0;
const monthNo = ds => { const d=parse(ds); return d.getFullYear()*12+d.getMonth(); };
const readOnlyDay = ds => monthNo(ds) < monthNo(tIso());
function renderRota(){
  const t = tIso(), cm = monthNo(t);
  let html = '<div class="legend">'+STAFF.map(k=>'<span>'+sw(k)+esc(k)+'</span>').join("")+'<span>'+sw(null)+'Closed</span></div>';
  for (let k=0;k<3;k++){
    const mm = cm+rotaOff+k, y = Math.floor(mm/12), m = mm%12;
    const lead = (new Date(y,m,1).getDay()+6)%7, dim = new Date(y,m+1,0).getDate();
    let mine = 0, mineH = 0, cells = "";
    for (let i=0;i<lead;i++) cells += '<div class="cell blank"></div>';
    for (let d=1; d<=dim; d++){
      const ds = y+"-"+pad(m+1)+"-"+pad(d), p = shiftPattern(ds), ppl = onDay(ds), isMe = ppl.includes(me);
      if (isMe){ mine++; mineH += shiftOf(me,ds).hours; }
      const cls = "cell"+(ds<t?" past":"")+(ds===t?" today":"")+(p.closed?" closed":"");
      let style = "";
      if (ppl.length===1) style = 'background:'+PEOPLE[ppl[0]].bg+';color:'+PEOPLE[ppl[0]].c+';';
      if (isMe) style += 'box-shadow:inset 0 0 0 2px '+PEOPLE[me].c+';';
      const who = ppl.length===1 ? '<span class="p">'+esc(PEOPLE[ppl[0]].short)+'</span>'
        : ppl.length ? '<span class="ini">'+ppl.map(q=>'<span style="color:'+PEOPLE[q].c+'">'+PEOPLE[q].ini+'</span>').join("")+'</span>'
        : p.closed ? '<span class="p">Closed</span>' : '<span class="p"></span>';
      const label = fd(ds)+": "+(ppl.length ? ppl.join(", ") : p.closed ? "closed"+(p.reason?" ("+p.reason+")":"") : "nobody yet")+(isMe?" (you)":"");
      cells += '<button class="'+cls+'"'+(style?' style="'+style+'"':'')+' data-day="'+ds+'" aria-label="'+esc(label)+'"><span class="n">'+d+'</span>'+who+'</button>';
    }
    html += '<div class="sec">'+MONSL[m]+' '+y+'<span>You: '+mine+' shift'+(mine===1?"":"s")+', '+fmt(mineH)+'h</span></div>'+
      '<div class="cal"><div class="wk">'+["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(x=>'<div>'+x+'</div>').join("")+'</div><div class="days">'+cells+'</div></div>';
  }
  html += '<div class="pager"><button type="button" data-rp="-1">‹ Earlier</button>'+(rotaOff<0?'<button type="button" data-rp="1">Later ›</button>':'')+'</div>';
  html += '<p class="hint">Tap a day to see shift times, change who’s on, or close the wall for a day. Changes show for everyone. Past months are read-only.</p>';
  $("rotaBody").innerHTML = html;
}

function hoursFor(ppl){
  const D = derive(ppl);
  const types = CATS.map(c=>({c,h:sum(D.done.filter(x=>x.cat===c.id).map(x=>x.hours))})).filter(x=>x.h>0);
  const max = Math.max(1,...types.map(x=>x.h));
  const months = {};
  D.done.forEach(x=>{ const k=x.date.slice(0,7); months[k]=(months[k]||0)+x.hours; });
  return '<div class="sec">By type</div><div class="card typ">'+(types.length?types.map(x=>'<span>'+esc(x.c.label)+'</span><span class="num">'+fmt(x.h)+'h</span><span class="tr"><i style="width:'+(x.h/max*100)+'%;background:'+x.c.c+'"></i></span>').join(""):'<span>Nothing logged yet</span>')+'</div>'+
    '<div class="sec">By month</div><div class="card">'+(Object.keys(months).length?Object.keys(months).sort().reverse().map(k=>{ const [y,m]=k.split("-").map(Number); return '<div class="mrow"><span>'+MONSL[m-1]+' '+y+'</span><span class="num">'+fmt(months[k])+'h</span></div>'; }).join(""):'<div class="mrow"><span>Nothing yet</span></div>')+'</div>';
}
function renderHours(){
  const ppl = whose(hoursWho);
  let html = seg("hours", hoursWho);
  if (hoursWho==="all"){
    const per = STAFF.map(p=>derive([p]));
    html += '<div class="sec">Per person</div><div class="card cmp"><span></span>'+STAFF.map(p=>'<span class="ch">'+sw(p)+esc(PEOPLE[p].short)+'</span>').join("")+
      [["worked","Worked"],["month","This month"],["booked","Booked ahead"]].map(([k,l])=>'<span class="rh">'+l+'</span>'+per.map(D=>'<b class="num">'+fmt(D[k])+'</b>').join("")).join("")+'</div>';
  } else {
    const D = derive(ppl);
    html += '<div class="stats" style="margin-top:12px"><div class="stat"><b class="num">'+fmt(D.worked)+'</b><span>hours worked</span></div><div class="stat"><b class="num">'+fmt(D.month)+'</b><span>this month</span></div><div class="stat"><b class="num">'+fmt(D.booked)+'</b><span>booked ahead</span></div></div>';
  }
  html += hoursFor(ppl);
  html += '<div class="links"><button type="button" class="link" id="hoursCsv">Download CSV</button><button type="button" class="link" id="exportAll">Export all data</button></div>'+
    '<p class="hint">Shifts count once they’ve finished. “Export all data” saves one CSV per table, ready to import into a Google Sheet.</p>';
  $("hoursBody").innerHTML = html;
}

function renderHist(){
  const ppl = whose(histWho), items = historyItems(ppl), all = histWho==="all";
  let html = seg("hist", histWho);
  if (!items.length){ $("histBody").innerHTML = html+'<p class="hint">Nothing logged yet.</p>'; return; }
  const g = {}; items.forEach(i=>(g[i.date.slice(0,7)] ||= []).push(i));
  html += Object.keys(g).sort().reverse().map(k=>{
    const [y,m] = k.split("-").map(Number);
    return '<div class="sec">'+MONSL[m-1]+' '+y+'<span class="num">'+fmt(sum(g[k].map(i=>i.hours||0)))+'h</span></div><div class="card">'+g[k].map(i=>{
      const d = parse(i.date), c = CAT[i.cat] || CAT.other, mine = i.person===me;
      const inner = '<span class="sw" style="background:'+c.c+'"></span><span class="dt">'+DAYS[d.getDay()]+' '+d.getDate()+'</span><span class="tx"><b>'+esc(c.label)+(all?' · '+esc(PEOPLE[i.person].short):'')+'</b>'+(i.note?'<span>'+esc(i.note)+'</span>':'')+'</span>'+
        (i.hours==null ? (mine?'<span class="miss">Add hours</span>':'<span class="hr">–</span>') : '<span class="hr num">'+fmt(i.hours)+'h</span>');
      return mine ? '<button class="ent" data-'+i.k+'="'+esc(i.id)+'">'+inner+'</button>' : '<div class="ent">'+inner+'</div>';
    }).join("")+'</div>';
  }).join("");
  if (!all && histWho!==me) html += '<p class="hint">You can see '+esc(histWho)+'’s entries but only they can change them.</p>';
  $("histBody").innerHTML = html;
}

function renderCosts(){
  const ppl = whose(costWho), all = costWho==="all";
  const list = state.expenses.filter(e=>ppl.includes(e.person)).sort((a,b)=>b.date.localeCompare(a.date));
  const unpaid = list.filter(e=>e.status==="unpaid"), paid = list.filter(e=>e.status==="reimbursed");
  const row = e => {
    const mine = e.person===me;
    const sub = e.status==="reimbursed" ? 'Reimbursed'+(e.method?' · '+METHODS[e.method]:'')+(e.reimbursedAt?' · '+fd(iso(new Date(e.reimbursedAt))):'') : '';
    const inner = sw(e.person)+'<span class="dt">'+fd(e.date).replace(/ \w+$/,"")+'</span><span class="tx"><b>'+esc(e.description)+'</b><span>'+esc([ppl.length>1||!mine?e.person:"", sub].filter(Boolean).join(" · "))+'</span></span><span><span class="hr num">'+gbp(e.amount)+'</span>'+(mine?'<span class="chev">'+(e.status==="unpaid"?"Edit":"Undo")+'</span>':'')+'</span>';
    return mine ? '<button class="ent" data-cost="'+esc(e.id)+'">'+inner+'</button>' : '<div class="ent">'+inner+'</div>';
  };
  let html = seg("cost", costWho);
  html += '<div class="sec">Totals</div><div class="card">'+ppl.map(p=>{
    const mine = state.expenses.filter(e=>e.person===p);
    return '<div class="mrow"><span>'+sw(p)+esc(p===me?"You":p)+'</span><span class="num">'+gbp(sum(mine.filter(e=>e.status==="unpaid").map(e=>e.amount)))+' unpaid · '+gbp(sum(mine.filter(e=>e.status==="reimbursed").map(e=>e.amount)))+' paid back</span></div>';
  }).join("")+'</div>';
  html += '<div class="sec">Unpaid<span class="num">'+gbp(sum(unpaid.map(e=>e.amount)))+'</span></div><div class="card">'+(unpaid.length?unpaid.map(row).join(""):'<div class="empty">Nothing unpaid.</div>')+'</div>';
  html += '<div class="sec">Reimbursed<span class="num">'+gbp(sum(paid.map(e=>e.amount)))+'</span></div><div class="card">'+(paid.length?paid.map(row).join(""):'<div class="empty">Nothing reimbursed yet.</div>')+'</div>';
  html += '<div class="links"><button type="button" class="link" id="costCsv">Download CSV</button></div>';
  if (!all && costWho!==me) html += '<p class="hint">Only '+esc(costWho)+' can change or mark their own costs.</p>';
  $("costBody").innerHTML = html;
}

/* ---------- navigation ---------- */
const RENDER = {rota:renderRota, hours:renderHours, history:renderHist, costs:renderCosts};
let stack = [];
function open(v){
  if (v==="rota") rotaOff = 0;
  if (v==="hours" && !hoursWho) hoursWho = me;
  if (v==="history" && !histWho) histWho = me;
  if (v==="costs"){ if (!costWho) costWho = me; resetCostForm(); }
  if (RENDER[v]) RENDER[v]();
  const el = $("v-"+v); el.classList.add("open"); el.scrollTop = 0; stack.push(v);
}
function back(){ const v = stack.pop(); if (v) $("v-"+v).classList.remove("open"); }
document.addEventListener("keydown", e=>{ if (e.key==="Escape" && stack.length && !document.querySelector("dialog[open]")) back(); });

/* ---------- log form ---------- */
const fDate=$("fDate"), fHours=$("fHours"), fNote=$("fNote");
let edit=null, cat="website", touched=false;
$("fCats").innerHTML = CATS.map(c=>'<button type="button" class="chip" data-cat="'+c.id+'" aria-pressed="false"><span class="sw" style="background:'+c.c+'"></span>'+esc(c.label)+'</button>').join("");
$("quick").innerHTML = [0.5,1,2,3,4].map(h=>'<button type="button" data-q="'+h+'">'+h+'h</button>').join("");
function setCat(c){ cat=c; document.querySelectorAll("#fCats .chip").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.cat===c))); if (c==="shift"&&!touched&&fDate.value) fHours.value=shiftPattern(fDate.value).hours; auto(); }
function auto(){
  if (cat!=="shift"||!fDate.value){ $("auto").textContent=""; return; }
  const p = shiftPattern(fDate.value);
  if (p.closed){ $("auto").textContent = "Closed on "+fd(fDate.value)+" – log it as other work instead."; return; }
  $("auto").innerHTML = 'Shift pattern: '+p.start+'–'+p.end+', '+p.hours+'h'+(Number(fHours.value)===p.hours?'':'. <button type="button" id="useAuto">Use '+p.hours+'h</button>');
}
function openLog(o){
  o = o||{}; edit = o.edit||null; touched = false;
  $("logTitle").textContent = o.title||"Log hours";
  fDate.value = o.date||tIso(); fNote.value = o.note||"";
  const isShift = !!(edit && edit.kind==="shift");
  fDate.disabled = isShift;
  $("fCats").parentElement.hidden = isShift;
  setCat(o.cat||"website");
  if (o.hours!=null){ fHours.value=o.hours; touched = (o.cat!=="shift") || o.hours!==shiftPattern(fDate.value).hours; }
  else fHours.value = (o.cat==="shift") ? shiftPattern(fDate.value).hours : "";
  auto();
  $("del").hidden = !edit; $("del").textContent = isShift ? "Remove me" : "Delete";
  $("save").textContent = edit ? "Save changes" : "Log hours";
  open("log");
}
function openShift(ds){
  const s = shiftOf(me, ds);
  openLog({title:"Your shift · "+fd(ds),edit:{kind:"shift",date:ds},cat:"shift",date:ds,hours:s.hours,note:s.note});
}
$("fCats").addEventListener("click",e=>{ const b=e.target.closest("[data-cat]"); if (b) setCat(b.dataset.cat); });
$("quick").addEventListener("click",e=>{ const b=e.target.closest("[data-q]"); if (b){ fHours.value=b.dataset.q; touched=true; auto(); } });
$("minus").onclick=()=>{ fHours.value=Math.max(0,(Number(fHours.value)||0)-0.5); touched=true; auto(); };
$("plus").onclick=()=>{ fHours.value=Math.min(24,(Number(fHours.value)||0)+0.5); touched=true; auto(); };
fHours.addEventListener("input",()=>{ touched=true; auto(); });
fDate.addEventListener("change",()=>{ if (cat==="shift"&&!touched) fHours.value=shiftPattern(fDate.value).hours; auto(); });
$("auto").addEventListener("click",e=>{ if (e.target.id==="useAuto"){ fHours.value=shiftPattern(fDate.value).hours; touched=false; auto(); } });
$("form").addEventListener("submit",e=>{
  e.preventDefault();
  if (!fDate.value){ toast("Pick a day"); return; }
  const raw = fHours.value.trim(), h = raw==="" ? null : Number(raw);
  if (h!=null && (!isFinite(h)||h<0||h>24)){ toast("Hours must be 0 to 24"); return; }
  if (cat!=="shift" && h==null){ toast("Add the hours"); fHours.focus(); return; }
  const date = fDate.value, note = fNote.value.trim().slice(0,500), calls = [];
  if (cat==="shift"){
    if (shiftPattern(date).closed){ toast("Closed that day – pick another type"); return; }
    const override = (h==null || h===shiftPattern(date).hours) ? null : h;
    if (!onDay(date).includes(me)){ state.rota.push({date,person:me}); calls.push(()=>api.addRota(date,me)); }
    state.shifts = state.shifts.filter(s=>!(s.person===me && s.date===date));
    if (override!=null || note) state.shifts.push({person:me,date,hours:override,note});
    calls.push(()=>api.saveShift({person:me,date,hours:override,note}));
    if (edit && edit.kind==="log"){ const id = edit.id; state.logs = state.logs.filter(l=>l.id!==id); calls.push(()=>api.deleteLog(id)); }
  } else {
    const id = edit && edit.kind==="log" ? edit.id : uid(), log = {id,person:me,date,cat,hours:h,note};
    state.logs = state.logs.filter(l=>l.id!==id).concat(log);
    calls.push(()=>api.saveLog(log));
  }
  save(...calls);
  back(); toast(edit?"Changes saved":"Hours logged");
});
$("del").onclick=()=>{
  if (!edit) return;
  if (edit.kind==="shift"){
    const date = edit.date;
    state.rota = state.rota.filter(r=>!(r.date===date && r.person===me));
    state.shifts = state.shifts.filter(s=>!(s.person===me && s.date===date));
    save(()=>api.removeRota(date,me), ()=>api.deleteShift(me,date)); toast("You’re off the rota for "+fd(date));
  } else {
    const id = edit.id;
    state.logs = state.logs.filter(l=>l.id!==id); save(()=>api.deleteLog(id)); toast("Deleted");
  }
  back();
};

/* ---------- day sheet ---------- */
let pickDay = null, closing = false;
const canClose = ds => ds>=tIso();   // only today and future days can be closed or reopened
function openPicker(ds){ pickDay = ds; closing = false; renderPicker(); if (!$("picker").open) $("picker").showModal(); }
function renderPicker(){
  const ds = pickDay, p = shiftPattern(ds), ppl = onDay(ds), ro = readOnlyDay(ds);
  $("pickTitle").textContent = fd(ds);
  $("pickSub").textContent = p.oneOff ? "Closed"+(p.reason?" – "+p.reason:"") : p.closed ? "Closed – no shift" : "Shift "+p.start+"–"+p.end+" ("+fmt(p.hours)+"h each)";
  const hrs = q => { const s = shiftOf(q,ds); return s.override!=null ? " · "+fmt(s.hours)+"h" : ""; };
  if (p.closed && !ppl.length){ $("pickBtns").innerHTML = ""; }
  else if (ro || p.closed){
    $("pickBtns").innerHTML = ppl.length ? ppl.map(q=>'<div class="ro">'+sw(q)+esc(q)+esc(hrs(q))+'</div>').join("") : '<div class="ro">Nobody was on</div>';
  } else {
    $("pickBtns").innerHTML = STAFF.map(q=>{ const on = ppl.includes(q);
      return '<button type="button" data-who="'+q+'" aria-pressed="'+on+'">'+sw(q)+esc(q)+esc(on?hrs(q):"")+(on?'<span class="tick" aria-hidden="true">✓</span>':'')+'</button>'; }).join("");
  }
  let more = ppl.includes(me) && !ro && !p.closed ? '<button type="button" class="textlink" data-shift="'+ds+'">Change my hours or add a note</button>' : "";
  if (canClose(ds) && p.oneOff) more += '<button type="button" class="textlink" data-reopen>Reopen this day</button>';
  else if (canClose(ds) && !p.closed){
    if (closing){
      const prev = $("closeReason") ? $("closeReason").value : "";
      more += '<form class="closebox" id="closeForm" novalidate><label class="lbl" for="closeReason">Why is it closed? (optional)</label>'+
        '<input type="text" id="closeReason" maxlength="200" autocomplete="off" placeholder="e.g. Bank holiday, private event" value="'+esc(prev)+'">'+
        (ppl.length ? '<p class="hint">This takes '+esc(ppl.join(" and "))+' off the rota for this day.</p>' : '')+
        '<div class="acts" style="margin-top:12px"><button type="button" class="danger" data-closecancel>Cancel</button><button type="submit" class="primary">Close this day</button></div></form>';
    } else more += '<button type="button" class="textlink" data-closeday>Close the wall this day</button>';
  }
  $("pickMore").innerHTML = more;
  $("pickHint").textContent = p.oneOff ? "Closed for this day only, so nobody can be put on."+(canClose(ds)?" Anyone can reopen it.":"")
    : p.closed ? "The wall is closed this day, so nobody can be put on." : ro ? "Past months are read-only." : "Tap a name to put them on or take them off. Everyone on gets the full shift hours.";
}
$("pickBtns").addEventListener("click",e=>{
  const b = e.target.closest("[data-who]"); if (!b||!pickDay) return;
  const ds = pickDay, who = b.dataset.who;
  if (shiftPattern(ds).closed || readOnlyDay(ds)) return;
  if (onDay(ds).includes(who)){
    state.rota = state.rota.filter(r=>!(r.date===ds && r.person===who));
    const calls = [()=>api.removeRota(ds,who)];
    if (who===me && state.shifts.some(s=>s.person===me && s.date===ds)){ state.shifts = state.shifts.filter(s=>!(s.person===me && s.date===ds)); calls.push(()=>api.deleteShift(me,ds)); }
    save(...calls); toast((who===me?"You’re":who+" is")+" off "+fd(ds));
  } else {
    state.rota.push({date:ds,person:who}); save(()=>api.addRota(ds,who)); toast((who===me?"You’re":who+" is")+" on "+fd(ds));
  }
});

$("pickMore").addEventListener("click",e=>{
  if (!pickDay) return;
  if (e.target.closest("[data-closeday]")){ closing = true; renderPicker(); $("closeReason").focus(); return; }
  if (e.target.closest("[data-closecancel]")){ closing = false; renderPicker(); return; }
  if (e.target.closest("[data-reopen]")){
    const ds = pickDay; if (!canClose(ds) || !closureOn(ds)) return;
    state.closures = state.closures.filter(c=>c.date!==ds); save(()=>api.reopenDay(ds)); toast(fd(ds)+" is open again");
  }
});
$("pickMore").addEventListener("submit",e=>{
  if (e.target.id!=="closeForm") return;
  e.preventDefault();
  const ds = pickDay; if (!ds || !canClose(ds) || shiftPattern(ds).closed) return;
  const reason = $("closeReason").value.trim().slice(0,200), ppl = onDay(ds), calls = [];
  ppl.forEach(q=>calls.push(()=>api.removeRota(ds,q)));
  state.rota = state.rota.filter(r=>r.date!==ds);
  if (state.shifts.some(s=>s.person===me && s.date===ds)){ state.shifts = state.shifts.filter(s=>!(s.person===me && s.date===ds)); calls.push(()=>api.deleteShift(me,ds)); }
  state.closures = (state.closures||[]).filter(c=>c.date!==ds).concat({date:ds,reason});
  calls.push(()=>api.closeDay(ds,reason));
  closing = false; save(...calls); toast(fd(ds)+" closed");
});

/* ---------- costs ---------- */
const cDate=$("cDate"), cAmt=$("cAmt"), cDesc=$("cDesc");
function resetCostForm(){ cDate.value = tIso(); cAmt.value = ""; cDesc.value = ""; }
function readAmount(s){ const n = Number(String(s).replace(/[£,\s]/g,"")); return isFinite(n) && n>0 && n<1e6 ? Math.round(n*100)/100 : null; }
$("costForm").addEventListener("submit",e=>{
  e.preventDefault();
  const amount = readAmount(cAmt.value), description = cDesc.value.trim().slice(0,300), date = cDate.value;
  if (!date){ toast("Pick a day"); return; }
  if (amount==null){ toast("Enter an amount, e.g. 12.50"); cAmt.focus(); return; }
  if (!description){ toast("Say what it was"); cDesc.focus(); return; }
  const x = {id:uid(),person:me,date,amount,description,status:"unpaid",reimbursedAt:null,method:null};
  state.expenses.push(x); save(()=>api.saveExpense(x));
  resetCostForm(); toast("Cost added – "+gbp(amount));
});
let costId = null;
function openCost(id){
  const x = state.expenses.find(e=>e.id===id); if (!x || x.person!==me) return;
  costId = id; const B = $("costSheetBody");
  if (x.status==="unpaid"){
    B.innerHTML = '<h3 tabindex="-1" autofocus>Your cost</h3><div class="sub">Unpaid. You can change it or mark it reimbursed.</div>'+
      '<div class="row2"><div class="field"><label class="lbl" for="eDate">Day</label><input type="date" id="eDate" value="'+esc(x.date)+'"></div>'+
      '<div class="field"><label class="lbl" for="eAmt">Amount</label><div class="money"><span>£</span><input type="text" id="eAmt" inputmode="decimal" autocomplete="off" value="'+esc(x.amount.toFixed(2))+'"></div></div></div>'+
      '<div class="field"><label class="lbl" for="eDesc">What was it?</label><input type="text" id="eDesc" maxlength="300" autocomplete="off" value="'+esc(x.description)+'"></div>'+
      '<div class="acts"><button type="button" class="danger" data-cact="delete">Delete</button><button type="button" class="primary" data-cact="save">Save changes</button></div>'+
      '<div class="sec">Mark reimbursed – how were you paid back?</div><div class="methods">'+Object.keys(METHODS).map(k=>'<button type="button" data-cact="paid" data-m="'+k+'">'+METHODS[k]+'</button>').join("")+'</div>'+
      '<button type="button" class="shut" data-close>Cancel</button>';
  } else {
    B.innerHTML = '<h3 tabindex="-1" autofocus>'+esc(x.description)+'</h3><div class="sub">'+gbp(x.amount)+' · '+fd(x.date)+'</div>'+
      '<div class="card"><div class="mrow"><span>Reimbursed</span><span>'+(x.reimbursedAt?fd(iso(new Date(x.reimbursedAt))):"")+'</span></div><div class="mrow"><span>How</span><span>'+esc(METHODS[x.method]||"")+'</span></div></div>'+
      '<div class="acts" style="margin-top:16px"><button type="button" class="primary" data-cact="undo">Undo – mark as unpaid</button></div>'+
      '<button type="button" class="shut" data-close>Close</button>';
  }
  $("costSheet").showModal();
}
$("costSheetBody").addEventListener("click",e=>{
  const b = e.target.closest("[data-cact]"); if (!b) return;
  const x = state.expenses.find(z=>z.id===costId); if (!x) return;
  const act = b.dataset.cact;
  if (act==="save"){
    const amount = readAmount($("eAmt").value), description = $("eDesc").value.trim().slice(0,300), date = $("eDate").value;
    if (!date || amount==null || !description){ toast(!date?"Pick a day":amount==null?"Enter an amount, e.g. 12.50":"Say what it was"); return; }
    Object.assign(x,{date,amount,description}); save(()=>api.saveExpense(x)); toast("Changes saved");
  } else if (act==="delete"){
    state.expenses = state.expenses.filter(z=>z.id!==x.id); save(()=>api.deleteExpense(x.id)); toast("Cost deleted");
  } else if (act==="paid"){
    const m = b.dataset.m; Object.assign(x,{status:"reimbursed",method:m,reimbursedAt:new Date().toISOString()});
    save(()=>api.setReimbursed(x.id,m)); toast("Marked reimbursed – "+METHODS[m].toLowerCase());
  } else if (act==="undo"){
    Object.assign(x,{status:"unpaid",method:null,reimbursedAt:null}); save(()=>api.setReimbursed(x.id,null)); toast("Marked as unpaid");
  }
  $("costSheet").close();
});

/* ---------- CSV ---------- */
const fileWho = sel => sel==="all" ? "everyone" : sel.toLowerCase();
function hoursCsv(){
  const rows = historyItems(whose(hoursWho)).reverse().map(i=>[i.date,i.person,(CAT[i.cat]||CAT.other).label,i.hours,i.note]);
  download("hangout-hours-"+fileWho(hoursWho)+"-"+tIso()+".csv", [["Date","Person","Type","Hours","Note"]].concat(rows));
}
function costCsv(){
  const rows = state.expenses.filter(e=>whose(costWho).includes(e.person)).sort((a,b)=>a.date.localeCompare(b.date))
    .map(e=>[e.date,e.person,e.amount.toFixed(2),e.description,e.status==="reimbursed"?"Reimbursed":"Unpaid",e.reimbursedAt?iso(new Date(e.reimbursedAt)):"",e.method?METHODS[e.method]:""]);
  download("hangout-costs-"+fileWho(costWho)+"-"+tIso()+".csv", [["Date","Person","Amount (GBP)","Description","Status","Reimbursed on","Method"]].concat(rows));
}

/* ---------- clicks ---------- */
document.addEventListener("click",e=>{
  if (!me) return;
  const cl = e.target.closest("[data-close]"); if (cl){ cl.closest("dialog").close(); return; }
  const o = e.target.closest("[data-open]"); if (o){ o.dataset.open==="log" ? openLog() : open(o.dataset.open); return; }
  if (e.target.closest("[data-back]")){ back(); return; }
  const sg = e.target.closest("[data-seg]");
  if (sg){ const v = sg.dataset.v, w = sg.dataset.seg;
    if (w==="hours"){ hoursWho = v; renderHours(); } else if (w==="hist"){ histWho = v; renderHist(); } else { costWho = v; renderCosts(); } return; }
  const rp = e.target.closest("[data-rp]"); if (rp){ rotaOff = Math.min(0, rotaOff+Number(rp.dataset.rp)); renderRota(); return; }
  if (e.target.closest("#hoursCsv")){ hoursCsv(); return; }
  if (e.target.closest("#costCsv")){ costCsv(); return; }
  if (e.target.closest("#exportAll")){ toast("Preparing 6 CSV files…"); exportAll().catch(()=>toast("Export failed – are you online?")); return; }
  const dy = e.target.closest("[data-day]"); if (dy){ openPicker(dy.dataset.day); return; }
  const sb = e.target.closest("[data-shift]"); if (sb){ if ($("picker").open) $("picker").close(); if (onDay(sb.dataset.shift).includes(me)) openShift(sb.dataset.shift); return; }
  const lb = e.target.closest("[data-log]"); if (lb){ const l=state.logs.find(x=>x.id===lb.dataset.log && x.person===me); if (l) openLog({title:"Edit hours",edit:{kind:"log",id:l.id},cat:l.cat,date:l.date,hours:l.hours,note:l.note}); return; }
  const cb = e.target.closest("[data-cost]"); if (cb){ openCost(cb.dataset.cost); return; }
});
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("click",e=>{ if (e.target===d) d.close(); }));

let tt; function toast(t){ const el=$("toast"); el.textContent=t; el.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>el.classList.remove("show"),2200); }

/* ---------- sign in (once per device; no switching) ---------- */
let pickName = null;
function showLogin(msg){
  $("login").hidden = false; $("home").hidden = true;
  stack.forEach(v=>$("v-"+v).classList.remove("open")); stack = [];
  $("loginMsg").textContent = msg || "";
  $("names").innerHTML = STAFF.map(n=>'<button type="button" data-name="'+n+'" aria-pressed="false">'+sw(n)+n+'</button>').join("");
  $("pinWrap").hidden = true; pickName = null;
}
$("names").addEventListener("click",e=>{
  const b = e.target.closest("[data-name]"); if (!b) return;
  pickName = b.dataset.name;
  document.querySelectorAll("#names button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
  $("pinWrap").hidden = false; $("pin").value = ""; $("pin").focus();
  $("go").textContent = "I’m "+pickName;
});
$("loginForm").addEventListener("submit",e=>{
  e.preventDefault();
  const pin = $("pin").value.trim(); if (!pickName || !pin) return;
  $("go").disabled = true; $("loginMsg").textContent = "Checking…";
  api.signIn(pickName, pin).then(name=>{
    if (!name) throw new Error("No profile");
    me = name; store.set(ME_KEY, me);
    $("login").hidden = true; $("home").hidden = false; render(); load();
  }).catch(err=>{
    $("loginMsg").textContent = err && err.message==="AUTH" ? "That PIN doesn’t match. Ask Ross if you’ve forgotten it." : "Couldn’t connect. Try again.";
  }).finally(()=>{ $("go").disabled = false; });
});

/* ---------- start ---------- */
async function boot(){
  if (!api.configured){ showLogin(); $("loginForm").hidden = true; $("loginMsg").textContent = "The app isn’t connected to its database yet."; return; }
  if (!me){
    const name = await api.whoAmI().catch(()=>null);
    if (name){ me = name; store.set(ME_KEY, me); }
  }
  if (me){
    const c = store.get(CACHE); if (c) state = Object.assign({closures:[]}, c);
    $("home").hidden = false; render(); load();
  } else showLogin();
}
boot();
setInterval(()=>{ if (me) render(); }, 60000);
document.addEventListener("visibilitychange",()=>{ if (me && document.visibilityState==="visible") load(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
