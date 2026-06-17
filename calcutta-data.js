/* ============================================================================
   Hillwood CC · 2026 U.S. Open Calcutta — shared auction data + payout logic.
   Single source of truth for index/team/market/stats. Pure data + pure helpers
   only: nothing here touches the DOM or live-fetch state. Each page supplies its
   own scoreFn / isCutFn (built from its own live ESPN pull) to computeAllPayouts.
   ========================================================================== */

// Canonical roster key. Lowercase, strip diacritics (é→e, ñ→n) via NFD, map the
// Scandinavian/Germanic code points NFD leaves intact (ø→o, æ→ae, ß→ss…), then
// drop everything non-alphanumeric. So ESPN's "Nicolai Højgaard" / "Adrien Dumont
// de Chassart" collide with the auction's plainer spellings.
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
  'mattmccarty': 'matthewmccarty',
  'nicoechavarria': 'nicolasechavarria',
};

// --- Tournament constants ----------------------------------------------------
const POT = 62950; // sum of all 40 winning bids
// Position prize percentages, 1st → 11th. Three further categories (below) pay
// outside the finishing order. Base order + specials = 100% of the pot.
const POSITION_PCT = [0.20,0.15,0.12,0.10,0.08,0.07,0.06,0.05,0.04,0.03,0.02];
// Back-compat alias: older page code referenced PAYOUTS for the position table.
const PAYOUTS = POSITION_PCT;

// Shinnecock Hills Golf Club — 2026 U.S. Open setup. Par 70 (35/35).
const PARS = [4,3,4,4,5,4,3,4,4, 4,3,4,4,4,4,5,3,4];
const FRONT_PAR = PARS.slice(0,9).reduce((a,b)=>a+b,0);
const BACK_PAR  = PARS.slice(9).reduce((a,b)=>a+b,0);
const TOTAL_PAR = FRONT_PAR + BACK_PAR;

// --- Syndicates --------------------------------------------------------------
// Keys are stable for data lookups; SYN_DISPLAY is what the user sees.
const synSpend   = { Robbie:14750, Nerds:11100, Phil:11000, JD:10400, WolfPack:9500, Virgins:6200 };
const synClass   = { Robbie:'sp-ro', Nerds:'sp-n', Phil:'sp-ph', JD:'sp-jd', WolfPack:'sp-wdc', Virgins:'sp-bv' };
const SYN_DISPLAY = { Robbie:'Robbie', Nerds:'Nerds', Phil:'Philoogle', JD:'JD', WolfPack:'Wolf Pack', Virgins:'Virgins' };
function synDisplay(s){ return SYN_DISPLAY[s] || s; }

