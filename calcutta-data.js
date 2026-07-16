/* ============================================================================
   Hillwood CC · 2026 Open Championship Calcutta — shared auction data + payout
   logic. Single source of truth for index/team/market/stats. Pure data + pure
   helpers only: nothing here touches the DOM or live-fetch state. Each page
   supplies its own scoreFn / isCutFn / score36Fn (built from its own live ESPN
   pull) to computeAllPayouts.
   ========================================================================== */

// Canonical roster key. Lowercase, strip diacritics (é→e, ñ→n) via NFD, map the
// Scandinavian/Germanic code points NFD leaves intact (ø→o, æ→ae, ß→ss…), then
// drop everything non-alphanumeric.
function nameKey(n){
  return (n||'')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g,'')
    .replace(/ø/g,'o')
    .replace(/æ/g,'ae')
    .replace(/œ/g,'oe')
    .replace(/ð/g,'d')
    .replace(/þ/g,'th')
    .replace(/ß/g,'ss')
    .replace(/đ/g,'d')
    .replace(/[^a-z0-9]/g,'');
}

// ESPN occasionally publishes a player under a shortened name; map ESPN key -> roster key.
const nameAliases = {
  'mattmccarty': 'mattmccarty',
  'nicoechavarria': 'nicoechavarria',
};

// --- Tournament constants ----------------------------------------------------
const POT = 56300; // sum of all 40 winning bids
// Position prize percentages, 1st → 12th. Five further props (below) pay outside
// the finishing order. Base order (90%) + 5 props × 2% (10%) = 100% of the pot.
const POSITION_PCT = [0.19,0.14,0.11,0.09,0.07,0.06,0.06,0.05,0.04,0.04,0.03,0.02];
// Back-compat alias: older page code referenced PAYOUTS for the position table.
const PAYOUTS = POSITION_PCT;

// Royal Birkdale Golf Club — 2026 Open Championship setup. Par 70 (34/36).
const PARS = [4,4,4,3,4,4,3,4,4, 4,4,3,4,3,5,4,5,4];
const FRONT_PAR = PARS.slice(0,9).reduce((a,b)=>a+b,0);
const BACK_PAR  = PARS.slice(9).reduce((a,b)=>a+b,0);
const TOTAL_PAR = FRONT_PAR + BACK_PAR;

// --- Syndicates --------------------------------------------------------------
const synSpend   = { Nerds:12750, JD:8450, Robbie:5900, Wolfpack:9600, Beaver:9000, Philoogle:10600 };
const synClass   = { Nerds:'sp-n', JD:'sp-jd', Robbie:'sp-ro', Wolfpack:'sp-wdc', Beaver:'sp-bv', Philoogle:'sp-ph' };
const SYN_DISPLAY = { Nerds:'Nerds', JD:'JD', Robbie:'Robbie', Wolfpack:'Wolfpack', Beaver:'Beaver', Philoogle:'Philoogle' };
function synDisplay(s){ return SYN_DISPLAY[s] || s; }

