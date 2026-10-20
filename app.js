/* SMASH LIVE — appli téléphone (GitHub Pages)
   Données : Google Sheet via le script Apps Script (config.js → apiUrl). */
'use strict';
const APP_VERSION = '1.1';
const CFG = window.SMASH_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('smash:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('smash:' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem('smash:' + k); } catch (e) { /* idem */ } }
};
const TYPES = ['Simple 1', 'Simple 2', 'Simple 3', 'Simple 4', 'Double 1', 'Double 2'];
const RANKS = ['-30', '-15', '-4/6', '-2/6', '0', '1/6', '2/6', '3/6', '4/6', '5/6', '15', '15/1', '15/2', '15/3', '15/4', '15/5', '30', '30/1', '30/2', '30/3', '30/4', '30/5', '40', 'NC'];
const rv = c => { const i = RANKS.indexOf(c); return i < 0 ? 99 : i; };
const US = 'us';
const ERR = {
  INTERDIT: 'Action réservée.', OCCUPE: 'Serveur occupé, réessaie dans un instant.', NOM_OBLIGATOIRE: 'Le nom est obligatoire.',
  CODE_FAUX: 'Code incorrect.', TROP_ESSAIS: "Trop d'essais : réessaie dans 15 minutes.", CLUB_UTILISE: 'Ce club est engagé dans un championnat ou a des rencontres.',
  CLUB_A_DES_RENCONTRES: "Ce club a des rencontres dans ce championnat : supprime-les d'abord.", CHAMP_A_DES_RENCONTRES: "Supprime d'abord les rencontres de ce championnat.",
  MEMES_CLUBS: 'Choisis deux clubs différents.', CLUB_HORS_CHAMP: "Ce club n'est pas engagé dans le championnat.", JOURNEE: 'Numéro de journée invalide.',
  DATE: 'Date invalide.', MATCHS_JOUES: 'Des matchs sont déjà joués : impossible.', SCORE: 'Score invalide.', RENCONTRE_VCTC: 'Rencontre de notre équipe : le score vient des matchs.',
  COMPO_VIDE: "Compose d'abord l'équipe.", PAS_TON_MATCH: "Ce n'est pas ton match.", SCORE_ILLISIBLE: 'Score illisible : écris par exemple 6-3 4-6 7-5.',
  PAS_DE_VAINQUEUR: 'Ce score ne désigne pas de vainqueur.', COMPO_INCOMPLETE: 'Composition incomplète pour ce match.', IMAGE: 'Image illisible.',
  IMAGE_TROP_GROSSE: 'Image trop lourde.', UN_ADVERSAIRE_MINI: 'Choisis au moins un club adverse.', CLUB_INCONNU: 'Club inconnu.', CHAMP_INCONNU: 'Championnat inconnu.',
  INTROUVABLE: 'Élément introuvable (déjà supprimé ?).', JETON: 'Notifications : jeton invalide.', RESEAU: 'Pas de réseau. Réessaie.', CONFIG: "L'appli n'est pas encore reliée au serveur."
};
const errTxt = e => ERR[e && e.message] || (e && e.message) || 'Erreur';

/* ---------------- état ---------------- */
let D = LS.get('data', null);
let REV = LS.get('rev', '');
let AUTH = LS.get('auth', {});
let ROLE = 'spec', ME = '';
let tab = 'live', ctx = {}, stack = [], curCh = null, ptab = 's', psub = 'm';
let lastOk = LS.get('lastOk', 0), offline = false, deferredInstall = null, welcome = '';
const pending = {};           // envois live en attente par match
const undoStack = {};         // historique local par match

/* ---------------- serveur ---------------- */
function apiReady() { return CFG.apiUrl && !/COLLER|A_REMPLIR/.test(CFG.apiUrl); }
async function api(fn, args) {
  const body = Object.assign({ fn, auth: AUTH }, args || {});
  if (CFG.apiUrl === 'local' && window.LOCAL_API) {
    const r = await window.LOCAL_API(body);
    if (!r.ok && !r.conflit) throw new Error(r.err || 'Erreur');
    return r;
  }
  if (!apiReady()) throw new Error('CONFIG');
  let res;
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 30000);
    res = await fetch(CFG.apiUrl, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctl.signal, redirect: 'follow' });
    clearTimeout(to);
  } catch (e) { throw new Error('RESEAU'); }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('RESEAU'); }
  if (!j.ok && !j.conflit) throw new Error(j.err || 'Erreur');
  return j;
}
function setData(d) {
  if (!d) return;
  D = d; REV = d.rev; LS.set('data', d); LS.set('rev', REV);
  lastOk = Date.now(); LS.set('lastOk', lastOk); offline = false;
  // garder les états live encore en envoi
  Object.keys(pending).forEach(id => { const p = pending[id], st = p && (p.state || (p.flying ? p.sent : null)); if (st) { const m = D.matchs.find(x => x.id === id); if (m) Object.assign(m, st); } });
  if (LS.get('lu', null) === null) { const L = visibleNotifs(); LS.set('lu', L.length ? L[L.length - 1].date + L[L.length - 1].id : ''); }
  if (!curCh || !D.champs.some(c => c.id === curCh)) curCh = defaultChamp();
}
async function refresh(force) {
  if (!apiReady() && CFG.apiUrl !== 'local') return;
  try {
    const r = await api('data', { rev: force ? '' : REV });
    if (!r.same) { setData(r.data); render(); }
    else { lastOk = Date.now(); LS.set('lastOk', lastOk); if (offline) { offline = false; render(); } }
  } catch (e) { if (!offline) { offline = true; render(); } }
}
let pollT = null;
function schedulePoll() {
  clearTimeout(pollT);
  if (document.hidden) return;
  const live = D && D.matchs.some(m => m.statut === 'live');
  pollT = setTimeout(async () => { await refresh(); schedulePoll(); }, live ? 4000 : 20000);
}
async function act(fn, args, okMsg) {
  try {
    busy(true);
    const r = await api(fn, args);
    if (r.data) setData(r.data); else if (r.rev) await refresh(true);
    busy(false); closeSheet(); render();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) { busy(false); toast(errTxt(e)); return null; }
}

/* ---------------- identité ---------------- */
async function identify() {
  const q = new URLSearchParams(location.search);
  if (q.get('o')) { AUTH = { o: q.get('o').trim() }; LS.set('auth', AUTH); }
  else if (q.get('j')) { AUTH = { j: q.get('j').trim().toUpperCase() }; LS.set('auth', AUTH); }
  if (q.get('o') || q.get('j')) history.replaceState(null, '', location.pathname + location.hash);
  applyRole(LS.get('role', null));
  if (!AUTH.o && !AUTH.j) { applyRole({ role: 'spec' }); return; }
  try {
    const w = await api('whoami');
    if (w.role === 'spec') { toast(AUTH.o ? 'Code organisateur refusé.' : "Ce lien personnel n'est plus valable."); AUTH = {}; LS.set('auth', AUTH); }
    applyRole({ role: w.role, me: w.joueur });
    if (w.role === 'player' && q.get('j')) welcome = w.joueur;
    render(); pushVerifier();
  } catch (e) { /* hors ligne : on garde le rôle mémorisé */ }
}
function applyRole(r) {
  if (!r) return;
  ROLE = r.role || 'spec'; ME = r.me || '';
  LS.set('role', { role: ROLE, me: ME });
}
function logout() {
  AUTH = {}; LS.set('auth', AUTH); applyRole({ role: 'spec' }); closeSheet(); render(); toast('Mode spectateur'); pushVerifier(true);
}