// --- The 40 groups -----------------------------------------------------------
// leader = headliner; partners = the rest of the drafted group. syndicate owns
// the whole group; bid is the winning auction price.
const allGroups = [
  {num:1, leader:"Scottie Scheffler", partners:["Matthew McCarty","Andrew Putnam"], syndicate:"JD", bid:4000},
  {num:2, leader:"Rory McIlroy", partners:["Max Greyserman","John Keefer"], syndicate:"JD", bid:3400},
  {num:3, leader:"Jon Rahm", partners:["Michael Kim","Michael Brennan"], syndicate:"JD", bid:3000},
  {num:4, leader:"Xander Schauffele", partners:["Andrew Novak","Miles Russell"], syndicate:"WolfPack", bid:3300},
  {num:5, leader:"Cameron Young", partners:["Benjamin James","William Mouw","Carl Yuan"], syndicate:"WolfPack", bid:2200},
  {num:6, leader:"Matt Fitzpatrick", partners:["Davis Thompson","Preston Stout","Nick Hardy"], syndicate:"Nerds", bid:2700},
  {num:7, leader:"Tommy Fleetwood", partners:["Lucas Herbert","Patrick Rodgers","Ethan Fang"], syndicate:"Nerds", bid:2300},
  {num:8, leader:"Ludvig Aberg", partners:["Jayden Trey Schaper","Adrien Dumont De Chassart","Arni Sveinsson"], syndicate:"Robbie", bid:2200},
  {num:9, leader:"Bryson DeChambeau", partners:["Sam Stevens","Nicolas Echavarria","Mason Howell"], syndicate:"Phil", bid:1000},
  {num:10, leader:"Brooks Koepka", partners:["Carlos Ortiz","Matthias Schmid","Graeme McDowell"], syndicate:"Phil", bid:900},
  {num:11, leader:"Collin Morikawa", partners:["Sungjae Im","Max McGreevy","Taihei Sato"], syndicate:"Phil", bid:1800},
  {num:12, leader:"Russell Henley", partners:["Jackson Suber","Chris Kirk","Eric Lee"], syndicate:"Nerds", bid:1900},
  {num:13, leader:"Wyndham Clark", partners:["Brian Harman","Emiliano Grillo","James Nicholas"], syndicate:"Nerds", bid:1200},
  {num:14, leader:"Sam Burns", partners:["Ryo Hisatsune","John Parry","Ryder Cowan"], syndicate:"Phil", bid:1600},
  {num:15, leader:"Si Woo Kim", partners:["Nick Taylor","Billy Horschel","Jackson Herrington"], syndicate:"Virgins", bid:1150},
  {num:16, leader:"Chris Gotterup", partners:["Pierceson Coody","Ben Kohles","Greyson Leach"], syndicate:"WolfPack", bid:1200},
  {num:17, leader:"Justin Thomas", partners:["Tom Kim","Nathan Kimsey","Harry Higgs"], syndicate:"WolfPack", bid:1600},
  {num:18, leader:"Tyrrell Hatton", partners:["Hennie Du Plessis","Neal Shipley","Jackson Ormond"], syndicate:"Phil", bid:1500},
  {num:19, leader:"Patrick Cantlay", partners:["Daniel Berger","Chandler Phillips","Logan Reilly"], syndicate:"Virgins", bid:1300},
  {num:20, leader:"Patrick Reed", partners:["Corey Conners","Cooper Dossey","Bryan Lee"], syndicate:"Robbie", bid:1500},
  {num:21, leader:"Justin Rose", partners:["Cameron Smith","Rocco Repetto Taylor","Filippo Celli"], syndicate:"Robbie", bid:1800},
  {num:22, leader:"Viktor Hovland", partners:["Dustin Johnson","Laurie Canter","Angel Hidalgo"], syndicate:"Robbie", bid:1400},
  {num:23, leader:"J.J. Spaun", partners:["Sahith Theegala","Adrien Saddier","Kaito Onishi"], syndicate:"Robbie", bid:1600},
  {num:24, leader:"Hideki Matsuyama", partners:["Harry Hall","Kevin Roy","Mateo Pulcini"], syndicate:"Phil", bid:1400},
  {num:25, leader:"Robert MacIntyre", partners:["Ryan Fox","Ugo Coussaud","Chase Kyes"], syndicate:"Nerds", bid:1900},
  {num:26, leader:"Jordan Spieth", partners:["Akshay Bhatia","Jimmy Stanger","J.B. Holmes"], syndicate:"Robbie", bid:1350},
  {num:27, leader:"Joaquin Niemann", partners:["Keith Mitchell","T.K. Kim","Jackson Van Paris"], syndicate:"Phil", bid:850},
  {num:28, leader:"Min Woo Lee", partners:["Keegan Bradley","Matthew Jordan","Jake Peacock"], syndicate:"Nerds", bid:1100},
  {num:29, leader:"Ben Griffin", partners:["Alexander Noren","Caleb Surratt","Marcelo Rozo"], syndicate:"Virgins", bid:850},
  {num:30, leader:"Maverick McNealy", partners:["Jackson Koivun","Zac Blair","Spencer Tibbits"], syndicate:"WolfPack", bid:1200},
  {num:31, leader:"Adam Scott", partners:["Gary Woodland","Cole Hammer","Hamilton Coleman"], syndicate:"Phil", bid:1100},
  {num:32, leader:"Kurt Kitayama", partners:["Jacob Bridgeman","Alejandro Tosti","Brandon Holtz"], syndicate:"Robbie", bid:900},
  {num:33, leader:"Shane Lowry", partners:["Nicolai Hojgaard","Giuseppe Puebla","Ryuichi Oiwa"], syndicate:"Robbie", bid:900},
  {num:34, leader:"Harris English", partners:["Jason Day","Padraig Harrington","Manav Shah"], syndicate:"Virgins", bid:950},
  {num:35, leader:"Jake Knapp", partners:["Sudarshan Yellamaraju","Dylan Wu","Brandon Wu"], syndicate:"Virgins", bid:1000},
  {num:36, leader:"Bud Cauley", partners:["Ryan Gerard","Niklas Norgaard Moller","Jake Sollon"], syndicate:"Phil", bid:850},
  {num:37, leader:"David Puig", partners:["Rickie Fowler","Taylor Montgomery","Marek Fleming"], syndicate:"Robbie", bid:900},
  {num:38, leader:"Sepp Straka", partners:["Alex Fitzpatrick","Ben Silverman","Robbie Higgins"], syndicate:"Virgins", bid:950},
  {num:39, leader:"Alex Smalley", partners:["Kristoffer Reitan","Matthew Robles","Vaughn Harber"], syndicate:"Robbie", bid:1100},
  {num:40, leader:"Aaron Rai", partners:["J.T. Poston","Peter Uihlein","Jack Schoenberger"], syndicate:"Robbie", bid:1100},
];