// --- The 40 groups -----------------------------------------------------------
const allGroups = [
  {num:1, leader:"Scottie Scheffler", partners:["Casey Jarvis","Lucas Herbert"], syndicate:"Philoogle", bid:3200},
  {num:2, leader:"Rory McIlroy", partners:["Andrew Novak","Michael Brennan"], syndicate:"JD", bid:3600},
  {num:3, leader:"Matt Fitzpatrick", partners:["Daniel Berger","Thomas Detry"], syndicate:"Robbie", bid:3400},
  {num:4, leader:"Tommy Fleetwood", partners:["Sahith Theegala","Max Greyserman"], syndicate:"Nerds", bid:3500},
  {num:5, leader:"Jon Rahm", partners:["Matt Wallace","Louis Oosthuizen","Joe Dean"], syndicate:"Robbie", bid:2500},
  {num:6, leader:"Xander Schauffele", partners:["Keith Mitchell","Michael Kim","Austen Truslow"], syndicate:"Nerds", bid:2700},
  {num:7, leader:"Collin Morikawa", partners:["Eric Cole","Matt McCarty","Tom Sloman"], syndicate:"Wolfpack", bid:1700},
  {num:8, leader:"Chris Gotterup", partners:["Ryo Hisatsune","Billy Horschel","Baard Bjoernevik Skogen"], syndicate:"Wolfpack", bid:1850},
  {num:9, leader:"Wyndham Clark", partners:["J.T. Poston","Jackson Suber","Nevill Ruiter"], syndicate:"Philoogle", bid:2000},
  {num:10, leader:"Cameron Young", partners:["Tom McKibbin","Matthew Jordan","Marcus Plunkett"], syndicate:"Wolfpack", bid:1400},
  {num:11, leader:"Justin Rose", partners:["Sungjae Im","Pierceson Coody","James Nicholas"], syndicate:"Philoogle", bid:2300},
  {num:12, leader:"Robert MacIntyre", partners:["Harry Hall","John Parry","Jack McDonald"], syndicate:"JD", bid:2300},
  {num:13, leader:"Ludvig Aberg", partners:["Jayden Schaper","Keita Nakajima","David Howard"], syndicate:"Beaver", bid:1200},
  {num:14, leader:"Tyrrell Hatton", partners:["Rasmus Neergaard-Petersen","Daniel Brown","Alejandro De Castro Piera"], syndicate:"Nerds", bid:1300},
  {num:15, leader:"Viktor Hovland", partners:["Gary Woodland","Daniel Hillier","M.J. Daffue"], syndicate:"Nerds", bid:1650},
  {num:16, leader:"Russell Henley", partners:["Alex Smalley","Bernd Wiesberger","Tiger Christensen"], syndicate:"Philoogle", bid:1100},
  {num:17, leader:"Sam Burns", partners:["Keegan Bradley","Hennie du Plessis","Matthew Baldwin"], syndicate:"Beaver", bid:1700},
  {num:18, leader:"Bryson DeChambeau", partners:["Haotong Li","Nick Taylor","Ren Yonezawa"], syndicate:"Beaver", bid:2100},
  {num:19, leader:"Tom Kim", partners:["Max Homa","Scott Vincent","Ryutaro Nagano"], syndicate:"Wolfpack", bid:1100},
  {num:20, leader:"Patrick Reed", partners:["Johnny Keefer","Michael Hollick","Jiho Yang"], syndicate:"JD", bid:950},
  {num:21, leader:"Shane Lowry", partners:["Bud Cauley","Jesper Svensson","Naoyuki Kataoka"], syndicate:"Philoogle", bid:1150},
  {num:22, leader:"Justin Thomas", partners:["Ryan Fox","Sam Stevens","Cameron John"], syndicate:"Beaver", bid:1000},
  {num:23, leader:"Si Woo Kim", partners:["Rasmus Hojgaard","Laurie Canter","Jeong Woo Ham"], syndicate:"Nerds", bid:900},
  {num:24, leader:"Brooks Koepka", partners:["Angel Ayora","Francesco Laporta","Alistair Docherty"], syndicate:"Beaver", bid:800},
  {num:25, leader:"Joaquin Niemann", partners:["Jordan Smith","Peter Uihlein","Lev Grinberg"], syndicate:"JD", bid:550},
  {num:26, leader:"Jordan Spieth", partners:["Jake Knapp","Nico Echavarria","Tim Wiedemeyer"], syndicate:"Wolfpack", bid:1000},
  {num:27, leader:"Aaron Rai", partners:["Ryan Gerard","Sami Valimaki","Stuart Grehan"], syndicate:"Wolfpack", bid:650},
  {num:28, leader:"Min Woo Lee", partners:["Jacob Bridgeman","Francesco Molinari","Jack Buchanan"], syndicate:"Wolfpack", bid:800},
  {num:29, leader:"Alex Fitzpatrick", partners:["David Puig","Padraig Harrington","Mateo Pulcini"], syndicate:"JD", bid:600},
  {num:30, leader:"Patrick Cantlay", partners:["Victor Perez","Adrien Saddier","Fifa Laopakdee"], syndicate:"Wolfpack", bid:600},
  {num:31, leader:"Brian Harman", partners:["Eugenio Chacarra","Joakim Lagergren","Mason Howell"], syndicate:"Philoogle", bid:850},
  {num:32, leader:"Cameron Smith", partners:["Marco Penge","Andy Sullivan","Travis Smyth"], syndicate:"Wolfpack", bid:500},
  {num:33, leader:"Harris English", partners:["Jason Day","Kota Kaneko","Kazuki Higa"], syndicate:"Nerds", bid:700},
  {num:34, leader:"Corey Conners", partners:["Alex Noren","Frederic Lacroix","Dan Bradbury"], syndicate:"JD", bid:450},
  {num:35, leader:"J.J. Spaun", partners:["Sepp Straka","Shaun Norris","Martin Couvra"], syndicate:"Beaver", bid:800},
  {num:36, leader:"Ben Griffin", partners:["Michael Thorbjornsen","Sam Bairstow","David Duval"], syndicate:"Nerds", bid:500},
  {num:37, leader:"Hideki Matsuyama", partners:["Adam Scott","Jose Luis Ballester","Stewart Cink"], syndicate:"Nerds", bid:1100},
  {num:38, leader:"Kristoffer Reitan", partners:["Rickie Fowler","Kazuma Kobori","Darren Clarke"], syndicate:"Beaver", bid:600},
  {num:39, leader:"Akshay Bhatia", partners:["Maverick McNealy","Antoine Rozner","Henrik Stenson"], syndicate:"Beaver", bid:800},
  {num:40, leader:"Nicolai Hojgaard", partners:["Kurt Kitayama","Matthew Southgate","Caleb Surratt"], syndicate:"Nerds", bid:400},
];