/* ---------------- accès aux données ---------------- */
const clubs = () => (D ? D.clubs : []);
const club = id => clubs().find(c => c.id === id) || { id, nom: '?', sigle: '?', couleur: '#777' };
const pl = id => D && D.joueurs.find(p => p.id === id);
const opp = id => D && D.adversaires.find(o => o.id === id);
const person = id => pl(id) || opp(id);
const chOf = id => D && D.champs.find(c => c.id === id);
const isUs = r => r.domicile === US || r.exterieur === US;
const oppOf = r => (r.domicile === US ? r.exterieur : r.domicile);
const msOf = r => D.matchs.filter(m => m.rencontre === r.id).sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
const findM = id => { const m = D.matchs.find(x => x.id === id); return m ? [D.rencontres.find(r => r.id === m.rencontre), m] : []; };
const roster = cid => D.adversaires.filter(o => o.club === cid && o.actif).sort((a, b) => rv(a.classement) - rv(b.classement));
const team = () => D.joueurs.filter(p => p.actif).sort((a, b) => rv(a.classement) - rv(b.classement) || a.nom.localeCompare(b.nom));
function defaultChamp() {
  if (!D || !D.champs.length) return null;
  return [...D.champs].sort((a, b) => String(b.saison).localeCompare(String(a.saison)) || String(b.cree).localeCompare(String(a.cree)))[0].id;
}
function rStat(r) {
  if (!isUs(r)) return r.statut === 'done' ? 'done' : 'plan';
  const ms = msOf(r);
  if (!ms.length) return 'plan';
  if (ms.every(m => m.statut === 'done')) return 'done';
  if (ms.some(m => m.statut !== 'plan')) return 'live';
  return 'plan';
}
function rScore(r) {
  if (!isUs(r)) return r.statut === 'done' ? [Number(r.score_dom), Number(r.score_ext)] : [0, 0];
  let a = 0, b = 0;
  msOf(r).forEach(m => { if (m.statut === 'done') { if (m.vainqueur === 0) a++; else if (m.vainqueur === 1) b++; } });
  return r.domicile === US ? [a, b] : [b, a];
}
function bareme() { const b = String((D && D.reglages.bareme) || '3,2,1').split(',').map(Number); return { v: b[0] || 3, n: b[1] ?? 2, d: b[2] ?? 1 }; }
function table(chId) {
  const ch = chOf(chId); if (!ch) return [];
  const B = bareme(), T = {};
  ch.clubs.forEach(c => { T[c] = { c, J: 0, V: 0, N: 0, D: 0, mg: 0, mp: 0, pts: 0 }; });
  D.rencontres.filter(r => r.champ === chId && rStat(r) === 'done').forEach(r => {
    const [h, a] = rScore(r), H = T[r.domicile], A = T[r.exterieur];
    if (!H || !A) return;
    H.J++; A.J++; H.mg += h; H.mp += a; A.mg += a; A.mp += h;
    if (h > a) { H.V++; A.D++; H.pts += B.v; A.pts += B.d; } else if (a > h) { A.V++; H.D++; A.pts += B.v; H.pts += B.d; } else { H.N++; A.N++; H.pts += B.n; A.pts += B.n; }
  });
  return Object.values(T).sort((x, y) => y.pts - x.pts || (y.mg - y.mp) - (x.mg - x.mp) || y.mg - x.mg || club(x.c).nom.localeCompare(club(y.c).nom));
}
const chDone = id => { const c = chOf(id); return !!(c && c.termine); };
const canScore = m => m.statut === 'live' && (ROLE === 'admin' || (ROLE === 'player' && m.nous.includes(ME)));
const mine = m => ROLE === 'player' && m.nous.includes(ME);
const setsArr = m => String(m.sets || '').split(' ').filter(Boolean).map(s => s.split('-').map(Number));
const ptsArr = m => String(m.points || '0-0').split('-').map(Number);
const pair = s => String(s || '0-0').split('-').map(Number);
function ptsLabel(m, i) {
  const [a, b] = ptsArr(m); if (m.tb) return String([a, b][i]);
  if (a >= 3 && b >= 3) { if (a === b) return '40'; return [a, b][i] > [a, b][1 - i] ? 'AV' : ''; }
  return ['0', '15', '30', '40'][[a, b][i]] || '';
}
const short = id => { const p = person(id); return p ? esc(p.prenom.charAt(0) + '. ' + p.nom) : '?'; };
const full = id => { const p = person(id); return p ? p.prenom + ' ' + p.nom : '?'; };
const side = ids => (ids && ids.length ? ids.map(short).join(' / ') : '<span class="muted">À composer</span>');
const sideTxt = ids => (ids && ids.length ? ids.map(full).join(' / ') : '?');
function dateTxt(iso, court) {
  if (!iso) return 'Date à fixer';
  const p = iso.split(/[-T:]/).map(Number), d = new Date(p[0], p[1] - 1, p[2]);
  const J = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'], M = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const jour = diff === 0 ? "Aujourd'hui" : diff === 1 ? 'Demain' : diff === -1 ? 'Hier' : J[d.getDay()] + ' ' + p[2] + ' ' + M[p[1] - 1] + (court || d.getFullYear() === today.getFullYear() ? '' : ' ' + p[0]);
  return jour + (iso.length > 10 ? ' · ' + iso.slice(11, 13) + 'h' + iso.slice(14, 16) : '');
}
const nowIso = () => { const d = new Date(); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

/* ---------------- composants ---------------- */
const crest = (c, s = 36) => c.id === US ? `<img class="crest" src="logo.png" style="--cs:${s}px" alt="">` : `<span class="crest" style="--cs:${s}px;--cc:${esc(c.couleur || '#777')}">${esc(c.sigle)}</span>`;
function ava(p, s = 44) {
  if (!p) return `<span class="ava" style="--as:${s}px;--h:200">?</span>`;
  const ini = esc((p.prenom || '?').charAt(0) + (p.nom || '').charAt(0));
  const h = [...String(p.id)].reduce((a, c) => a + c.charCodeAt(0), 0) * 47 % 360;
  if (p.photo) return `<span class="ava" style="--as:${s}px;--h:${h}"><img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">${ini}</span>`;
  return `<span class="ava" style="--as:${s}px;--h:${h}">${ini}</span>`;
}
const tagOf = s => s === 'live' ? '<span class="tag live">● Live</span>' : s === 'done' ? '<span class="tag done">Terminé</span>' : '<span class="tag plan">À venir</span>';
function tieHTML(r, big) {
  const H = club(r.domicile), A = club(r.exterieur), s = rStat(r), [h, a] = rScore(r), ch = chOf(r.champ);
  const sc = s === 'plan' ? '–' : (r.domicile === US ? `<em>${h}</em>-${a}` : r.exterieur === US ? `${h}-<em>${a}</em>` : `${h}-${a}`);
  const t = big ? 'div' : 'button';
  return `<${t} class="tie ${big ? 'big' : ''}" ${big ? '' : `data-ren="${r.id}"`}><div class="tie-top">${tagOf(s)}<span>J${esc(r.journee)} · ${esc(ch ? ch.court : '')}</span><span class="r">${esc(dateTxt(r.date, true))}</span></div>
   <div class="tie-mid"><div class="clb">${crest(H, big ? 56 : 44)}<b>${esc(H.nom)}</b></div><div class="score">${sc}</div><div class="clb">${crest(A, big ? 56 : 44)}<b>${esc(A.nom)}</b></div></div>
   <div class="tie-foot"><span>${esc(r.lieu)}</span><span>${isUs(r) ? '4 simples · 2 doubles' : ''}</span></div></${t}>`;
}
function boardHTML(m, big) {
  const S = setsArr(m), n = Math.max(S.length, 2);
  const rows = [0, 1].map(i => {
    const ids = i ? m.eux : m.nous, p0 = ids.length === 1 ? person(ids[0]) : null;
    const cl = p0 ? `<small>${esc(p0.classement)}</small>` : '';
    const st = Array.from({ length: n }, (_, k) => {
      const s = S[k];
      if (!s || m.statut === 'plan') return `<div class="s">${k === 0 && m.statut === 'plan' ? '–' : ''}</div>`;
      const last = k === S.length - 1 && m.statut === 'live';
      return `<div class="s ${(s[i] > s[1 - i] && !last) || last ? 'w' : ''}">${s[i]}</div>`;
    }).join('');
    const pt = m.statut === 'live' ? (ptsLabel(m, i) || '&nbsp;') : '&nbsp;';
    return `<div class="pr ${m.statut === 'live' && m.serveur === i ? 'serv' : ''} ${m.statut === 'done' && m.vainqueur === i ? 'win' : ''}" style="--n:${n}"><span class="sv"></span><div class="n">${side(ids)}${cl}</div>${st}<div class="p ${m.statut !== 'live' ? 'x' : ''}">${pt}</div></div>`;
  }).join('');
  const t = big ? 'div' : 'button';
  const sending = pending[m.id] && (pending[m.id].state || pending[m.id].flying) ? ' <span class="muted">· envoi…</span>' : '';
  return `<${t} class="m ${big ? 'big' : ''}" ${big ? '' : `data-match="${m.id}"`}><div class="m-top"><span>${m.type}${m.tb && m.statut === 'live' ? ' · tie-break' : ''}${sending}</span>${tagOf(m.statut)}</div>${rows}</${t}>`;
}
function fxHTML(r) {
  const H = club(r.domicile), A = club(r.exterieur), s = rStat(r), [h, a] = rScore(r), us = isUs(r);
  let sc = s === 'plan' ? (!us && ROLE === 'admin' && r.date && r.date.slice(0, 10) <= nowIso().slice(0, 10) ? '<small>À SAISIR</small>–' : '–') : `${h}-${a}`;
  if (s === 'live') sc = `${h}-${a}<small>LIVE</small>`;
  const act = us ? `data-ren="${r.id}"` : (ROLE === 'admin' ? `data-res="${r.id}"` : '');
  return `<button class="fx ${us ? 'us' : ''}" ${act}><span class="h">${crest(H, 26)}<span>${esc(H.nom)}</span></span><span class="sc">${sc}</span><span class="a">${crest(A, 26)}<span>${esc(A.nom)}</span></span></button>`;
}
function chChips() {
  const L = [...D.champs].sort((a, b) => String(b.saison).localeCompare(String(a.saison)));
  return `<div class="chips">${L.map(c => `<button class="chip ${c.id === curCh ? 'on' : ''}" data-ch="${c.id}">${esc(c.saison)} · ${esc(c.court)}${chDone(c.id) ? ' ✓' : ''}</button>`).join('')}</div>`;
}
function pStats(pid, chId, kind) {
  let v = 0, d = 0, perf = 0; const ren = new Set();
  D.matchs.forEach(m => {
    if (m.statut !== 'done' || !m.nous.includes(pid)) return;
    const r = D.rencontres.find(x => x.id === m.rencontre); if (!r || (chId && r.champ !== chId)) return;
    const dbl = m.type.startsWith('Double'); if (kind && (kind === 'd') !== dbl) return;
    ren.add(r.id);
    if (m.vainqueur === 0) { v++; const o = opp(m.eux[0]); if (!dbl && o && pl(pid) && rv(o.classement) < rv(pl(pid).classement)) perf++; } else d++;
  });
  return { v, d, perf, ren: ren.size, pct: v + d ? Math.round(v / (v + d) * 100) : 0 };
}
const CUP = `<svg class="cup" viewBox="0 0 40 40" aria-hidden="true"><path d="M12 6h16v8a8 8 0 0 1-16 0z" fill="var(--em)"/><path d="M12 9H7a5 5 0 0 0 5 7M28 9h5a5 5 0 0 1-5 7" stroke="var(--em)" stroke-width="2.5" fill="none"/><rect x="18" y="21" width="4" height="7" fill="var(--em)"/><rect x="12" y="28" width="16" height="5" rx="1.5" fill="var(--em)"/></svg>`;
function roleBanner() {
  if (ROLE === 'admin') return '<div class="banner">Mode <b>organisateur</b> : tout est modifiable.</div>';
  if (ROLE === 'player') return `<div class="banner">Connecté en tant que <b>${esc(full(ME))}</b>.</div>`;
  return '';
}
function installBanner() {
  if (isStandalone() || LS.get('installHidden', 0)) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (deferredInstall) return `<div class="banner inst"><span>Installe l'appli sur ton écran d'accueil.</span><button class="btn sm acc" data-install>Installer</button><button class="x" data-hideinst aria-label="Masquer">✕</button></div>`;
  if (ios) return `<div class="banner inst"><span>Pour installer : bouton <b>Partager</b> puis <b>Sur l'écran d'accueil</b>.</span><button class="x" data-hideinst aria-label="Masquer">✕</button></div>`;
  return '';
}
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ---------------- vues ---------------- */
const V = {
  setup() {
    return `<h2>Bienvenue</h2><div class="banner">L'appli n'est pas encore reliée au serveur. Colle l'adresse <b>/exec</b> du script dans <b>config.js</b> (voir le guide d'installation).</div>`;
  },
  live() {
    if (!D) return `<div class="banner">Chargement…</div>`;
    const cid = defaultChamp(), ch = chOf(cid);
    const ours = D.rencontres.filter(isUs);
    const live = ours.filter(r => rStat(r) === 'live');
    const nxt = ours.filter(r => rStat(r) === 'plan').sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.journee - b.journee)[0];
    const last = ours.filter(r => rStat(r) === 'done').sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const ref = live[0] || nxt;
    const day = ref ? D.rencontres.filter(r => r.champ === ref.champ && r.journee === ref.journee && !isUs(r)) : [];
    const t = cid ? table(cid).slice(0, 4) : [];
    let h = roleBanner() + installBanner();
    if (!ch) return h + `<h2>Bienvenue</h2><div class="banner">Aucun championnat pour l'instant.${ROLE === 'admin' ? ' Crée-le dans Réglages › Championnats.' : ''}</div>`;
    h += `<h2>En direct</h2>` + (live.length ? live.map(r => tieHTML(r) + msOf(r).filter(m => m.statut === 'live').map(m => boardHTML(m)).join('')).join('') : '<div class="banner">Aucune rencontre en cours.</div>');
    if (nxt && nxt !== live[0]) h += `<h2>Prochaine rencontre</h2>${tieHTML(nxt)}`;
    if (day.length) h += `<h2>Autres rencontres · J${esc(ref.journee)}</h2><div class="day">${day.map(fxHTML).join('')}</div>`;
    if (last) h += `<h2>Dernier résultat</h2>${tieHTML(last)}`;
    if (t.length) h += `<h2>Classement <button class="more" data-tab="classement">Voir tout ›</button></h2><div class="list">${t.map((x, i) => `<div class="li ${x.c === US ? 'us' : ''}"><span class="pos">${i + 1}</span><div class="t">${esc(club(x.c).nom)}</div><div class="v">${x.pts} pts</div></div>`).join('')}</div>`;
    return h;
  },
  calendrier() {
    if (!D || !D.champs.length) return `<h2>Calendrier</h2><div class="banner">Aucun championnat.</div>`;
    const ch = chOf(curCh), rs = D.rencontres.filter(r => r.champ === curCh);
    const js = [...new Set(rs.map(r => Number(r.journee)))].sort((a, b) => a - b);
    const adm = ROLE === 'admin';
    return `<h2>Calendrier</h2>${chChips()}<div class="cap">${esc(ch.nom)}</div>
     ${js.map(j => { const L = rs.filter(r => Number(r.journee) === j).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
       const dates = [...new Set(L.map(r => r.date ? r.date.slice(0, 10) : ''))];
       return `<div class="day"><div class="day-h"><span>Journée ${j}</span><span class="muted">${esc(dates.length === 1 ? dateTxt(L[0].date) : '')}</span></div>${L.map(fxHTML).join('')}
       ${adm ? `<div class="bye adm"><button class="link" data-addfx="${j}">+ Rencontre</button>${L.map(r => `<button class="link" data-editfx="${r.id}">Modifier ${esc(club(r.domicile).sigle)}-${esc(club(r.exterieur).sigle)}</button>`).join('')}</div>` : ''}</div>`; }).join('') || '<div class="banner">Aucune rencontre pour l\'instant.</div>'}
     ${adm ? `<div class="row-btns"><button class="btn acc" data-addfx="${(js[js.length - 1] || 0) + 1}">+ Nouvelle journée</button></div><div class="banner">Tu saisis chaque rencontre (journée, date, clubs). Pour les autres clubs, touche le score pour saisir le résultat final.</div>` : ''}`;
  },
  classement() {
    if (!D || !D.champs.length) return `<h2>Classement</h2><div class="banner">Aucun championnat.</div>`;
    const ch = chOf(curCh), t = table(curCh), done = chDone(curCh), B = bareme();
    return `<h2>Classement</h2>${chChips()}
     ${done && t.length ? `<div class="champ">${CUP}<div><small>Champion ${esc(ch.saison)}</small><b>${esc(club(t[0].c).nom)}</b></div></div>` : `<div class="cap">${esc(ch.nom)}</div>`}
     <div class="tblw"><table><thead><tr><th>#</th><th>Club</th><th>Pts</th><th>J</th><th>V</th><th>N</th><th>D</th><th>+/-</th></tr></thead><tbody>
     ${t.map((x, i) => `<tr class="${x.c === US ? 'us' : ''}"><td class="pos">${i + 1}</td><td class="cl"><button data-club="${x.c}">${crest(club(x.c), 24)}<span>${esc(club(x.c).nom)}</span></button></td><td class="pts">${x.pts}</td><td>${x.J}</td><td>${x.V}</td><td>${x.N}</td><td>${x.D}</td><td>${x.mg - x.mp > 0 ? '+' : ''}${x.mg - x.mp}</td></tr>`).join('')}
     </tbody></table></div><p class="muted small">Victoire ${B.v} pts · Nul ${B.n} pts · Défaite ${B.d} pt${B.d > 1 ? 's' : ''}. Départage : différence de matchs gagnés.</p>`;
  },
  rencontre() {
    const r = D.rencontres.find(x => x.id === ctx.ren);
    if (!r) return `<button class="back" data-back>‹ Retour</button><div class="banner">Rencontre introuvable.</div>`;
    const adm = ROLE === 'admin', ms = msOf(r);
    const complet = ms.length && ms.every(m => m.nous.length === (m.type.startsWith('Double') ? 2 : 1) && m.eux.length === m.nous.length);
    return `<button class="back" data-back>‹ Retour</button><div style="margin-top:8px">${tieHTML(r, true)}</div>
     ${adm ? `<div class="row-btns" style="margin-top:0"><button class="btn sm" data-compo="${r.id}">Composer l'équipe</button><button class="btn sm ${complet ? 'acc' : ''}" data-convoc="${r.id}">${r.convoc ? 'Prévenir à nouveau' : 'Prévenir les joueurs'}</button><button class="btn sm" data-editfx="${r.id}">Date, lieu…</button></div>` : ''}
     ${adm && r.convoc ? `<p class="muted small">Joueurs prévenus : ${esc(dateTxt(r.convoc).toLowerCase())}.</p>` : ''}
     <h2>Feuille de match</h2>${ms.map(m => boardHTML(m)).join('')}`;
  },
  match() {
    const [r, m] = findM(ctx.match);
    if (!m) return `<button class="back" data-back>‹ Retour</button><div class="banner">Match introuvable.</div>`;
    const adm = ROLE === 'admin', ok = canScore(m), nb = m.type.startsWith('Double') ? 2 : 1;
    const compoOk = m.nous.length === nb && m.eux.length === nb;
    let pad = '';
    if (ok) {
      pad = `<div class="pad">${[0, 1].map(i => `<div class="col"><h4>${side(i ? m.eux : m.nous)}</h4><button class="btn acc big" data-pt="${i}">Point</button>
       <button class="btn sm" data-ace="${i}" ${m.serveur !== i ? 'disabled' : ''}>Ace</button><button class="btn sm" data-df="${i}" ${m.serveur !== i ? 'disabled' : ''}>Double faute</button></div>`).join('')}</div>
       <div class="row-btns"><button class="btn sm" data-undo ${(undoStack[m.id] || []).length ? '' : 'disabled'}>↶ Annuler le point</button><button class="btn sm" data-swap>Changer de serveur</button></div>`;
    } else if (m.statut === 'live') pad = `<div class="banner">${ROLE === 'spec' ? 'Score en direct, saisi par les joueurs du match ou l\'organisateur.' : 'Ce n\'est pas ton match : consultation seule.'}</div>`;
    else if (m.statut === 'plan' && (adm || mine(m))) pad = compoOk ? `<div class="row-btns"><button class="btn acc big" data-start>Lancer le match</button></div>` : '<div class="banner">Composition incomplète : l\'organisateur doit la finir.</div>';
    const fin = (adm || mine(m)) && compoOk ? `<button class="btn sm" data-final>${m.statut === 'done' ? 'Corriger le score' : 'Saisir le score final'}</button>` : '';
    const [ac0, ac1] = pair(m.aces), [df0, df1] = pair(m.df);
    return `<button class="back" data-back>‹ ${esc(club(oppOf(r)).nom)}</button><div class="cap">J${esc(r.journee)} · ${esc(dateTxt(r.date))}</div>
     ${boardHTML(m, true)}<div class="callout" id="call">${lastCall.id === m.id && Date.now() - lastCall.at < 2500 ? esc(lastCall.t) : ''}</div>${pad}
     <div class="row-btns">${fin}${adm ? `<button class="btn sm" data-editm="${m.id}">Joueurs et statut</button>` : ''}</div>
     <h2>Stats du match</h2><div class="box"><div class="set"><b>${ac0}</b><span class="muted">Aces</span><b>${ac1}</b></div><div class="set" style="border:0"><b>${df0}</b><span class="muted">Doubles fautes</span><b>${df1}</b></div></div>`;
  },
  equipe() {
    const adm = ROLE === 'admin', L = team(), cid = defaultChamp();
    return `<h2>${esc(club(US).nom)}</h2><div class="cap">${esc((D.reglages && D.reglages.equipe) || '')}</div>
     ${L.length ? `<div class="team">${L.map(p => { const s = pStats(p.id, cid, 's');
       return `<button class="tile" data-p="${p.id}">${p.attente && adm ? '<span class="flag">PHOTO</span>' : ''}${ava(p, 72)}<span class="t">${esc(p.prenom)} ${esc(p.nom)}</span><span class="s"><span class="rank">${esc(p.classement)}</span> · ${s.v}V ${s.d}D cette saison</span>${adm && !p.vu ? `<span class="s warn">${p.invite ? 'Invité, pas encore connecté' : 'Pas encore invité'}</span>` : ''}</button>`; }).join('')}</div>` : '<div class="banner">Aucun joueur pour l\'instant.</div>'}
     ${adm ? '<div class="row-btns"><button class="btn" data-newp>+ Ajouter un coéquipier</button><button class="btn acc" data-invall>Inviter les joueurs</button></div>' : ''}`;
  },
  fiche() {
    const p = pl(ctx.p);
    if (!p) return `<button class="back" data-back>‹ Équipe</button><div class="banner">Joueur introuvable.</div>`;
    const k = ptab, cid = defaultChamp(), sa = pStats(p.id, cid, k), ca = pStats(p.id, null, k), evo = rv(p.classement_prec) - rv(p.classement), me = ROLE === 'player' && ME === p.id, adm = ROLE === 'admin';
    const my = [];
    D.matchs.forEach(m => { if (m.statut === 'done' && m.nous.includes(p.id)) { const r = D.rencontres.find(x => x.id === m.rencontre); if (r) my.push([r, m]); } });
    my.sort((a, b) => (b[0].date || '').localeCompare(a[0].date || ''));
    const sAll = pStats(p.id, null, 's'), dAll = pStats(p.id, null, 'd');
    const tb = my.reduce((t, [, m]) => { setsArr(m).forEach(s => { if (s.includes(7) && s.includes(6)) { t.n++; if (s[0] === 7) t.w++; } }); return t; }, { n: 0, w: 0 });
    let btns = '';
    if (adm) btns = `<button class="btn sm" data-photo="${p.id}">Changer la photo</button><button class="btn sm" data-editp="${p.id}">Modifier</button><button class="btn sm acc" data-inv="${p.id}">${p.invite ? "Renvoyer l'invitation" : "Inviter sur l'appli"}</button>`;
    else if (me) btns = `<button class="btn sm acc" data-photo="${p.id}">Proposer une photo</button>`;
    else if (ROLE === 'spec') btns = `<button class="btn sm" data-claim="${p.id}">C'est moi</button>`;
    return `<button class="back" data-back>‹ Équipe</button>
     <div class="hero"><div><h3>${esc(p.prenom)}<br>${esc(p.nom)}</h3><div class="meta">${esc(p.main)}${p.capitaine ? ' · Capitaine' : ''}</div>
     ${p.attente && (me || adm) ? '<div class="pend">Nouvelle photo en attente de validation</div>' : ''}</div>${ava(p, 104)}</div>
     <div class="row-btns">${btns}</div>
     ${adm && p.attente && p.photo_attente ? `<div class="box pv-photo"><img src="${esc(p.photo_attente)}" alt="Photo proposée" referrerpolicy="no-referrer"><div><b>Photo proposée</b><div class="row-btns"><button class="btn sm acc" data-okph="${p.id}">Valider</button><button class="btn sm" data-noph="${p.id}">Refuser</button></div></div></div>` : ''}
     <div class="tabs"><button class="${k === 's' ? 'on' : ''}" data-ptab="s">Simples</button><button class="${k === 'd' ? 'on' : ''}" data-ptab="d">Doubles</button></div>
     <div class="tbl"><div class="tr"><b>Saison</b><div class="cells">
       <div class="cell"><strong>${esc(p.classement)}</strong><span>Classement</span></div>
       <div class="cell"><strong class="${evo > 0 ? 'up' : ''}">${evo > 0 ? '▲ ' + evo : evo < 0 ? '▼ ' + (-evo) : '='}</strong><span>Échelon</span></div>
       <div class="cell"><strong>${sa.v} - ${sa.d}</strong><span>V - D</span></div>
       <div class="cell"><strong>${k === 's' ? sa.perf : sa.pct + '%'}</strong><span>${k === 's' ? 'Perfs' : 'Victoires'}</span></div></div></div>
     <div class="tr"><b>Carrière</b><div class="cells">
       <div class="cell"><strong>${esc(p.meilleur || p.classement)}</strong><span>Meilleur</span></div>
       <div class="cell"><strong>${ca.v} - ${ca.d}</strong><span>V - D</span></div>
       <div class="cell"><strong>${ca.ren}</strong><span>Rencontres</span></div>
       <div class="cell"><strong>${ca.pct}%</strong><span>Victoires</span></div></div></div></div>
     <div class="chips" style="margin-top:14px"><button class="chip ${psub === 'm' ? 'on' : ''}" data-psub="m">Matchs</button><button class="chip ${psub === 'st' ? 'on' : ''}" data-psub="st">Stats</button></div>
     ${psub === 'm' ? `<div class="box">${my.slice(0, 15).map(([r, m]) => `<button class="res" data-match="${m.id}"><span class="vd ${m.vainqueur === 0 ? '' : 'l'}">${m.vainqueur === 0 ? 'V' : 'D'}</span><div>${m.type} vs ${side(m.eux)}<small>${esc(club(oppOf(r)).nom)} · ${esc((chOf(r.champ) || {}).saison || '')} J${esc(r.journee)}</small></div><span class="sc">${esc(m.sets)}</span></button>`).join('') || '<p class="muted">Aucun match joué.</p>'}</div>`
       : `<div class="box" style="padding:14px">
       <div class="bar"><div><span>Victoires en simple</span><b>${sAll.pct}%</b></div><i style="--v:${sAll.pct}%"></i></div>
       <div class="bar"><div><span>Victoires en double</span><b>${dAll.pct}%</b></div><i style="--v:${dAll.pct}%"></i></div>
       <div class="bar"><div><span>Tie-breaks gagnés</span><b>${tb.w} / ${tb.n}</b></div><i style="--v:${tb.n ? Math.round(tb.w / tb.n * 100) : 0}%"></i></div>
       <div class="bar" style="margin:0"><div><span>Perfs (victoires contre mieux classé)</span><b>${sAll.perf}</b></div><i style="--v:${Math.min(sAll.perf * 15, 100)}%"></i></div></div>`}`;
  },
  club() {
    const c = club(ctx.club);
    if (c.id === US) { tab = 'equipe'; return V.equipe(); }
    const adm = ROLE === 'admin';
    const rs = D.rencontres.filter(r => (r.domicile === c.id || r.exterieur === c.id) && isUs(r)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const T = adm ? 'button' : 'div';
    return `<button class="back" data-back>‹ Retour</button>
     <div class="champ" style="margin-top:8px">${crest(c, 52)}<div><b>${esc(c.nom)}</b><small>${esc(c.ville || '')}</small></div></div>
     ${adm ? `<div class="row-btns" style="margin-top:0"><button class="btn sm" data-editclub="${c.id}">Modifier le club</button><button class="btn sm" data-newo="${c.id}">+ Ajouter un joueur</button></div>` : ''}
     <h2>Joueurs</h2><div class="list">${roster(c.id).map(o => `<${T} class="li" ${adm ? `data-edito="${o.id}"` : ''}><span class="rank">${esc(o.classement)}</span><div><div class="t">${esc(o.prenom)} ${esc(o.nom)}</div><div class="s">${esc(o.main)}</div></div><span class="link">${adm ? 'Modifier' : ''}</span></${T}>`).join('') || '<div class="banner">Aucun joueur saisi.</div>'}</div>
     <h2>Contre nous</h2>${rs.map(r => tieHTML(r)).join('') || '<div class="banner">Jamais affronté.</div>'}`;
  },
  reglages() {
    const st = document.documentElement.dataset.s || '1', adm = ROLE === 'admin';
    const S = [['1', 'Club', 'Clair, collines et balle du logo', { bg: '#eef3eb', band: 'linear-gradient(90deg,#3f8f3a,#7cbf45)', ink: '#14215a', acc: '#e8641b', f: 'Lexend', st: 'normal' }],
      ['2', 'ATP', 'Marine et ciel, tableaux nets', { bg: '#07105e', band: 'linear-gradient(90deg,#050a4a,#5fb0cf)', ink: '#ffffff', acc: '#ff7a1a', f: 'Archivo', st: 'normal' }],
      ['3', 'Roland-Garros', 'Terre battue et vert', { bg: '#c4502a', band: '#00503c', ink: '#ffffff', acc: '#ffffff', f: 'Oswald', st: 'normal' }],
      ['4', 'Arcade', 'Esprit jeu vidéo, gros chiffres', { bg: '#0a0f3a', band: 'linear-gradient(100deg,#1c2a8f 50%,#7a2a0b 50%)', ink: '#a6e04a', acc: '#ff6a1a', f: 'Barlow Condensed', st: 'italic' }]];
    const who = ROLE === 'admin' ? 'Organisateur' : ROLE === 'player' ? 'Joueur · ' + esc(full(ME)) : 'Spectateur';
    return `<h2>Réglages</h2>
     <div class="cap">Style de l'appli</div><div class="list">${S.map(([k, t, d, c]) => `<button class="opt ${st === k ? 'on' : ''}" data-style="${k}"><span class="pv" style="--pbg:${c.bg};--pband:${c.band};--pink:${c.ink};--pacc:${c.acc};--pf:'${c.f}';--pst:${c.st}"><i></i><b>Aa</b><em></em></span><span><b>${k} · ${t}</b><small>${d}</small></span><span class="radio"></span></button>`).join('')}</div>
     <div class="cap" style="margin-top:18px">Mon accès</div><div class="box"><div class="set"><span>Mode</span><b>${who}</b></div>
       <div class="row-btns" style="margin:10px 0">${ROLE === 'spec' ? '<button class="btn sm acc" data-login>Je suis un joueur de l\'équipe</button>' : '<button class="btn sm" data-logout>Passer en spectateur</button>'}</div></div>
     <div class="cap" style="margin-top:18px">Mes notifications</div><div class="box" id="notifBox">${notifBox()}</div>
     ${adm ? `<div class="cap" style="margin-top:18px">Gestion</div><div class="list">
       ${[...D.champs].sort((a, b) => String(b.saison).localeCompare(String(a.saison))).map(c => `<button class="li" data-editch="${c.id}"><span class="rank">${esc(String(c.saison).slice(2, 4))}-${esc(String(c.saison).slice(-2))}</span><div><div class="t">${esc(c.nom)}</div><div class="s">${c.clubs.length} clubs · ${chDone(c.id) ? 'terminé' : D.rencontres.some(r => r.champ === c.id) ? 'en cours' : 'pas encore de rencontre'}</div></div><span class="link">Modifier</span></button>`).join('')}
       <button class="btn acc" data-newch>+ Nouveau championnat</button>
       <button class="btn" data-clubs>Clubs adverses (${clubs().length - 1})</button>
       <button class="btn" data-invall>Inviter les joueurs</button>
       <button class="btn" data-invspec>Inviter des spectateurs</button>
       <button class="btn" data-myorga>Mon lien organisateur</button>
       <button class="btn" data-settings>Nom de l'équipe et barème</button></div>` : ''}
     <p class="muted small" style="margin-top:18px">Smash Live ${APP_VERSION} · script ${esc((D && D.script) || '?')} · ${offline ? 'hors connexion' : 'à jour ' + new Date(lastOk || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>`;
  },
  clubs() {
    return `<button class="back" data-back>‹ Réglages</button><h2>Clubs adverses</h2><div class="list">${clubs().filter(c => c.id !== US).sort((a, b) => a.nom.localeCompare(b.nom)).map(c => `<button class="li" data-club="${c.id}">${crest(c)}<div><div class="t">${esc(c.nom)}</div><div class="s">${esc(c.ville || '')} · ${roster(c.id).length} joueurs</div></div><span class="link">›</span></button>`).join('')}
     <button class="btn acc" data-newclub>+ Ajouter un club</button></div>`;
  }
};

/* ---------------- rendu ---------------- */
const ICON = { live: '<circle cx="12" cy="12" r="9"/><path d="M4 9c4 1 6 4 6 12M20 15c-4-1-6-4-6-12"/>', calendrier: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  classement: '<path d="M5 20V11M12 20V5M19 20v-6"/>', equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c.5-4 3-6 7-6s6.5 2 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5 2 5.5 5"/>', reglages: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>' };
const TABN = { live: 'Live', calendrier: 'Calendrier', classement: 'Classement', equipe: 'Équipe', reglages: 'Réglages' };
const ROOT = { rencontre: 'calendrier', match: 'live', fiche: 'equipe', club: 'classement', clubs: 'reglages' };
function visibleNotifs() {
  if (!D) return [];
  return D.notifs.filter(n => { let c = []; try { c = JSON.parse(n.cible); } catch (e) { return false; } return c.includes(ROLE) || (ROLE === 'player' && c.includes('j:' + ME)); });
}
function unread() { const seen = LS.get('lu', ''); return visibleNotifs().filter(n => n.date + n.id > seen).length; }
function render() {
  const u = unread(), ch = D && chOf(defaultChamp());
  const meIco = ROLE === 'player' ? ava(pl(ME), 38) : `<span class="ava" style="--as:38px;--h:${ROLE === 'admin' ? 20 : 220}">${ROLE === 'admin' ? 'M' : '👁'}</span>`;
  $('#hdr').innerHTML = `<img class="logo" src="logo.png" alt="Logo du club"><div style="min-width:0"><b>Smash Live</b><small>${esc(D ? club(US).sigle : 'VCTC')}${ch ? ' · ' + esc(ch.court) + ' ' + esc(ch.saison) : ''}</small></div>
   <button class="bell" id="bell" aria-label="Notifications"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>${u ? `<em>${u > 99 ? '99' : u}</em>` : ''}</button>
   <button class="meBtn" data-tab="reglages" aria-label="Réglages">${meIco}</button>`;
  const root = ROOT[tab] || tab;
  $('#nav').innerHTML = Object.keys(TABN).map(k => `<button data-tab="${k}" class="${root === k ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICON[k]}</svg>${TABN[k]}</button>`).join('');
  const off = offline && D ? `<div class="offbar">Hors connexion · données du ${new Date(lastOk).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>` : '';
  let body;
  if (!apiReady() && CFG.apiUrl !== 'local') body = V.setup();
  else if (!D) body = offline ? '<div class="banner">Pas de réseau. Réessaie dans un instant.</div>' : '<div class="banner">Chargement…</div>';
  else body = (V[tab] || V.live)();
  $('#view').innerHTML = off + body;
  schedulePoll();
}
function go(t, c) { stack.push([tab, Object.assign({}, ctx)]); tab = t; ctx = Object.assign({}, ctx, c || {}); if (t === 'fiche') { ptab = 's'; psub = 'm'; } render(); scrollTo(0, 0); }
function back() { const s = stack.pop(); if (s) [tab, ctx] = s; else tab = 'live'; render(); scrollTo(0, 0); }
function openLink(h) {
  if (!h || !D) return;
  let m;
  if ((m = h.match(/^#r-(.+)$/))) { stack = []; tab = 'calendrier'; go('rencontre', { ren: m[1] }); }
  else if ((m = h.match(/^#m-(.+)$/))) { stack = []; tab = 'live'; go('match', { match: m[1] }); }
  else if ((m = h.match(/^#p-(.+)$/))) { stack = []; tab = 'equipe'; go('fiche', { p: m[1] }); }
  else if ((m = h.match(/^#res-(.+)$/))) { const r = D.rencontres.find(x => x.id === m[1]); if (r && ROLE === 'admin') { curCh = r.champ; stack = []; tab = 'calendrier'; render(); editResult(r); } }
  else if (h === '#classement') { stack = []; tab = 'classement'; render(); }
}

/* ---------------- score en direct ---------------- */
let lastCall = { t: '', at: 0 };
function callout(t) { const c = $('#call'); if (!c || !t) return; lastCall = { t, at: Date.now(), id: ctx.match }; c.textContent = t; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
const snap = m => ({ statut: m.statut, sets: m.sets, points: m.points, tb: m.tb, serveur: m.serveur, aces: m.aces, df: m.df, vainqueur: m.vainqueur });
function pushLive(m) {
  const p = pending[m.id] || (pending[m.id] = {});
  p.state = snap(m);
  flush(m.id);
}
async function flush(id) {
  const p = pending[id];
  if (!p || p.flying || !p.state) return;
  const m0 = D.matchs.find(x => x.id === id); if (!m0) return;
  const state = p.state; p.state = null; p.flying = true; p.sent = state;
  try {
    const r = await api('live', { m: Object.assign({ id }, state), v: p.v != null ? p.v : m0.v });
    p.flying = false;
    const m = D.matchs.find(x => x.id === id) || m0;
    if (r.conflit) {
      delete p.v;
      Object.assign(m, r.m); p.state = null; undoStack[id] = [];
      toast('Score mis à jour depuis un autre téléphone'); render();
    } else { m.v = r.m.v; p.v = r.m.v; if (!p.state) { Object.assign(m, r.m); render(); } else flush(id); }
    if (!p.state && !p.flying && pending[id] === p) delete pending[id];
  } catch (e) {
    p.flying = false;
    if (!p.state) p.state = state;
    if (e.message === 'RESEAU' || e.message === 'OCCUPE') setTimeout(() => flush(id), 3000);
    else { delete pending[id]; undoStack[id] = []; toast(errTxt(e)); refresh(true); }
  }
}
function point(m, w, kind) {
  (undoStack[m.id] = undoStack[m.id] || []).push(snap(m));
  const S = setsArr(m); if (!S.length) S.push([0, 0]);
  const s = S[S.length - 1], o = 1 - w, P = ptsArr(m);
  if (kind === 'ace') { const a = pair(m.aces); a[w]++; m.aces = a.join('-'); }
  if (kind === 'df') { const a = pair(m.df); a[o]++; m.df = a.join('-'); }
  P[w]++; let msg = kind === 'ace' ? 'Ace !' : kind === 'df' ? 'Double faute' : '';
  const gw = m.tb ? (P[w] >= 7 && P[w] - P[o] >= 2) : (P[w] >= 4 && P[w] - P[o] >= 2);
  if (gw) {
    s[w]++; P[0] = P[1] = 0; m.serveur = 1 - m.serveur; msg = 'Jeu';
    if ((s[w] >= 6 && s[w] - s[o] >= 2) || m.tb) {
      m.tb = 0;
      if (S.filter(x => x[w] > x[1 - w]).length === 2) { m.statut = 'done'; m.vainqueur = w; msg = w === 0 ? 'Match gagné !' : 'Match perdu'; }
      else { S.push([0, 0]); msg = 'Set !'; }
    } else if (s[0] === 6 && s[1] === 6) { m.tb = 1; msg = 'Tie-break !'; }
  } else if (!m.tb && P[0] >= 3 && P[1] >= 3) msg = P[0] === P[1] ? 'Égalité' : 'Avantage';
  else if (!m.tb && P[w] === 3 && P[o] < 3) msg = msg || (w === m.serveur ? 'Balle de jeu' : 'Balle de break');
  m.sets = S.map(x => x.join('-')).join(' '); m.points = P.join('-');
  pushLive(m); render(); callout(msg);
}

/* ---------------- feuilles et formulaires ---------------- */
function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, 2600); }
function busy(on) { $('#busy').hidden = !on; }
function sheet(h) { $('#sheet').innerHTML = h; $('#veil').hidden = false; $('#sheet').scrollTop = 0; }
function closeSheet() { $('#veil').hidden = true; $('#sheet').innerHTML = ''; }
const opts = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('');
function fieldHTML(f) {
  if (f.type === 'select') return `<div class="field"><label for="f_${f.k}">${f.label}</label><select id="f_${f.k}">${opts(f.options, f.value)}</select></div>`;
  if (f.type === 'multi') return `<div class="field"><label>${f.label}</label><div class="multi" id="f_${f.k}">${f.options.map(([v, l]) => `<label><input type="checkbox" value="${esc(v)}" ${f.value.includes(v) ? 'checked' : ''} ${f.lock && f.lock.includes(v) ? 'disabled' : ''}>${esc(l)}</label>`).join('')}</div></div>`;
  if (f.type === 'check') return `<div class="field"><label class="chk"><input type="checkbox" id="f_${f.k}" ${f.value ? 'checked' : ''}> ${f.label}</label></div>`;
  return `<div class="field"><label for="f_${f.k}">${f.label}</label><input id="f_${f.k}" type="${f.type || 'text'}" value="${esc(f.value)}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${f.im ? `inputmode="${f.im}"` : ''} ${f.max ? `maxlength="${f.max}"` : ''}></div>`;
}
function form(title, fields, save, o = {}) {
  sheet(`<h3>${title}</h3>${o.intro || ''}<form id="f">${fields.map(fieldHTML).join('')}${o.extra || ''}<div class="row-btns"><button type="button" class="btn" data-close>Annuler</button><button class="btn acc">${o.ok || 'Enregistrer'}</button></div></form>`);
  $('#f').onsubmit = e => {
    e.preventDefault();
    const v = {};
    fields.forEach(f => { const el = $('#f_' + f.k); v[f.k] = f.type === 'multi' ? [...el.querySelectorAll('input:checked')].map(i => i.value) : f.type === 'check' ? el.checked : el.value.trim(); });
    save(v);
  };
}
const RK = RANKS.map(r => [r, r]);
const MAIN = [['Droitier', 'Droitier'], ['Gaucher', 'Gaucher']];
function editPlayer(p) {
  form(p ? 'Modifier le joueur' : 'Nouveau coéquipier', [
    { k: 'prenom', label: 'Prénom', value: p ? p.prenom : '' }, { k: 'nom', label: 'Nom', value: p ? p.nom : '' },
    { k: 'classement', label: 'Classement actuel', type: 'select', options: RK, value: p ? p.classement : '30' },
    { k: 'classement_prec', label: 'Classement précédent', type: 'select', options: RK, value: p ? p.classement_prec : '30' },
    { k: 'meilleur', label: 'Meilleur classement', type: 'select', options: RK, value: p ? p.meilleur : '30' },
    { k: 'main', label: 'Main', type: 'select', options: MAIN, value: p ? p.main : 'Droitier' },
    { k: 'capitaine', label: 'Capitaine', type: 'check', value: p ? !!p.capitaine : false }],
  async v => {
    if (!v.prenom || !v.nom) return toast('Prénom et nom obligatoires');
    const r = await act('savePlayer', { p: Object.assign({ id: p ? p.id : '' }, v) }, p ? 'Joueur modifié' : 'Coéquipier ajouté');
    if (r && !p) setTimeout(() => invitePlayer(pl(r.id)), 300);
  }, { extra: p ? `<div class="row-btns"><button type="button" class="btn sm" data-delp="${p.id}">Retirer de l'équipe</button><button type="button" class="btn sm" data-newacc="${p.id}">Nouveau lien et code</button></div>` : '' });
}
function editOpp(o, cid) {
  form(o ? 'Modifier le joueur adverse' : 'Joueur de ' + esc(club(cid).nom), [
    { k: 'prenom', label: 'Prénom', value: o ? o.prenom : '' }, { k: 'nom', label: 'Nom', value: o ? o.nom : '' },
    { k: 'classement', label: 'Classement', type: 'select', options: RK, value: o ? o.classement : '30' },
    { k: 'main', label: 'Main', type: 'select', options: MAIN, value: o ? o.main : 'Droitier' }],
  v => { if (!v.prenom || !v.nom) return toast('Prénom et nom obligatoires'); act('saveOpp', { o: Object.assign({ id: o ? o.id : '', club: cid }, v) }, o ? 'Joueur modifié' : 'Joueur ajouté'); },
  { extra: o ? `<div class="row-btns"><button type="button" class="btn sm" data-delo="${o.id}">Supprimer ce joueur</button></div>` : '' });
}
function editClub(c) {
  form(c ? 'Modifier le club' : 'Nouveau club', [{ k: 'nom', label: 'Nom du club', value: c ? c.nom : '' }, { k: 'sigle', label: 'Sigle (3-4 lettres)', value: c ? c.sigle : '', max: 4 },
    { k: 'ville', label: 'Ville', value: c ? c.ville : '' }, ...(c && c.id !== US ? [{ k: 'couleur', label: 'Couleur', type: 'color', value: c.couleur || '#777777' }] : [])],
  async v => {
    if (!v.nom) return toast('Le nom est obligatoire');
    const r = await act('saveClub', { c: Object.assign({ id: c ? c.id : '' }, v) }, c ? 'Club modifié' : 'Club ajouté');
    if (r && !c) go('club', { club: r.id });
  }, { extra: c && c.id !== US ? `<div class="row-btns"><button type="button" class="btn sm" data-delclub="${c.id}">Supprimer ce club</button></div>` : '' });
}
function editCh(c) {
  const all = clubs().map(x => [x.id, x.nom]).sort((a, b) => (a[0] === US ? -1 : b[0] === US ? 1 : a[1].localeCompare(b[1])));
  const y = new Date().getFullYear(), sais = new Date().getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  form(c ? 'Modifier le championnat' : 'Nouveau championnat', [
    { k: 'nom', label: 'Nom', value: c ? c.nom : 'Championnat départemental Messieurs · Division 1' }, { k: 'court', label: 'Nom court', value: c ? c.court : 'Départemental D1' },
    { k: 'saison', label: 'Saison', value: c ? c.saison : sais }, { k: 'clubs', label: 'Clubs engagés', type: 'multi', options: all, value: c ? c.clubs : [US], lock: [US] },
    ...(c ? [{ k: 'termine', label: 'Championnat terminé (affiche le champion)', type: 'check', value: !!c.termine }] : [])],
  async v => {
    v.clubs = [US].concat(v.clubs.filter(x => x !== US));
    if (v.clubs.length < 2) return toast('Choisis au moins un club adverse');
    const r = await act('saveChamp', { c: Object.assign({ id: c ? c.id : '' }, v) }, c ? 'Championnat modifié' : 'Championnat créé : ajoute les rencontres');
    if (r && !c) { curCh = r.id; stack = []; tab = 'calendrier'; render(); }
  }, { intro: c ? '' : '<p class="muted small">Autant de clubs que tu veux. Les clubs manquants s\'ajoutent dans Réglages › Clubs adverses.</p>',
    extra: c ? `<div class="row-btns"><button type="button" class="btn sm" data-delch="${c.id}">Supprimer ce championnat</button></div>` : '' });
}
function editFixture(r, j) {
  const ch = chOf(r ? r.champ : curCh); if (!ch) return toast("Crée d'abord un championnat");
  const co = ch.clubs.map(id => [id, club(id).nom]);
  const played = r && isUs(r) && msOf(r).some(m => m.statut !== 'plan');
  const d = r && r.date ? r.date : '';
  form(r ? 'Modifier la rencontre' : 'Nouvelle rencontre', [
    { k: 'journee', label: 'Journée', value: r ? r.journee : j, type: 'number', im: 'numeric' },
    { k: 'jour', label: 'Date', type: 'date', value: d.slice(0, 10) }, { k: 'heure', label: 'Heure', type: 'time', value: d.slice(11, 16) || '09:00' },
    { k: 'domicile', label: 'Club qui reçoit', type: 'select', options: co, value: r ? r.domicile : US },
    { k: 'exterieur', label: 'Club qui se déplace', type: 'select', options: co, value: r ? r.exterieur : (ch.clubs.find(x => x !== US) || '') },
    { k: 'lieu', label: 'Lieu (facultatif)', value: r ? r.lieu : '', ph: 'Courts du club qui reçoit' }],
  v => {
    const date = v.jour ? v.jour + (v.heure ? 'T' + v.heure : '') : '';
    act('saveFixture', { r: { id: r ? r.id : '', champ: ch.id, journee: v.journee, date, domicile: v.domicile, exterieur: v.exterieur, lieu: v.lieu } }, r ? 'Rencontre modifiée' : 'Rencontre ajoutée');
  }, { extra: r && !played ? `<div class="row-btns"><button type="button" class="btn sm" data-delfx="${r.id}">Supprimer cette rencontre</button></div>` : '' });
}
function editResult(r) {
  const n = [...Array(21).keys()].map(i => [i, String(i)]);
  form('Résultat · J' + esc(r.journee), [
    { k: 'sd', label: club(r.domicile).nom, type: 'select', options: n, value: r.statut === 'done' ? r.score_dom : 0 },
    { k: 'se', label: club(r.exterieur).nom, type: 'select', options: n, value: r.statut === 'done' ? r.score_ext : 0 },
    { k: 'statut', label: 'Statut', type: 'select', options: [['done', 'Terminée'], ['plan', 'À jouer']], value: 'done' }],
  v => act('saveResult', { id: r.id, sd: v.sd, se: v.se, statut: v.statut }, 'Résultat enregistré'),
  { intro: '<p class="muted small">Pour les autres clubs, seul le score final de la rencontre est saisi (matchs gagnés par chaque club).</p>', extra: `<div class="row-btns"><button type="button" class="btn sm" data-editfx="${r.id}">Modifier date et clubs</button></div>` });
}
function editCompo(r) {
  const ms = msOf(r), o = oppOf(r);
  const U = [['', '—'], ...team().map(p => [p.id, `${p.prenom} ${p.nom} (${p.classement})`])];
  const A = [['', '—'], ...roster(o).map(x => [x.id, `${x.prenom} ${x.nom} (${x.classement})`])];
  const f = [];
  ms.forEach((m, i) => {
    const d = m.type.startsWith('Double');
    f.push({ k: 'u' + i + 'a', label: m.type + ' · VCTC' + (d ? ' (1)' : ''), type: 'select', options: U, value: m.nous[0] || '' });
    if (d) f.push({ k: 'u' + i + 'b', label: m.type + ' · VCTC (2)', type: 'select', options: U, value: m.nous[1] || '' });
    f.push({ k: 't' + i + 'a', label: m.type + ' · ' + club(o).sigle + (d ? ' (1)' : ''), type: 'select', options: A, value: m.eux[0] || '' });
    if (d) f.push({ k: 't' + i + 'b', label: m.type + ' · ' + club(o).sigle + ' (2)', type: 'select', options: A, value: m.eux[1] || '' });
  });
  form('Composition', f, v => {
    const lignes = ms.map((m, i) => ({ id: m.id, nous: [v['u' + i + 'a'], v['u' + i + 'b']].filter(Boolean), eux: [v['t' + i + 'a'], v['t' + i + 'b']].filter(Boolean) }));
    for (const l of lignes) if (new Set(l.nous).size !== l.nous.length || new Set(l.eux).size !== l.eux.length) return toast('Même joueur deux fois dans un double');
    act('saveLineup', { rencontre: r.id, lignes }, 'Composition enregistrée');
  }, { intro: `<p class="muted small">Les joueurs de ${esc(club(o).nom)} se saisissent dans sa fiche (Classement › club, ou Réglages › Clubs adverses).</p>`, extra: `<div class="row-btns"><button type="button" class="btn sm" data-newo="${o}">+ Joueur adverse</button></div>` });
}
function editMatchAdmin(m) {
  const [r] = findM(m.id), o = oppOf(r), d = m.type.startsWith('Double');
  const U = [['', '—'], ...team().map(p => [p.id, `${p.prenom} ${p.nom} (${p.classement})`])];
  const A = [['', '—'], ...roster(o).map(x => [x.id, `${x.prenom} ${x.nom} (${x.classement})`])];
  const f = [{ k: 'u1', label: 'VCTC', type: 'select', options: U, value: m.nous[0] || '' }];
  if (d) f.push({ k: 'u2', label: 'VCTC · partenaire', type: 'select', options: U, value: m.nous[1] || '' });
  f.push({ k: 't1', label: club(o).nom, type: 'select', options: A, value: m.eux[0] || '' });
  if (d) f.push({ k: 't2', label: club(o).nom + ' · partenaire', type: 'select', options: A, value: m.eux[1] || '' });
  f.push({ k: 'sets', label: 'Score (VCTC en premier, ex. 6-3 4-6 7-5)', value: m.statut === 'plan' ? '' : m.sets, ph: '6-3 6-4' },
    { k: 'statut', label: 'Statut', type: 'select', options: [['plan', 'À jouer'], ['live', 'En cours'], ['done', 'Terminé']], value: m.statut });
  form('Modifier · ' + m.type, f, v => {
    const nous = [v.u1, v.u2].filter(Boolean), eux = [v.t1, v.t2].filter(Boolean);
    const sets = v.statut === 'plan' ? '' : (v.sets.replace(/[\/:]/g, '-').replace(/\s+/g, ' ').trim() || '0-0');
    act('saveMatch', { m: { id: m.id, nous, eux, statut: v.statut, sets } }, 'Match modifié').then(r2 => { if (r2) undoStack[m.id] = []; });
  });
}
function finalScore(m) {
  form((m.statut === 'done' ? 'Corriger le score · ' : 'Score final · ') + m.type, [{ k: 'sets', label: 'Score (VCTC en premier)', value: m.statut === 'done' ? m.sets : '', ph: '6-3 4-6 7-5' }],
    async v => {
      const sets = v.sets.replace(/[\/:]/g, '-').replace(/\s+/g, ' ').trim();
      if (!/^\d{1,2}-\d{1,2}( \d{1,2}-\d{1,2}){0,4}$/.test(sets)) return toast(ERR.SCORE_ILLISIBLE);
      if (ROLE === 'admin') act('saveMatch', { m: { id: m.id, statut: 'done', sets } }, 'Score enregistré');
      else {
        try { busy(true); const r = await api('live', { m: { id: m.id, statut: 'done', sets, points: '0-0', tb: 0, serveur: m.serveur, aces: m.aces, df: m.df }, v: m.v }); busy(false);
          if (r.conflit) { Object.assign(m, r.m); toast('Le score a changé entre-temps, vérifie et recommence'); closeSheet(); render(); return; }
          Object.assign(m, r.m); closeSheet(); toast('Score enregistré'); refresh(true); render();
        } catch (e) { busy(false); toast(errTxt(e)); }
      }
    }, { intro: '<p class="muted small">Pour un match qui n\'a pas été suivi point par point.</p>' });
}
function startMatch(m) {
  sheet(`<h3>Qui sert en premier ?</h3><div class="list">${[0, 1].map(i => `<button class="btn big" data-firstsrv="${i}">${side(i ? m.eux : m.nous)}</button>`).join('')}</div><div class="row-btns"><button class="btn" data-close>Annuler</button></div>`);
}
function editSettings() {
  form("Équipe et barème", [{ k: 'equipe', label: "Nom de l'équipe", value: D.reglages.equipe || '' }, { k: 'bareme', label: 'Points victoire, nul, défaite', value: D.reglages.bareme || '3,2,1', ph: '3,2,1' }],
    v => { if (!/^\d+,\d+,\d+$/.test(v.bareme.replace(/\s/g, ''))) return toast('Barème : trois nombres, ex. 3,2,1'); act('saveSettings', { s: { equipe: v.equipe, bareme: v.bareme.replace(/\s/g, '') } }, 'Enregistré'); });
}

/* ---------------- invitations ---------------- */
const BASE = () => location.origin + location.pathname.replace(/index\.html$/, '');
function shareSheet(title, intro, msg, after) {
  sheet(`<h3>${title}</h3><p class="muted small">${intro}</p><pre id="msg" class="msg">${esc(msg)}</pre>
   <div class="row-btns"><button class="btn" data-close>Fermer</button><a class="btn" id="wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a><button class="btn acc" id="cp">Copier</button></div>`);
  const done = () => { after && after(); };
  $('#cp').onclick = () => {
    const sel = () => { const r = document.createRange(); r.selectNodeContents($('#msg')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Texte sélectionné : fais Copier'); };
    try { navigator.clipboard.writeText(msg).then(() => { toast('Message copié'); done(); }, sel); } catch (e) { sel(); }
  };
  $('#wa').onclick = done;
}
function invitePlayer(p) {
  if (!p || !p.jeton) return toast('Recharge la page puis réessaie');
  const link = BASE() + '?j=' + p.jeton;
  const msg = `🎾 *Smash Live*\nSalut ${p.prenom} !\n\nVoici *ton lien personnel* pour l'appli de l'équipe :\n${link}\n\n1️⃣ Ouvre le lien sur ton téléphone\n2️⃣ Appuie sur *Installer* (sur iPhone : Partager → _Sur l'écran d'accueil_)\n3️⃣ C'est tout, tu es reconnu automatiquement\n\nSi l'appli te demande qui tu es, ton code est *${p.code}*.\n_Ne transfère pas ce lien, il est à ton nom._`;
  shareSheet('Inviter ' + esc(p.prenom), "Lien <b>joueur</b> à son nom : il est reconnu à l'ouverture, sans rien taper.", msg, () => { api('markInvite', { id: p.id }).then(r => { if (r.data) { setData(r.data); } }).catch(() => {}); });
}
function inviteSpec() {
  const msg = `🎾 *Smash Live*\nSuivez ${(D.reglages && D.reglages.equipe) || "l'équipe"} du ${club(US).nom} en direct : scores live, calendrier, classement.\n\n👉 ${BASE()}\n\nOuvrez le lien puis appuyez sur *Installer* (sur iPhone : Partager → _Sur l'écran d'accueil_).`;
  shareSheet('Inviter des spectateurs', "Lien <b>public</b> : il ouvre l'appli en consultation. À poster dans le groupe du club.", msg);
}
function inviteAll() {
  sheet(`<h3>Invitations joueurs</h3><p class="muted small">Chaque coéquipier reçoit son propre lien. Touche un joueur pour préparer son message.</p>
   <div class="list">${team().map(p => `<button class="li" data-inv="${p.id}">${ava(p, 36)}<div><div class="t">${esc(p.prenom)} ${esc(p.nom)}</div><div class="s">${p.vu ? 'Connecté à l\'appli' : p.invite ? 'Invitation envoyée' : 'Pas encore invité'}</div></div><span class="tag ${p.vu ? 'done' : 'plan'}">${p.vu ? 'OK' : p.invite ? 'Envoyé' : 'À inviter'}</span></button>`).join('')}</div>
   <div class="row-btns"><button class="btn" data-close>Fermer</button></div>`);
}
function myOrga() {
  const link = BASE() + '?o=' + encodeURIComponent(D.orga ? D.orga.code : AUTH.o || '');
  shareSheet('Mon lien organisateur', 'Pour ouvrir l\'appli en organisateur sur un autre téléphone. <b>Ne le partage avec personne.</b>', link);
}

/* ---------------- identification par code ---------------- */
function pickCard() {
  sheet(`<h3>Qui es-tu ?</h3><p class="muted small">Choisis ta carte puis entre ton code à 4 chiffres (donné par l'organisateur).</p>
   <div class="team">${team().map(p => `<button class="tile" data-pickp="${p.id}">${ava(p, 56)}<span class="t">${esc(p.prenom)} ${esc(p.nom)}</span></button>`).join('')}</div><div class="row-btns"><button class="btn" data-close>Annuler</button></div>`);
}
function askCode(id) {
  const p = pl(id);
  sheet(`<h3>Code de ${esc(p.prenom)}</h3><form id="f"><div class="field"><label for="code">Code à 4 chiffres</label><input id="code" inputmode="numeric" maxlength="4" autocomplete="one-time-code"></div>
   <div class="row-btns"><button type="button" class="btn" data-close>Annuler</button><button class="btn acc">Valider</button></div></form>`);
  setTimeout(() => $('#code') && $('#code').focus(), 50);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const c = $('#code').value.trim();
    if (!/^\d{4}$/.test(c)) return toast('4 chiffres attendus');
    try {
      busy(true);
      const r = await api('login', { joueur: id, code: c });
      AUTH = { j: r.j }; LS.set('auth', AUTH); applyRole({ role: 'player', me: r.joueur });
      busy(false); closeSheet(); render(); toast('Salut ' + p.prenom + ' !'); pushVerifier(true);
    } catch (err) { busy(false); toast(errTxt(err)); }
  };
}

/* ---------------- photos ---------------- */
let photoFor = null;
function pickPhoto(id) { photoFor = id; $('#file').click(); }
function onFile(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !photoFor) return;
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas'), s = Math.min(img.width, img.height), N = 400;
      c.width = c.height = N; c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, N, N);
      const url = c.toDataURL('image/jpeg', 0.82);
      if (ROLE === 'admin') act('setPhoto', { joueur: photoFor, img: url }, 'Photo mise à jour');
      else {
        try { busy(true); await api('proposePhoto', { img: url }); busy(false); toast("Photo envoyée à l'organisateur pour validation"); refresh(true); }
        catch (err) { busy(false); toast(errTxt(err)); }
      }
    };
    img.onerror = () => toast(ERR.IMAGE);
    img.src = rd.result;
  };
  rd.readAsDataURL(f);
}

/* ---------------- notifications (cloche + Firebase) ---------------- */
function notifSheet() {
  const L = visibleNotifs().slice().reverse(), seen = LS.get('lu', '');
  sheet(`<h3>Notifications</h3>${L.slice(0, 60).map(n => `<button class="nt ${n.date + n.id > seen ? 'new' : ''}" data-open="${esc(n.lien)}"><span class="k">${esc(n.type)}</span><div><p><b>${esc(n.titre)}</b><br>${esc(n.texte)}</p><small>${esc(dateTxt(n.date))}</small></div></button>`).join('') || '<p class="muted">Rien de neuf.</p>'}
   <div class="row-btns"><button class="btn" data-close>Fermer</button></div>`);
  const top = L[0]; if (top) LS.set('lu', top.date + top.id);
  render();
}
const NP = {
  spec: [['live', "Début d'une rencontre de l'équipe"], ['res', 'Résultat de chaque match'], ['fin', 'Score final de la rencontre'], ['cla', 'Classement mis à jour']],
  player: [['convoc', 'Convocation dans la composition'], ['rappel', 'Rappel la veille de la rencontre'], ['live', 'Début de mes matchs'], ['res', "Résultats de l'équipe"], ['photo', 'Ma photo validée ou refusée']],
  admin: [['photo', 'Photo proposée à valider'], ['score', 'Score saisi par un joueur'], ['autres', 'Résultats des autres clubs à saisir'], ['compo', 'Rappel de composition'], ['fin', 'Score final de la rencontre']]
};
const PDEF = { spec: { live: 1, res: 1, fin: 1, cla: 0 }, player: { convoc: 1, rappel: 1, live: 1, res: 1, photo: 1 }, admin: { photo: 1, score: 1, autres: 1, compo: 1, fin: 1 } };
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
function pushSupport() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function notifBox() {
  const tok = LS.get('pushTok', ''), prefs = Object.assign({}, PDEF[ROLE], LS.get('prefs:' + ROLE, {}));
  let head;
  if (!D || !D.push) head = '<p class="muted small">Notifications sur le téléphone pas encore configurées sur le serveur. La cloche en haut fonctionne déjà.</p>';
  else if (!pushSupport()) head = ios() && !isStandalone() ? '<p class="muted small">Sur iPhone, installe d\'abord l\'appli (Partager → Sur l\'écran d\'accueil) puis ouvre-la depuis son icône pour activer les notifications.</p>' : '<p class="muted small">Ce navigateur ne gère pas les notifications.</p>';
  else if (Notification.permission === 'denied') head = '<p class="muted small">Notifications bloquées pour cette appli. Autorise-les dans les réglages du téléphone (Notifications › Smash Live ou le navigateur), puis reviens ici.</p>';
  else if (!tok) head = '<div class="row-btns" style="margin:10px 0"><button class="btn acc" data-pushon>Activer les notifications</button></div>';
  else head = '<div class="set"><span>Notifications</span><b class="ok">Activées ✓</b></div>';
  const rows = NP[ROLE].map(([k, t], i, a) => `<div class="set" ${i === a.length - 1 ? 'style="border:0"' : ''}><span>${t}</span><button class="tg ${prefs[k] ? 'on' : ''}" data-tg="${k}" aria-label="${esc(t)}" ${tok ? '' : 'disabled'}></button></div>`).join('');
  return head + rows + (tok ? '<div class="row-btns" style="margin:6px 0 10px"><button class="btn sm" data-pushtest>Envoyer un essai</button></div>' : '');
}
let fbLoaded = null;
function loadScript(src) { return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); }
async function fcmToken(ask) {
  if (!D || !D.push || !pushSupport()) return null;
  if (Notification.permission !== 'granted') {
    if (!ask) return null;
    const p = await Notification.requestPermission();
    if (p !== 'granted') return null;
  }
  if (!fbLoaded) fbLoaded = loadScript('firebase-app-compat.js').then(() => loadScript('firebase-messaging-compat.js'));
  await fbLoaded;
  if (!firebase.apps.length) firebase.initializeApp(D.push.config);
  const reg = await navigator.serviceWorker.ready;
  return firebase.messaging().getToken({ vapidKey: D.push.vapid, serviceWorkerRegistration: reg });
}
async function subscribe(token, prefs) {
  const r = await api('abonner', { token, prefs, appareil: navigator.userAgent.replace(/^.*?\(([^)]+)\).*$/, '$1').slice(0, 60) });
  LS.set('pushTok', token); LS.set('pushRole', ROLE + ':' + ME); LS.set('prefs:' + ROLE, r.prefs || prefs);
}
async function pushOn() {
  try {
    busy(true);
    const t = await fcmToken(true);
    if (!t) { busy(false); render(); return toast(Notification.permission === 'denied' ? 'Notifications refusées' : 'Notifications non activées'); }
    await subscribe(t, Object.assign({}, PDEF[ROLE], LS.get('prefs:' + ROLE, {})));
    busy(false); render(); toast('Notifications activées');
  } catch (e) { busy(false); console.error(e); toast('Activation impossible : ' + errTxt(e)); }
}
/** Au démarrage et quand le rôle change : jeton à jour et rôle connu du serveur. */
async function pushVerifier(roleChanged) {
  try {
    if (!D || !D.push || !pushSupport() || Notification.permission !== 'granted') return;
    const old = LS.get('pushTok', ''); if (!old && !roleChanged) return;
    const t = await fcmToken(false); if (!t) return;
    if (t !== old || roleChanged || LS.get('pushRole', '') !== ROLE + ':' + ME) await subscribe(t, Object.assign({}, PDEF[ROLE], LS.get('prefs:' + ROLE, {})));
    render();
  } catch (e) { console.error('pushVerifier', e); }
}
async function togglePref(k) {
  const prefs = Object.assign({}, PDEF[ROLE], LS.get('prefs:' + ROLE, {}));
  prefs[k] = prefs[k] ? 0 : 1; LS.set('prefs:' + ROLE, prefs); render();
  const t = LS.get('pushTok', '');
  if (t) { try { await subscribe(t, prefs); } catch (e) { toast(errTxt(e)); } }
}
async function pushTest() {
  try { busy(true); const r = await api('notifEssai', { token: LS.get('pushTok', '') }); busy(false); toast(r.envoyes ? 'Essai envoyé : regarde tes notifications' : "Envoi refusé : vérifie la configuration Firebase"); }
  catch (e) { busy(false); toast(errTxt(e)); }
}

/* ---------------- clics ---------------- */
function setStyle(s) {
  document.documentElement.dataset.s = s; LS.set('style', s);
  const tc = { 1: '#eef3eb', 2: '#03063a', 3: '#f3ece3', 4: '#05072a' }[s];
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = tc;
  render();
}
document.addEventListener('click', e => {
  if (e.target.id === 'veil') { closeSheet(); return; }
  const t = e.target.closest('button,[data-open]'); if (!t) return;
  const d = t.dataset;
  const M = () => findM(ctx.match)[1];
  if (t.id === 'bell') return notifSheet();
  if (d.tab) { stack = []; tab = d.tab; closeSheet(); render(); scrollTo(0, 0); }
  else if ('back' in d) back();
  else if (d.open !== undefined) { closeSheet(); openLink(d.open); }
  else if (d.ren) { closeSheet(); go('rencontre', { ren: d.ren }); }
  else if (d.match) go('match', { match: d.match });
  else if (d.res) { const r = D.rencontres.find(x => x.id === d.res); if (r) editResult(r); }
  else if (d.ch) { curCh = d.ch; render(); }
  else if (d.club) go('club', { club: d.club });
  else if (d.p) go('fiche', { p: d.p });
  else if (d.ptab) { ptab = d.ptab; render(); }
  else if (d.psub) { psub = d.psub; render(); }
  else if (d.style) setStyle(d.style);
  else if ('login' in d) pickCard();
  else if ('logout' in d) logout();
  else if (d.pickp) askCode(d.pickp);
  else if (d.claim) askCode(d.claim);
  else if (d.tg) togglePref(d.tg);
  else if ('pushon' in d) pushOn();
  else if ('pushtest' in d) pushTest();
  else if (d.photo) pickPhoto(d.photo);
  else if (d.okph) act('photoDecision', { joueur: d.okph, ok: true }, 'Photo validée');
  else if (d.noph) act('photoDecision', { joueur: d.noph, ok: false }, 'Photo refusée');
  else if (d.editp) editPlayer(pl(d.editp));
  else if ('newp' in d) editPlayer(null);
  else if (d.delp) { if (confirmTwice(t, 'Confirmer le retrait ?')) act('delPlayer', { id: d.delp }, 'Joueur retiré').then(r => r && back()); }
  else if (d.newacc) { if (confirmTwice(t, "L'ancien lien ne marchera plus. Confirmer ?")) act('newAccess', { id: d.newacc }, 'Nouveau lien créé : renvoie l\'invitation'); }
  else if (d.edito) { const o = opp(d.edito); editOpp(o, o.club); }
  else if (d.newo) editOpp(null, d.newo);
  else if (d.delo) { if (confirmTwice(t, 'Confirmer la suppression ?')) act('delOpp', { id: d.delo }, 'Joueur supprimé'); }
  else if (d.editclub) editClub(club(d.editclub));
  else if ('newclub' in d) editClub(null);
  else if (d.delclub) { if (confirmTwice(t, 'Confirmer la suppression ?')) act('delClub', { id: d.delclub }, 'Club supprimé').then(r => r && back()); }
  else if ('clubs' in d) go('clubs');
  else if (d.editch) editCh(chOf(d.editch));
  else if ('newch' in d) editCh(null);
  else if (d.delch) { if (confirmTwice(t, 'Confirmer la suppression ?')) act('delChamp', { id: d.delch }, 'Championnat supprimé').then(() => { curCh = defaultChamp(); render(); }); }
  else if (d.addfx) editFixture(null, d.addfx);
  else if (d.editfx) editFixture(D.rencontres.find(r => r.id === d.editfx));
  else if (d.delfx) { if (confirmTwice(t, 'Confirmer la suppression ?')) act('delFixture', { id: d.delfx }, 'Rencontre supprimée').then(r => { if (r && tab === 'rencontre') back(); }); }
  else if (d.compo) editCompo(D.rencontres.find(r => r.id === d.compo));
  else if (d.convoc) act('convoquer', { rencontre: d.convoc }).then(r => r && toast(r.n + ' joueur' + (r.n > 1 ? 's' : '') + ' prévenu' + (r.n > 1 ? 's' : '')));
  else if (d.editm) editMatchAdmin(D.matchs.find(m => m.id === d.editm));
  else if (d.inv) { closeSheet(); setTimeout(() => invitePlayer(pl(d.inv)), 50); }
  else if ('invall' in d) inviteAll();
  else if ('invspec' in d) inviteSpec();
  else if ('myorga' in d) myOrga();
  else if ('settings' in d) editSettings();
  else if ('install' in d) { if (deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(() => { deferredInstall = null; render(); }); } }
  else if ('hideinst' in d) { LS.set('installHidden', 1); render(); }
  else if ('close' in d) closeSheet();
  else if ('final' in d) finalScore(M());
  else if ('start' in d) startMatch(M());
  else if (d.firstsrv !== undefined) { const m = M(); closeSheet(); undoStack[m.id] = []; Object.assign(m, { statut: 'live', sets: '0-0', points: '0-0', tb: 0, serveur: Number(d.firstsrv), vainqueur: null }); pushLive(m); render(); callout("C'est parti !"); }
  else if (d.pt !== undefined) point(M(), Number(d.pt));
  else if (d.ace !== undefined) point(M(), Number(d.ace), 'ace');
  else if (d.df !== undefined) point(M(), 1 - Number(d.df), 'df');
  else if ('undo' in d) { const m = M(), h = undoStack[m.id] || []; if (h.length) { Object.assign(m, h.pop()); pushLive(m); render(); } }
  else if ('swap' in d) { const m = M(); undoStack[m.id] = undoStack[m.id] || []; undoStack[m.id].push(snap(m)); m.serveur = 1 - m.serveur; pushLive(m); render(); }
});
/** Double appui pour les suppressions (les fenêtres de confirmation du navigateur sont évitées). */
function confirmTwice(btn, msg) {
  if (btn.dataset.sure) return true;
  btn.dataset.sure = '1'; const old = btn.textContent; btn.textContent = msg; btn.classList.add('danger');
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = old; btn.classList.remove('danger'); } }, 4000);
  return false;
}

/* ---------------- démarrage ---------------- */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; render(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); } else clearTimeout(pollT); });
window.addEventListener('online', () => { refresh(); Object.keys(pending).forEach(flush); });
window.addEventListener('hashchange', () => { if (location.hash) { openLink(location.hash); history.replaceState(null, '', location.pathname); } });
$('#file').addEventListener('change', onFile);
if ('serviceWorker' in navigator && CFG.apiUrl !== 'local') {
  navigator.serviceWorker.register('sw.js').catch(e => console.error('sw', e));
  navigator.serviceWorker.addEventListener('message', ev => { const m = ev.data || {}; if (m.type === 'push') refresh(true); if (m.type === 'open' && m.lien) openLink(m.lien); });
}
(async function boot() {
  const s = LS.get('style', '1'); document.documentElement.dataset.s = s;
  if (D) curCh = defaultChamp();
  const hash = location.hash;
  render();
  await identify();
  await refresh(true);
  render();
  if (welcome) toast('Bienvenue ' + ((pl(welcome) || {}).prenom || '') + ' !');
  if (hash) { openLink(hash); history.replaceState(null, '', location.pathname); }
  pushVerifier(false);
})();