// --- Special prize eligibility (color-coded in the auction sheet) ------------
// Green font  → Low Islander  (island-nation players: Australia / NZ / Japan)
const ISLANDERS = new Set([
  'Lucas Herbert','Taihei Sato','Ryo Hisatsune','Cameron Smith','Kaito Onishi',
  'Hideki Matsuyama','Ryan Fox','Min Woo Lee','Adam Scott','Ryuichi Oiwa','Jason Day',
].map(nameKey));
// Blue font   → Low Englishman
const ENGLISH = new Set([
  'Matt Fitzpatrick','Tommy Fleetwood','Tyrrell Hatton','Justin Rose','John Parry',
  'Nathan Kimsey','Laurie Canter','Harry Hall','Matthew Jordan','Alex Fitzpatrick','Aaron Rai',
].map(nameKey));
// Red font    → Low Amateur (must make the cut)
const AMATEURS = new Set([
  'Miles Russell','Preston Stout','Ethan Fang','Arni Sveinsson','Mason Howell',
  'Eric Lee','Ryder Cowan','Jackson Herrington','Jackson Ormond','Logan Reilly',
  'Bryan Lee','Jackson Koivun','Mateo Pulcini','Chase Kyes','Hamilton Coleman',
  'Brandon Holtz','Giuseppe Puebla','Marek Fleming','Matthew Robles','Vaughn Harber',
].map(nameKey));

function isIslander(n){ return ISLANDERS.has(nameKey(n)); }
function isEnglish(n){ return ENGLISH.has(nameKey(n)); }
function isAmateur(n){ return AMATEURS.has(nameKey(n)); }

// Each special pays a flat % of the pot to the lowest eligible golfer who makes
// the cut. If the category produces no made-cut finisher, its money rolls into
// the listed finishing places (+1% each), per the auction sheet's footnotes.
const SPECIALS = [
  { key:'eng', label:'Low Englishman', pct:0.03, set:ENGLISH,   bump:[0,1,2] }, // → 1st/2nd/3rd
  { key:'isl', label:'Low Islander',   pct:0.03, set:ISLANDERS, bump:[4,5,6] }, // → 5th/6th/7th
  { key:'am',  label:'Low Amateur',    pct:0.02, set:AMATEURS,  bump:[9,10] },  // → 10th/11th
];

// --- Payout engine -----------------------------------------------------------
function _rosterNames(){
  const out=[];
  allGroups.forEach(g=>{ out.push(g.leader); g.partners.forEach(p=>out.push(p)); });
  return out;
}

// A category is "live" while at least one eligible golfer is still in (not cut).
// Pre-cut nobody is cut, so every category is live; once the cut falls, a
// category whose entire eligible set missed it goes dead and redistributes.
function catLive(set, isCutFn){
  return _rosterNames().some(n => set.has(nameKey(n)) && !isCutFn(n));
}

// Position percentages after folding in any dead special's redistribution.
function effectivePct(isCutFn){
  const pct = POSITION_PCT.slice();
  SPECIALS.forEach(sp=>{ if(!catLive(sp.set,isCutFn)) sp.bump.forEach(i=>{ if(i<pct.length) pct[i]+=0.01; }); });
  return pct;
}

// Lowest-scoring eligible (scored, non-cut) golfers in a category; ties share.
function lowOfCategory(set, scoreFn){
  let best=null, names=[];
  _rosterNames().forEach(n=>{
    if(!set.has(nameKey(n))) return;
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
//   payByName  — name -> total projected $ (position prize + any specials won)
//   synPayouts — syndicate -> total projected $
//   specials   — per-category {label,pct,live,names,score,each}
// scoreFn(name) must return a to-par number or null; isCutFn(name) -> bool.
function computeAllPayouts(scoreFn, isCutFn){
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
    const live = catLive(sp.set, isCutFn);
    const low = live ? lowOfCategory(sp.set, scoreFn) : {names:[], score:null};
    let each = 0;
    if(live && low.score !== null){
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