// --- Special prize eligibility (color-coded in the auction sheet) ------------
// Blue font  → Low Lefty (left-handed players)
const LEFTIES = new Set([
  'Robert MacIntyre','Brian Harman','Akshay Bhatia','Matt McCarty',
].map(nameKey));
// Green font → Low Asian
const ASIANS = new Set([
  'Ryo Hisatsune','Sungjae Im','Keita Nakajima','Haotong Li','Ren Yonezawa',
  'Tom Kim','Ryutaro Nagano','Jiho Yang','Naoyuki Kataoka','Si Woo Kim',
  'Jeong Woo Ham','Fifa Laopakdee','Kota Kaneko','Kazuki Higa','Hideki Matsuyama',
].map(nameKey));
// Orange fill → Low Former Champion (past Open champions in the field)
const FORMER_CHAMPS = new Set([
  'Scottie Scheffler','Rory McIlroy','Louis Oosthuizen','Xander Schauffele',
  'Collin Morikawa','Shane Lowry','Jordan Spieth','Francesco Molinari',
  'Cameron Smith','Brian Harman','Padraig Harrington','David Duval',
  'Stewart Cink','Darren Clarke','Henrik Stenson',
].map(nameKey));
// Red font → Low Hump Belly (45+). Explicit list on the auction sheet.
const HUMP_BELLIES = new Set([
  'Justin Rose','Padraig Harrington','David Duval','Adam Scott',
  'Stewart Cink','Darren Clarke','Henrik Stenson',
].map(nameKey));

function isLefty(n){ return LEFTIES.has(nameKey(n)); }
function isAsian(n){ return ASIANS.has(nameKey(n)); }
function isFormerChamp(n){ return FORMER_CHAMPS.has(nameKey(n)); }
function isHumpBelly(n){ return HUMP_BELLIES.has(nameKey(n)); }

// Each prop pays a flat 2% of the pot. Four are eligibility-set based (paid to
// the lowest eligible golfer who makes the cut); one is computed (the lowest
// score through 36 holes). Per the sheet: "For prop bets to pay, best finisher
// must make the cut. Funds go to 1st if not." So a dead prop's 2% rolls to 1st.
const SPECIALS = [
  { key:'h36',   label:'Low 36-Hole Leader',  pct:0.02, kind:'compute' },
  { key:'lefty', label:'Low Lefty',           pct:0.02, set:LEFTIES },
  { key:'asian', label:'Low Asian',           pct:0.02, set:ASIANS },
  { key:'champ', label:'Low Former Champion', pct:0.02, set:FORMER_CHAMPS },
  { key:'hump',  label:'Low Hump Belly (45+)',pct:0.02, set:HUMP_BELLIES },
];

// --- Payout engine -----------------------------------------------------------
function _rosterNames(){
  const out=[];
  allGroups.forEach(g=>{ out.push(g.leader); g.partners.forEach(p=>out.push(p)); });
  return out;
}

// A set-based prop is "live" while at least one eligible golfer is still in (not
// cut). Pre-cut everyone's live; once the cut falls, a prop whose entire eligible
// set missed it goes dead and its 2% rolls to 1st place.
function catLive(set, isCutFn){
  return _rosterNames().some(n => set.has(nameKey(n)) && !isCutFn(n));
}

// Position percentages after rolling any dead prop's 2% into 1st place.
function effectivePct(isCutFn){
  const pct = POSITION_PCT.slice();
  let toFirst = 0;
  SPECIALS.forEach(sp=>{
    if(sp.kind === 'compute') return;      // 36-hole leader never redistributes
    if(!catLive(sp.set, isCutFn)) toFirst += sp.pct;
  });
  pct[0] += toFirst;
  return pct;
}

// Lowest-scoring golfers under scoreFn, optionally restricted to a set; ties share.
function lowOf(scoreFn, set){
  let best=null, names=[];
  _rosterNames().forEach(n=>{
    if(set && !set.has(nameKey(n))) return;
    const s=scoreFn(n);
    if(s===null||s===undefined) return;
    if(best===null||s<best){ best=s; names=[n]; }
    else if(s===best){ names.push(n); }
  });
  return {names, score:best};
}

// PGA-style tie handling: golfers tied at position P split the combined money of
// positions P..P+N-1 equally. sortedScores ascending, nulls treated as no-pay.
function tiePayouts(sortedScores, pct){
  pct = pct || POSITION_PCT;
  const out = new Array(sortedScores.length).fill(0);
  let i = 0;
  while(i < sortedScores.length){
    const s = sortedScores[i];
    if(s === null || s === undefined){ i++; continue; }
    let j = i;
    while(j < sortedScores.length && sortedScores[j] === s) j++;
    let p = 0;
    for(let k=i;k<j;k++) if(k<pct.length) p += pct[k];
    const each = Math.round(POT * p / (j - i));
    for(let k=i;k<j;k++) out[k] = each;
    i = j;
  }
  return out;
}

// One call does it all. Returns:
//   all        — individuals sorted by score (for ranking/pips)
//   payByName  — name -> total projected $ (position prize + any props won)
//   synPayouts — syndicate -> total projected $
//   specials   — per-prop {label,pct,live,names,score,each}
// scoreFn(name) -> to-par number or null; isCutFn(name) -> bool;
// score36Fn(name) -> 36-hole to-par or null (optional, drives the 36-hole prop).
function computeAllPayouts(scoreFn, isCutFn, score36Fn){
  const all=[];
  allGroups.forEach(g=>{
    [g.leader, ...g.partners].forEach(n => all.push({ name:n, syndicate:g.syndicate, score:scoreFn(n) }));
  });
  all.sort((a,b)=>{
    const an = a.score===null||a.score===undefined, bn = b.score===null||b.score===undefined;
    if(!an && !bn) return a.score - b.score;
    if(!an) return -1;
    if(!bn) return 1;
    return 0;
  });
  const pct = effectivePct(isCutFn);
  const pays = tiePayouts(all.map(p=>p.score), pct);
  const payByName = {};
  all.forEach((p,i)=>{ payByName[p.name] = (payByName[p.name]||0) + pays[i]; });

  const specials = {};
  SPECIALS.forEach(sp=>{
    let live, low;
    if(sp.kind === 'compute'){
      // 36-hole leader: lowest score through 36 holes across the whole field.
      live = true;
      low = score36Fn ? lowOf(score36Fn) : {names:[], score:null};
    } else {
      live = catLive(sp.set, isCutFn);
      low = live ? lowOf(scoreFn, sp.set) : {names:[], score:null};
    }
    let each = 0;
    if(low.score !== null){
      each = Math.round(POT * sp.pct / low.names.length);
      low.names.forEach(n => payByName[n] = (payByName[n]||0) + each);
    }
    specials[sp.key] = { label:sp.label, pct:sp.pct, live, names:low.names, score:low.score, each };
  });

  const synPayouts = {};
  Object.keys(synSpend).forEach(s => synPayouts[s] = 0);
  allGroups.forEach(g=>{ [g.leader, ...g.partners].forEach(n => synPayouts[g.syndicate] += (payByName[n]||0)); });

  return { all, payByName, specials, synPayouts, pct };
}
