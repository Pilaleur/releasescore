// fiche.js — extension « ReleaseScore » (nommée « Notes C411 » jusqu'à la 0.1.4) : affiche la note de chaque version sur une fiche de torrent de C411.
//
// Principe (décisions du 16 et du 17/11/2026) : l'extension complète le site, elle ne le remplace pas.
//   - seulement sur les fiches (/torrents/<empreinte>), pour les lignes du bloc « Versions » ; rien dans les listes ;
//   - la note est posée à droite des lignes, dans la marge de la page (calque à part : les conteneurs du bloc coupent ce qui
//     dépasse) ; fenêtre trop étroite : dans la ligne, juste avant le code du type de fichier ;
//   - couleurs de l'outil : vert = dans le profil, jaune = un critère manque, rouge = au-dessus du plafond de poids,
//     gris = deux critères manquants ou plus ; étoile = meilleure note parmi les versions dans le profil ;
//   - survol = bulle courte sous la ligne ; clic = la bulle reste ; « Pourquoi cette note ? » déplie le détail ; clic ailleurs = fermeture ;
//   - pas de note estimée : effet de chargement tant que toutes les fiches du bloc ne sont pas lues (le format de l'image du film
//     se déduit de l'ensemble des versions : une note affichée avant pourrait encore bouger).
//
// Les notes sont celles de l'outil (moteur/note.js, moteur/lecteur-mediainfo.js : mêmes fichiers).
// Notation (0.3.0, 18/11/2026) : « rapide » (par défaut) ou « poussée » (réglage « notation » de la fenêtre). En mode poussé, la note
// tient compte des paramètres d'encodage publiés et de la difficulté du film, mesurée sur ses versions x265 en CRF : les notes
// attendent que toutes les fiches du bloc soient lues (la difficulté se mesure sur l'ensemble ; pas de note qui bouge ensuite).
// Lecture des fiches : depuis la page, avec la session du navigateur (aucune clé API, rien n'est envoyé ailleurs qu'à C411) :
//   GET /api/torrents/<empreinte>            -> nom, taille, NFO / MediaInfo (metadata.nfoContent), langue, fiche TMDB
//   GET /api/torrents/<empreinte>/mediainfo  -> { content } : seulement si la première réponse n'a pas de MediaInfo lisible
// Une requête à la fois, 0,67 s entre deux (75 % de la limite de 120 par minute). Chaque fiche lue est gardée dans la mémoire
// de l'extension (chrome.storage.local, « f:<empreinte> », environ 1 Ko) : elle n'est plus redemandée.
// L'extension ne lit ni n'envoie le jeton « csrf-token » de la page, et ne touche à aucun bouton de téléchargement.

(() => {
  "use strict";
  if (window.__notesC411) return;
  window.__notesC411 = true;

  const V2 = Note.v2, LECTEUR = LecteurMediainfo;
  const RE_FICHE = /^\/torrents\/([0-9a-f]{40})(?:[/?#]|$)/i;
  const RYTHME = 670;                         // ms entre deux requêtes
  const REESSAI_ABSENTE = 30 * 24 * 3600 * 1000;
  const VERSION_CACHE = 2;                    // 2 (0.1.1) : langue originale lue dans tmdbData.languages ; les fiches gardées par la 0.1.0 sont relues une fois
  const PROFIL_DEFAUT = "HDLight 1080p";
  const PLEIN_CADRE = /(^|[^a-z])(imax|open[ ._-]?matte)([^a-z]|$)/i;
  const AVI_TITRE = /(^|[^A-Za-z0-9])(AVI|XVID|DIVX)([^A-Za-z0-9]|$)/i;
  const TAILLE = /(\d+(?:[.,]\d+)?)\s*(To|Go|Mo|Ko|TiB|GiB|MiB|KiB|TB|GB|MB|KB)(?![A-Za-z])/gi;
  const nb = (x, d = 0) => (x == null || !Number.isFinite(x) ? "?" : x.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const fx = (x) => "× " + nb(x, 2).replace(/0$/, "");
  const kb = (k) => (k == null ? "?" : k >= 1000 ? `${nb(k / 1000, 1)} Mb/s` : `${Math.round(k)} kb/s`);
  const pt = (x) => `${x >= 0 ? "+" : "−"}${nb(Math.abs(x), 0)} pt${Math.abs(Math.round(x)) > 1 ? "s" : ""}`;
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- mémoire de l'extension ----------
  const stock = {
    lire: (cles) => new Promise((res) => { try { chrome.storage.local.get(cles, (v) => res(chrome.runtime.lastError ? {} : v || {})); } catch (e) { res({}); } }),
    ecrire: (o) => new Promise((res) => { try { chrome.storage.local.set(o, () => { void chrome.runtime.lastError; res(); }); } catch (e) { res(); } }),
  };
  let PROFIL = { nom: PROFIL_DEFAUT, affiche: PROFIL_DEFAUT, r: { ...V2.PROFILS[PROFIL_DEFAUT] } };
  let MODE = "rapide";          // « rapide » ou « pousse » (fenêtre de l'extension, clé « notation »)
  function reglages(v) {
    if ("notation" in v) MODE = v.notation === "pousse" ? "pousse" : "rapide";
    if ("profil" in v) {
      const p = v.profil;
      PROFIL = p && p.r ? { nom: p.nom || PROFIL_DEFAUT, affiche: p.affiche || p.nom || PROFIL_DEFAUT, r: { ...V2.PROFILS[PROFIL_DEFAUT], ...p.r } }
        : { nom: PROFIL_DEFAUT, affiche: PROFIL_DEFAUT, r: { ...V2.PROFILS[PROFIL_DEFAUT] } };
    }
    if ("equipement" in v) V2.equipement(v.equipement || {});
  }

  // ---------- état ----------
  const FICHES = new Map();     // empreinte -> { t, f (faits ou null), nom, taille, approx, src, sans, o: { type, vo, anim, runtime } }
  const ERREURS = new Map();    // empreinte -> message (pas gardé : redemandé à la prochaine visite ou par « Réessayer »)
  const CHERCHEES = new Set();  // empreintes déjà cherchées dans la mémoire de l'extension
  const P = new Map();          // empreinte -> ligne de la page { hash, el, courante, racine, bouton, etoile, hote }
  let BLOC = null, PAGE = null, ETROIT = false, RESULTATS = new Map(), PRET = false, FORMAT_CONNU = false;
  const DIAG = { requetes: {}, requetesPage: {}, apercuTmdb: null, attentes429: 0, clesFiche: null, clesMeta: null, clesTmdb: null, clesMediainfo: null, sources: {}, structure: "", titre: false, erreurs: [] };
  const compte = (o, k) => { o[k] = (o[k] || 0) + 1; };

  // ---------- repérage de la page ----------
  const hashPage = () => { const m = location.pathname.match(RE_FICHE); return m ? m[1].toLowerCase() : null; };
  const aNous = (n) => n && n.nodeType === 1 && (n.id === "notes-c411-calque" || (n.classList && n.classList.contains("notes-c411-hote")));
  function hashLien(a) {
    try {
      const u = new URL(a.getAttribute("href") || "", location.href);
      if (u.origin !== location.origin) return null;
      const m = u.pathname.match(RE_FICHE);
      return m ? m[1].toLowerCase() : null;
    } catch (e) { return null; }
  }
  const liensDe = (racine) => [...racine.querySelectorAll('a[href*="/torrents/"]')].filter((a) => hashLien(a));

  // Le bloc « Versions » : le premier élément après le titre « Versions (+N) » qui contient des liens de fiches ;
  // sans titre reconnu : le plus grand groupe de liens de fiches de même présentation.
  function trouverBloc() {
    DIAG.titre = false;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!/^\s*Versions(\s*\(\+?\s*\d+\s*\))?\s*$/.test(n.nodeValue)) continue;
      let e = n.parentElement;
      for (let i = 0; e && e !== document.body && i < 6; i++, e = e.parentElement) {
        for (let s = e.nextElementSibling; s; s = s.nextElementSibling) {
          if (aNous(s)) continue;
          if (liensDe(s).length || (s.matches && s.matches("a") && hashLien(s))) { DIAG.titre = true; return s.matches("a") ? s.parentElement : s; }
        }
      }
    }
    const groupes = new Map();
    for (const a of liensDe(document.body)) { const k = a.className || "(sans classe)"; if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(a); }
    const g = [...groupes.values()].sort((a, b) => b.length - a.length)[0];
    if (!g || g.length < 2) return null;
    let anc = g[0].parentElement;
    while (anc && !g.every((a) => anc.contains(a))) anc = anc.parentElement;
    return anc && anc !== document.body ? anc : null;
  }

  // Les lignes du bloc : une par lien de fiche, plus la ligne de la version affichée (sans lien)
  function trouverLignes(hPage) {
    const bloc = trouverBloc();
    BLOC = bloc;
    if (!bloc) return [];
    const largeur = bloc.getBoundingClientRect().width || 1;
    const lignes = [], vus = new Set(), elements = new Set();
    for (const a of liensDe(bloc)) {
      const h = hashLien(a);
      if (vus.has(h)) continue;
      let el = a;   // la ligne : le lien, ou son parent s'il n'occupe pas la largeur du bloc
      while (el.parentElement && el.parentElement !== bloc && el.getBoundingClientRect().width < largeur * 0.8 && liensDe(el.parentElement).length === 1) el = el.parentElement;
      vus.add(h); elements.add(el);
      lignes.push({ hash: h, el, lien: a, courante: h === hPage });
    }
    if (!vus.has(hPage)) {
      const parents = new Set(lignes.map((l) => l.el.parentElement));
      let trouve = null;
      for (const p of parents) {
        for (const c of p.children) {
          if (elements.has(c) || aNous(c) || liensDe(c).length || (c.matches("a") && hashLien(c))) continue;
          TAILLE.lastIndex = 0;
          if (TAILLE.test(c.textContent || "") && c.querySelectorAll("*").length >= 3) { trouve = c; break; }
        }
        if (trouve) break;
      }
      if (trouve) lignes.push({ hash: hPage, el: trouve, lien: null, courante: true });
    }
    // dans l'ordre de la page
    lignes.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const l0 = lignes[0];
    DIAG.structure = l0 ? `${lignes.length} lignes (version affichée ${lignes.some((l) => l.courante) ? "trouvée" : "NON trouvée"}) ; ligne = <${l0.el.tagName.toLowerCase()}> ${l0.el.children.length} enfants ; dans <${l0.el.parentElement.tagName.toLowerCase()}> ; bloc = <${bloc.tagName.toLowerCase()}>` : "aucune ligne";
    return lignes;
  }

  // Ce que la page dit d'une ligne (secours quand la fiche ne donne pas le nom ou la taille)
  function infosLigne(l) {
    const feuilles = [...l.el.querySelectorAll("*")].filter((x) => !x.children.length && !aNous(x) && !x.closest(".notes-c411-hote")).map((x) => (x.textContent || "").trim()).filter(Boolean);
    const texte = feuilles.join(" ");
    let taille = null, m;
    TAILLE.lastIndex = 0;
    while ((m = TAILLE.exec(texte))) {
      const u = m[2].toLowerCase(), n = Number(m[1].replace(",", "."));
      const p = { k: 1, m: 2, g: 3, t: 4 }[u[0]];
      taille = n * Math.pow(/^(.o|.ib)$/.test(u) ? 1024 : 1000, p); // « Go » de C411 = Gio (3,03 milliards d'octets affichés « 2,8 Go »)
    }
    let nom = feuilles.join(".").replace(/\s+/g, ".");
    if (l.courante) { const h1 = document.querySelector("h1"); if (h1 && (h1.textContent || "").trim()) nom = h1.textContent.trim(); }
    const langues = feuilles.filter((x) => /\b(VFF|VFQ|VFB|VF2|VFI|VOSTFR|MULTI|TRUEFRENCH|FRENCH)\b/i.test(x));
    return { nom, taille, langues };
  }

  // L'œuvre de la page : film ou série (lien TMDB), langue originale, animation
  function oeuvre(lignes) {
    const fiches = lignes.map((l) => FICHES.get(l.hash)).filter(Boolean);
    const premier = (k) => (fiches.find((e) => e.o && e.o[k] != null) || { o: {} }).o[k] ?? null;
    let film = null;
    if (document.querySelector('a[href*="themoviedb.org/movie/"]')) film = true;
    else if (document.querySelector('a[href*="themoviedb.org/tv/"]')) film = false;
    else { const t = premier("type"); film = t ? !/tv|serie|série|show/i.test(String(t)) : true; }
    let anim = fiches.some((e) => e.o && e.o.anim === true);
    if (!anim && !fiches.some((e) => e.o && e.o.anim === false)) {
      // genre affiché par C411 (« Genre: Animation »), quand la fiche TMDB n'a pas été donnée
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) if (/^\s*Genre\s*:?\s*$/.test(n.nodeValue)) { anim = /anim/i.test((n.parentElement.parentElement || n.parentElement).textContent || ""); break; }
    }
    return { film, anim, vo: premier("vo"), runtime: premier("runtime") };
  }

  // ---------- lecture des fiches ----------
  let derniere = 0, ficheRefusee = false, refus = 0;
  async function appel(chemin, sorte) {
    for (let essai = 0; essai < 5; essai++) {
      const reste = derniere + RYTHME - Date.now();
      if (reste > 0) await attendre(reste);
      derniere = Date.now();
      let rep;
      try { rep = await fetch(chemin, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); }
      catch (e) { compte(DIAG.requetes, `${sorte} erreur`); compte(DIAG.requetesPage, `${sorte} erreur`); throw new Error(e && e.name === "TimeoutError" ? "pas de réponse de C411 en 30 s" : "C411 injoignable"); }
      compte(DIAG.requetes, `${sorte} ${rep.status}`); compte(DIAG.requetesPage, `${sorte} ${rep.status}`);
      if (rep.status === 429) { DIAG.attentes429++; await attendre(Math.min(120, Number(rep.headers.get("retry-after")) || 60) * 1000); continue; }
      return rep;
    }
    throw new Error("C411 demande de ralentir : réessaie dans quelques minutes");
  }
  const cles = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).slice(0, 40).join(", ") : String(typeof o));

  async function lireFiche(l) {
    const h = l.hash, page = infosLigne(l);
    let it = null;
    if (!ficheRefusee) {
      const rep = await appel(`/api/torrents/${h}`, "fiche");
      if (rep.status === 404 || rep.status === 410) return { v: VERSION_CACHE, t: new Date().toISOString(), f: null, sans: "inconnue", nom: page.nom, taille: page.taille, approx: true, o: {} };
      if (rep.status === 401 || rep.status === 403) { if (++refus >= 2) ficheRefusee = true; }
      else if (rep.ok) {
        const j = await rep.json().catch(() => null);
        it = j && typeof j === "object" ? (j.data && typeof j.data === "object" && !Array.isArray(j.data) ? j.data : j.torrent && typeof j.torrent === "object" ? j.torrent : j) : null;
        if (it && !DIAG.clesFiche) { DIAG.clesFiche = cles(it); DIAG.clesMeta = cles(it.metadata); DIAG.clesTmdb = cles((it.metadata || {}).tmdbData || it.tmdbData); }
      } else throw new Error(`C411 a répondu ${rep.status}`);
    }
    const m = (it && it.metadata) || {};
    const tm = m.tmdbData || (it && it.tmdbData) || {};
    const nom = (it && typeof it.name === "string" && it.name) || page.nom;
    const option = (m.options || []).find((o) => o && o.slug === "langue");
    const langueC411 = option && Array.isArray(option.values) ? option.values.map((v) => v && v.value).filter(Boolean) : page.langues;
    const vo = langueOriginale(tm) || [...FICHES.values()].map((e) => e.o && e.o.vo).find(Boolean) || null;
    if (it && !DIAG.apercuTmdb) DIAG.apercuTmdb = `languages = ${apercu(tm.languages)} ; genres = ${apercu(tm.genres)} ; type = ${apercu(tm.type)} ; langue originale retenue : ${vo || "aucune"}`;
    const ctx = { nom, langueC411, vo };
    let f = null, src = null, sans = null;
    if (typeof m.nfoContent === "string" && m.nfoContent.trim()) { f = LECTEUR.lire(m.nfoContent, ctx); if (f) src = "fiche"; else sans = "illisible"; }
    if (!f) {
      const rep = await appel(`/api/torrents/${h}/mediainfo`, "mediainfo");
      if (rep.ok) {
        const j = await rep.json().catch(() => null);
        if (j && !DIAG.clesMediainfo) DIAG.clesMediainfo = cles(j);
        const texte = j && (typeof j.content === "string" ? j.content : j.data && typeof j.data.content === "string" ? j.data.content : typeof j.mediainfo === "string" ? j.mediainfo : "");
        if (texte && texte.trim()) { f = LECTEUR.lire(texte, ctx); if (f) { src = "mediainfo"; sans = null; } else sans = "illisible"; }
        else if (!sans) sans = "absent";
      } else if (rep.status === 404 || rep.status === 410 || rep.status === 204) { if (!sans) sans = "absent"; }
      else if (rep.status === 401 || rep.status === 403) { if (!it) throw new Error("C411 refuse la lecture des fiches : es-tu connecté ?"); if (!sans) sans = "absent"; }
      else throw new Error(`C411 a répondu ${rep.status}`);
    }
    if (src) compte(DIAG.sources, src);
    const genres = Array.isArray(tm.genres) ? tm.genres : null, ids = Array.isArray(tm.genre_ids) ? tm.genre_ids : null;
    const anim = genres || ids ? !!((ids || []).includes(16) || (genres || []).some((g) => (g && g.id === 16) || /animation/i.test(String((g && g.name) || g)))) : null;
    const taille = it && Number(it.size) > 0 ? Number(it.size) : page.taille;
    return {
      v: VERSION_CACHE, t: new Date().toISOString(), f, ...(f ? {} : { sans }), nom, taille, ...(it && Number(it.size) > 0 ? {} : { approx: true }), src,
      o: { type: m.tmdbType || tm.type || tm.media_type || null, vo: langueOriginale(tm), anim, runtime: Number(tm.runtime) > 0 ? Number(tm.runtime) : null },
    };
  }
  // Langue originale : C411 ne donne pas « original_language » ; tmdbData.languages (format vu le 17/11 : à confirmer par le diagnostic).
  // Premier élément de la liste : code à 2 lettres, objet { iso_639_1 | code | iso | name }, ou nom de la langue (anglais / français).
  const NOMS = { fr: /fran[cç]/i, en: /english|anglais/i, es: /spanish|espagnol|castillan/i, it: /italian|italien/i, de: /german|allemand/i, ja: /japanese|japonais/i,
    ko: /korean|cor[ée]en/i, zh: /chinese|chinois|mandarin|cantonese|cantonais/i, pt: /portugu/i, ru: /russian|russe/i, hi: /hindi/i, nl: /dutch|n[ée]erlandais/i, sv: /swedish|su[ée]dois/i,
    da: /danish|danois/i, no: /norwegian|norv[ée]gien/i, fi: /finnish|finnois/i, pl: /polish|polonais/i, tr: /turkish|turc/i, ar: /arabic|arabe/i, he: /hebrew|h[ée]breu/i, th: /thai/i };
  function codeLangue(x) {
    if (x && typeof x === "object") x = x.iso_639_1 || x.iso6391 || x.code || x.iso || x.english_name || x.name || "";
    const t = String(x || "").trim();
    if (/^[a-z]{2}([-_][a-z]{2})?$/i.test(t)) return t.slice(0, 2).toLowerCase();
    for (const [c, re] of Object.entries(NOMS)) if (re.test(t)) return c;
    return null;
  }
  function langueOriginale(tm) {
    const direct = tm.original_language || tm.originalLanguage;
    if (direct) return codeLangue(direct);
    const l = Array.isArray(tm.languages) ? tm.languages : typeof tm.languages === "string" ? tm.languages.split(/[,;|]/) : [];
    return l.length ? codeLangue(l[0]) : null;
  }
  const apercu = (x) => { const l = Array.isArray(x) ? x.slice(0, 2) : x; const t = JSON.stringify(l); return `${Array.isArray(x) ? `liste de ${x.length}` : typeof x} ${t && t.length > 120 ? t.slice(0, 120) + "…" : t}`; };
  const valable = (e) => !!e && e.v >= VERSION_CACHE && (e.f ? !LECTEUR.aRelire(e.f) : Date.now() - Date.parse(e.t) < REESSAI_ABSENTE);

  let file = [], actif = false;
  async function lancer() {
    if (actif) return;
    actif = true;
    let erreursDeSuite = 0;
    try {
      while (file.length) {
        const h = file[0], l = P.get(h);
        if (!l || FICHES.has(h)) { file.shift(); continue; }
        try {
          const e = await lireFiche(l);
          FICHES.set(h, e); ERREURS.delete(h); erreursDeSuite = 0;
          stock.ecrire({ ["f:" + h]: e });
        } catch (err) {
          ERREURS.set(h, err.message); erreursDeSuite++;
          if (DIAG.erreurs.length < 5) DIAG.erreurs.push(err.message);
          // trois erreurs de suite (déconnecté, C411 en panne) : on arrête, le reste est marqué de la même erreur
          if (erreursDeSuite >= 3) { for (const x of file) if (!FICHES.has(x)) ERREURS.set(x, err.message); file = []; }
        }
        file = file.filter((x) => x !== h);
        maj();
      }
    } finally { actif = false; }
  }
  function demander(lignes) {
    const voulu = [...lignes].sort((a, b) => (b.courante ? 1 : 0) - (a.courante ? 1 : 0)).map((l) => l.hash).filter((h) => !FICHES.has(h) && !ERREURS.has(h));
    file = voulu;   // seulement les fiches de la page affichée
    if (file.length) lancer();
  }

  // ---------- notes ----------
  function dureeParDebit(f, taille) {
    if (!f || !(f.video > 0) || !(taille > 0)) return null;
    const audio = (f.pistes || []).reduce((t, p) => t + (p.debit > 0 ? p.debit : 0), 0) / 1000;
    return taille * 8 / ((f.video + audio) * 1e6) / 60;
  }
  const f0video = (f) => (f.vmoy > 0 ? f.vmoy : f.video);
  const hm = (min) => { const m = Math.round(min); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
  // Torrent de bonus seuls (17/11/2026, même règle que Rechercher) : film dont le nom dit BONUS ou EXTRAS ET dont le fichier le
  // plus long dure moins de 70 % du film. Durée du film : celle de TMDB, sinon la médiane des fichiers les plus longs des autres
  // versions lues (au moins deux). Sans le film, la version n'a pas de note : pastille « Bonus ». Durée du film inconnue : notée.
  const MOT_BONUS = /(^|[^A-Za-z0-9])(BONUS|EXTRAS)([^A-Za-z0-9]|$)/i;
  function dureeFilm(o, lignes) {
    if (o.runtime > 0) return { min: o.runtime, source: "TMDB" };
    const d = lignes.map((l) => FICHES.get(l.hash)).filter((e) => e && e.f && e.f.duree > 0 && !MOT_BONUS.test(e.nom || "")).map((e) => e.f.duree).sort((a, b) => a - b);
    if (d.length < 2) return null;
    const m = d.length >> 1;
    return { min: d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2, source: "les autres versions" };
  }
  function calculer() {
    const lignes = [...P.values()];
    PRET = lignes.length > 0 && lignes.every((l) => FICHES.has(l.hash) || ERREURS.has(l.hash));
    RESULTATS = new Map();
    // Affichage petit à petit (choix du 17/11/2026) : une note s'affiche dès que sa fiche est lue, mais seulement une fois
    // le format de l'image du film connu, c'est-à-dire dès qu'une version recadrée (sans bandes noires, plus large ou plus étroite
    // que 16:9) a été lue, ou quand tout est lu. Ensuite, une version plus large lue plus tard peut encore la faire bouger
    // d'un point (mesuré sur La Femme de ménage : 2,388 puis 2,400). Étoile : seulement quand tout est lu.
    const aspect = V2.aspectOeuvre(lignes.map((l) => FICHES.get(l.hash)).filter((e) => e && e.f).map((e) => e.f));
    // notation poussée : la difficulté du film se mesure sur toutes les versions, les notes attendent donc la fin de la lecture
    FORMAT_CONNU = MODE === "pousse" ? PRET : PRET || Math.abs(aspect - 16 / 9) > 0.01;
    if (!FORMAT_CONNU) return;
    const o = oeuvre(lignes);
    const film = o.film ? dureeFilm(o, lignes) : null;
    const ctx = { aspect, anim: !!o.anim, vo: o.vo || null };
    if (MODE === "pousse") {
      // difficulté du film : ses versions x265 en CRF (sans les bonus seuls) ; série : versions de la saison affichée
      const faitsD = lignes.map((l) => FICHES.get(l.hash)).filter((e) => e && e.f && !(film && MOT_BONUS.test(e.nom || "") && e.f.duree > 0 && e.f.duree < 0.7 * film.min))
        .map((e) => ({ ...(!o.film && e.f.nf > 1 && e.f.vmoy > 0 ? { ...e.f, video: e.f.vmoy } : e.f), pleinCadre: !!e.f.pleinCadre || PLEIN_CADRE.test(e.nom || "") }));
      ctx.mode = "pousse"; ctx.D = V2.difficulte(faitsD, ctx);
    }
    ctx.I = V2.ideal(PROFIL.r, ctx);
    for (const l of lignes) {
      const e = FICHES.get(l.hash);
      if (!e) { if (ERREURS.has(l.hash)) RESULTATS.set(l.hash, { type: "erreur", message: ERREURS.get(l.hash) }); continue; }
      if (!e.f) { RESULTATS.set(l.hash, { type: "sans", raison: e.sans }); continue; }
      if (film && MOT_BONUS.test(e.nom || "") && e.f.duree > 0 && e.f.duree < 0.7 * film.min) { RESULTATS.set(l.hash, { type: "bonus", f: e.f, film }); continue; }
      // Série dont le MediaInfo décrit plusieurs fichiers (décision du 17/11/2026, soir) : durée = somme des durées des fichiers
      // (bonus compris), débit vidéo = moyenne des fichiers pondérée par leur durée. Un seul fichier décrit : taille ÷ débit
      // mesuré (l'extension ne connaît pas la durée TMDB de la saison sans une requête de plus). Film : durée du fichier (comme l'outil).
      const saison = !o.film && e.f.nf > 1 && e.f.dtot > 0;
      const f = saison ? { ...e.f, video: f0video(e.f), videoMesure: "moyenne" } : e.f;
      const duree = o.film ? (f.duree || o.runtime || 120) : saison ? f.dtot : (dureeParDebit(f, e.taille) || f.duree || null);
      const avi = f.conteneur ? /^AVI/i.test(f.conteneur) : AVI_TITRE.test(e.nom || "");
      const pleinCadre = !!f.pleinCadre || PLEIN_CADRE.test(e.nom || "");
      const j = duree > 0 && e.taille > 0 ? V2.juger({ ...f, taille: e.taille, duree, avi, pleinCadre, source: V2.sourceDe(e.nom) }, PROFIL.r, ctx.I, ctx) : null;
      if (!j) { RESULTATS.set(l.hash, { type: "inconnue" }); continue; }
      j.plein = pleinCadre; j.source = V2.sourceDe(e.nom);
      const nManque = j.crit.filter((c) => !c.ok && !c.poids).length, auDessus = j.crit.some((c) => !c.ok && c.poids);
      const couleur = auDessus ? "r" : nManque === 0 ? "v" : nManque === 1 ? "j" : "g";
      RESULTATS.set(l.hash, { type: "note", j, f, e, ctx, note: Math.round(j.globale), couleur, saison, duree });
    }
    // étoile : la meilleure note parmi les versions dans le profil (vertes)
    if (!PRET) return;
    const vertes = [...RESULTATS.values()].filter((x) => x.type === "note" && x.couleur === "v");
    const maxi = vertes.length ? Math.max(...vertes.map((x) => x.note)) : null;
    for (const x of vertes) x.etoile = x.note === maxi;
  }

  // ---------- affichage ----------
  const CSS = `
:host{all:initial;font-family:system-ui,'Segoe UI',sans-serif;font-size:14px;line-height:1.35;
  --v-f:#064e3b;--v-t:#6ee7b7;--v-b:#10b981;--j-f:#453606;--j-t:#fde68a;--j-b:#eab308;--r-f:#4c1414;--r-t:#fecaca;--r-b:#ef4444;--g-f:#16211d;--g-t:#c5d5cc;--g-b:#3a5248;
  --fond:#0d1915;--bord:#2c4a3f;--texte:#e5efe9;--doux:#a3b3ab;--lien:#34d399;--trait:#1f3b31;--anneau:#22d3ee;--c1:#16302a;--c2:#2a5a4d;--ombre:rgba(0,0,0,.6)}
:host([data-theme=clair]){--v-f:#d1fae5;--v-t:#065f46;--v-b:#10b981;--j-f:#fef3c7;--j-t:#854d0e;--j-b:#d9a406;--r-f:#fee2e2;--r-t:#991b1b;--r-b:#ef4444;--g-f:#eef2f0;--g-t:#44524c;--g-b:#b6c4bd;
  --fond:#ffffff;--bord:#cfdad4;--texte:#14201b;--doux:#5b6b64;--lien:#047857;--trait:#e2e9e5;--anneau:#0891b2;--c1:#dfe9e4;--c2:#f3f7f5;--ombre:rgba(15,23,42,.22)}
*{box-sizing:border-box}
.poste{position:absolute;left:0;top:0;display:flex;align-items:center;gap:8px;white-space:nowrap;pointer-events:auto}
.poste[hidden]{display:none}
.enligne{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.p{font:inherit;width:46px;height:26px;padding:0;border-radius:13px;font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;cursor:pointer;border:1px solid var(--g-b);background:var(--g-f);color:var(--g-t);display:inline-flex;align-items:center;justify-content:center}
.enligne .p{width:40px;height:22px;border-radius:11px;font-size:13px}
.p.v{background:var(--v-f);color:var(--v-t);border-color:var(--v-b)}
.p.j{background:var(--j-f);color:var(--j-t);border-color:var(--j-b)}
.p.r{background:var(--r-f);color:var(--r-t);border-color:var(--r-b)}
.p.sans{border-style:dashed;font-weight:500;color:var(--doux)}
.p.bonus{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--doux)}
.enligne .p.bonus{font-size:10px}
.p.att{border-color:transparent;cursor:progress;background:linear-gradient(90deg,var(--c1) 25%,var(--c2) 50%,var(--c1) 75%);background-size:200% 100%;animation:lueur 1.4s linear infinite}
.p:focus-visible,.p.ouvert{outline:none;box-shadow:0 0 0 2px var(--fond),0 0 0 4px var(--anneau)}
@keyframes lueur{0%{background-position:200% 0}100%{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.p.att{animation:none}}
.etoile{width:16px;height:16px;flex:none;fill:#fbbf24}
.enligne .etoile{width:13px;height:13px}
.bulle{position:absolute;left:0;top:0;width:300px;max-height:min(70vh,560px);overflow:auto;z-index:2;pointer-events:auto;background:var(--fond);border:1px solid var(--bord);border-radius:10px;box-shadow:0 12px 32px var(--ombre);padding:14px 16px;display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--texte);text-align:left}
.bulle.large{width:360px}
.bulle[hidden]{display:none}
.tete{display:flex;align-items:baseline;gap:10px}
.tete b{font-size:26px;font-weight:800}
.tete b.v{color:var(--v-t)}.tete b.j{color:var(--j-t)}.tete b.r{color:var(--r-t)}.tete b.g{color:var(--g-t)}
.tete .sur{color:var(--doux)}.tete .profil{margin-left:auto;font-size:12px;color:var(--doux);text-align:right}
.manque{color:var(--j-t)}
:host([data-theme=clair]) .manque{color:#92400e}
.info{color:var(--doux);font-size:12px}
.info.mention{margin:0 0 4px}
.plus{font:inherit;font-size:13px;min-height:32px;padding:0;border:0;background:none;color:var(--lien);text-align:left;cursor:pointer}
.plus:focus-visible{outline:2px solid var(--anneau);outline-offset:2px;border-radius:4px}
.detail{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--trait);padding-top:10px}
.detail h5{margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--doux)}
.detail ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.detail li{display:flex;justify-content:space-between;gap:12px;font-size:12px}
.detail li span:last-child{flex:none;font-variant-numeric:tabular-nums;color:var(--doux)}
.detail li.total{font-weight:700;border-top:1px solid var(--trait);padding-top:3px}
.detail li.total span:last-child{color:var(--texte)}
.detail li.non span:first-child{color:var(--j-t)}
:host([data-theme=clair]) .detail li.non span:first-child{color:#92400e}
.detail li.retenue span:first-child{font-weight:600}
.detail li.barre span:first-child{text-decoration:line-through;color:var(--doux)}
.reessayer{font:inherit;font-size:12px;align-self:flex-start;padding:4px 10px;border-radius:6px;border:1px solid var(--bord);background:none;color:var(--texte);cursor:pointer}
`;
  const el = (tag, cls, texte) => { const x = document.createElement(tag); if (cls) x.className = cls; if (texte != null) x.textContent = texte; return x; };
  const ETOILE = () => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "etoile"); s.setAttribute("role", "img"); s.setAttribute("aria-label", "Meilleure note parmi les versions dans ton profil");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9z");
    const t = document.createElementNS("http://www.w3.org/2000/svg", "title"); t.textContent = "Meilleure note parmi les versions dans ton profil";
    s.append(t, p); s.style.display = "none";   // (un élément SVG n'a pas de propriété « hidden »)
    return s;
  };

  let calque = null, racineCalque = null, bulle = null;
  let OUVERTE = null;   // { hash, epingle, detail }
  let minuteurSortie = null;
  function sombre() {
    const lum = (e) => { const m = (getComputedStyle(e).backgroundColor || "").match(/[\d.]+/g); if (!m || (m.length > 3 && Number(m[3]) === 0)) return null; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const l = lum(document.body) ?? lum(document.documentElement);
    if (l != null) return l < 0.5;
    return document.documentElement.classList.contains("dark") || matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function creerCalque() {
    if (calque && calque.isConnected) return;
    calque = el("div"); calque.id = "notes-c411-calque";
    calque.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:30;pointer-events:none";
    racineCalque = calque.attachShadow({ mode: "open" });
    racineCalque.append(el("style", "", CSS));
    bulle = el("div", "bulle"); bulle.setAttribute("role", "dialog"); bulle.setAttribute("aria-label", "Résumé de la note"); bulle.hidden = true;
    bulle.addEventListener("mouseenter", () => clearTimeout(minuteurSortie));
    bulle.addEventListener("mouseleave", () => { if (OUVERTE && !OUVERTE.epingle) fermer(); });
    racineCalque.append(bulle);
    document.body.append(calque);
    // les postes déjà créés (calque retiré par la page) sont remis en place par placer()
  }
  function creerPoste(l) {
    l.racine = el("span", "poste");
    l.bouton = el("button", "p att"); l.bouton.type = "button";
    l.etoile = ETOILE();
    l.racine.append(l.bouton, l.etoile);
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    l.bouton.addEventListener("click", (e) => { stop(e); clic(l.hash); });
    l.bouton.addEventListener("mousedown", (e) => e.stopPropagation());
    l.bouton.addEventListener("mouseenter", () => { clearTimeout(minuteurSortie); if (!OUVERTE || !OUVERTE.epingle) ouvrir(l.hash, false); });
    l.bouton.addEventListener("mouseleave", () => { if (OUVERTE && !OUVERTE.epingle) { clearTimeout(minuteurSortie); minuteurSortie = setTimeout(fermer, 220); } });
    l.bouton.addEventListener("keydown", (e) => { if (e.key === "Escape") fermer(); });
  }
  function retirerLigne(l) {
    if (l.racine) l.racine.remove();
    if (l.hote) l.hote.remove();
    if (OUVERTE && OUVERTE.hash === l.hash) fermer();
  }

  // bulle
  function ouvrir(hash, epingle) {
    const x = RESULTATS.get(hash);
    if (!x && PRET) return;
    OUVERTE = { hash, epingle, detail: OUVERTE && OUVERTE.hash === hash ? OUVERTE.detail : false };
    dessinerBulle(); placer();
  }
  function fermer() {
    clearTimeout(minuteurSortie);
    OUVERTE = null;
    if (bulle) bulle.hidden = true;
    for (const l of P.values()) if (l.bouton) { l.bouton.classList.remove("ouvert"); l.bouton.setAttribute("aria-expanded", "false"); }
  }
  function clic(hash) {
    if (OUVERTE && OUVERTE.hash === hash && OUVERTE.epingle) fermer();
    else ouvrir(hash, true);
  }
  const li = (a, b, cls) => { const x = el("li", cls || ""); x.append(el("span", "", a), el("span", "", b)); return x; };
  function detailDe(x) {
    const { j, f, ctx, e, saison, duree } = x, NV = j.NV, d = el("div", "detail");
    const fv = { ...f, ...(j.plein ? { pleinCadre: true } : {}), source: j.source };
    const sans = (s) => { const n = V2.noteVideo(fv, { ...ctx, sans: s }); return n ? n.note : NV.note; };
    const bloc = (titre, lignes, info, avant) => { const b = el("div"); b.append(el("h5", "", titre)); if (avant) b.append(el("div", "info mention", avant)); const u = el("ul"); u.append(...lignes); b.append(u); if (info) b.append(el("div", "info", info)); return b; };
    const LP = NV.pousse ? V2.lignesPoussee(fv, ctx, NV) : null;   // notation poussée : lignes en plus et mention des paramètres
    // vidéo
    const v = [];
    v.push(li(`Débit vidéo ${f.videoMesure === "estime" ? "déduit du débit global" : f.videoMesure === "etiquette" ? "affiché par MediaInfo" : f.videoMesure === "bdinfo" ? "lu par BDInfo" : f.videoMesure === "moyenne" ? `moyen des ${f.nf} fichiers` : "mesuré (taille de la piste)"}`, `${nb(f.video, 2)} Mb/s`));
    v.push(li(`${f.w} × ${f.h || "?"}${f.par ? ` anamorphique (affiché en ${V2.largeurAffichee(f)} × ${f.h})` : ""} : classe ${NV.cls}p, maximum ${nb(NV.maxi, 0)}${NV.maxi < Note.MAXI[NV.cls] - 0.5 ? ` (image ${NV.cls}p incomplète : ${Note.MAXI[NV.cls]} pour une image complète)` : ""}`, ""));
    if (NV.fC !== 1) v.push(li(`Codec ${f.codec} (${fx(NV.fC)})`, pt(NV.note - sans({ codec: true }))));
    if (NV.fB !== 1) v.push(li("10 bits (× 1,05)", pt(NV.note - sans({ bits: true }))));
    if (NV.ef) v.push(li(`Effort de l'encodeur : ${NV.ef} (${fx(NV.fE)})`, pt(NV.note - sans({ effort: true }))));
    else if (!LP) v.push(li("Réglages d'encodage absents : effort compté × 1", ""));
    if (NV.fM !== 1) v.push(li("Encodeur matériel (× 0,7)", pt(NV.note - sans({ materiel: true }))));
    const bandes = NV.note - sans({ pixels: true });
    if (Math.abs(bandes) >= 0.5) v.push(li(`Bandes noires non comptées (image du film ${nb(ctx.aspect, 2)}:1)`, pt(bandes)));
    if (j.plein) v.push(li("IMAX / Open Matte : image pleine, toute l'image compte", ""));
    if (NV.fA !== 1) v.push(li(LP ? `Animation : × ${nb(NV.fA, 1)} sur le débit demandé (mesuré à CRF égal)` : "Animation : moitié moins de débit demandé", pt(NV.note - sans({ anim: true }))));
    if (LP) for (const l of LP.lignes) v.push(li(l.lib, l.pts != null && Math.abs(l.pts) >= 0.05 ? pt(l.pts) : ""));
    v.push(li("Note vidéo", nb(NV.note, 0), "total"));
    const reg = f.reglages ? [f.reglages.mode, f.reglages.psyrd ? `psy-rd ${f.reglages.psyrd}` : "", f.reglages.aq ? `aq ${f.reglages.aq}` : "", f.reglages.sao ? `SAO ${f.reglages.sao}` : ""].filter(Boolean).join(" · ") : "";
    const infoV = [f.lib ? f.lib.split(":")[0] : "", reg, saison ? `saison de ${f.nf} fichiers : durée totale ${hm(duree)}` : f.nf > 1 ? `torrent de ${f.nf} fichiers : le plus long sert à la note` : ""].filter(Boolean).join(" · ");
    // audio
    const a = j.pistes.map((p) => {
      const nom = `${V2.LANG[p.langue] || p.langue || "?"} ${p.type === "sans perte" ? (p.format || p.brut).replace(/^Dolby /, "") : p.type} ${p.canaux ? (p.canaux >= 8 ? "7.1" : p.canaux >= 6 ? "5.1" : p.canaux === 2 ? "2.0" : p.canaux + " can.") : ""}${p.type !== "sans perte" ? " " + kb(p.debit) : ""}${p.role ? ` (${p.role === "AD" ? "audiodescription" : "commentaire"})` : p.ignoree ? " (ton appareil ne lit pas le DTS)" : ""}`;
      return li(nom, p.role ? "écartée" : p.ignoree ? "ignorée" : nb(p.note, 0), p.role || p.ignoree ? "barre" : p === j.retenue ? "retenue" : "");
    });
    if (!a.length) a.push(li("Aucune piste connue", ""));
    a.push(li("Note audio", nb(j.NA, 0), "total"));
    const stx = V2.sousTitres(f);
    // note globale
    const n = [];
    n.push(li(`Vidéo ${nb(NV.note, 0)} ÷ idéal ${nb(ctx.I.video, 0)} → ${nb(j.pv * 100, 0)} % × ${nb(j.wv * 100, 0)} %`, nb(100 * j.wv * j.pv, 1)));
    n.push(li(`Audio ${nb(j.NA, 0)} ÷ idéal ${nb(ctx.I.audio, 0)} → ${nb(j.pa * 100, 0)} % × ${nb(j.wa * 100, 0)} %`, nb(100 * j.wa * j.pa, 1)));
    n.push(li(`Poids ${j.goh ? nb(j.goh, 2) + " Go/h" : "?"} : ${j.poidsLib}`, fx(j.fPoids)));
    for (const c of j.crit.filter((c) => !c.ok && !c.poids)) n.push(li(`${c.lib} (${c.detail})`, fx(c.f), "non"));
    n.push(li("Note globale", nb(j.globale, 0), "total"));
    d.append(bloc(LP ? "Vidéo (notation poussée)" : "Vidéo", v, infoV, LP ? LP.mention : ""), bloc("Audio", a, stx ? `Sous-titres : ${stx.texte}` : ""), bloc(`Note (profil ${PROFIL.affiche})`, n, e.approx ? "Taille lue sur la page (arrondie) : la note peut différer d'un point." : ""));
    return d;
  }
  function dessinerBulle() {
    if (!OUVERTE || !bulle) return;
    const x = RESULTATS.get(OUVERTE.hash), l = P.get(OUVERTE.hash);
    bulle.replaceChildren();
    bulle.classList.remove("large");
    for (const p of P.values()) if (p.bouton) { p.bouton.classList.toggle("ouvert", p.hash === OUVERTE.hash && OUVERTE.epingle); p.bouton.setAttribute("aria-expanded", String(p.hash === OUVERTE.hash)); }
    if (!x) {
      const lus = [...P.values()].filter((p) => FICHES.has(p.hash) || ERREURS.has(p.hash)).length;
      bulle.append(el("div", "", `Lecture des fiches C411 : ${lus} / ${P.size}`), el("div", "info", MODE === "pousse" ? "Notation poussée : les notes s'affichent quand toutes les fiches sont lues (la difficulté du film se mesure sur l'ensemble de ses versions). Une fiche lue est gardée en mémoire : la prochaine visite est immédiate."
        : FORMAT_CONNU ? "Cette note s'affiche dès que sa fiche est lue. Une fiche lue est gardée en mémoire : la prochaine visite est immédiate."
        : "Les notes s'affichent dès que le format de l'image du film est connu (première version sans bandes noires lue), puis au fil de la lecture. Une fiche lue est gardée en mémoire : la prochaine visite est immédiate."));
    } else if (x.type === "note") {
      const tete = el("div", "tete");
      tete.append(el("b", x.couleur, String(x.note)), el("span", "sur", "/ 100"), el("span", "profil", `profil « ${PROFIL.affiche} »${x.j.NV.pousse ? " · poussée" : ""}`));
      bulle.append(tete);
      const sn = el("div"); sn.append("vidéo ", el("b", "", nb(x.j.NV.note, 0)), " · audio ", el("b", "", nb(x.j.NA, 0)));
      bulle.append(sn);
      const manque = x.j.crit.filter((c) => !c.ok).map((c) => c.lib);
      if (manque.length) bulle.append(el("div", "manque", `Manque : ${manque.join(", ")}`));
      const Pp = x.j.NV.pousse;
      if (Pp) bulle.append(el("div", "info", Pp.source === "verifies" ? "Paramètres vérifiés" : Pp.source === "non publies" ? "Paramètres non publiés : note sur un encodage moyen" : `${x.j.source} : flux d'origine`));
      const plus = el("button", "plus", `${OUVERTE.detail ? "▾" : "▸"} Pourquoi cette note ?`); plus.type = "button"; plus.setAttribute("aria-expanded", String(!!OUVERTE.detail));
      plus.addEventListener("click", (e) => { e.stopPropagation(); OUVERTE.detail = !OUVERTE.detail; OUVERTE.epingle = true; dessinerBulle(); placer(); });
      bulle.append(plus);
      if (OUVERTE.detail) { bulle.classList.add("large"); bulle.append(detailDe(x)); }
    } else if (x.type === "sans") {
      bulle.append(el("div", "", "Pas de note pour cette version"), el("div", "info", x.raison === "illisible" ? "Le MediaInfo de la fiche n'a pas pu être lu." : x.raison === "inconnue" ? "C411 ne trouve plus cette fiche." : "La fiche n'a pas de MediaInfo : sans lui, rien ne se mesure (l'extension n'affiche pas de note estimée)."));
    } else if (x.type === "bonus") {
      bulle.append(el("div", "", "Bonus seuls, sans le film"), el("div", "info", `${x.f.nf > 1 ? `${x.f.nf} fichiers, le plus long dure` : "Le fichier dure"} ${hm(x.f.duree)}, le film ${hm(x.film.min)} (d'après ${x.film.source}). Sans le film, cette version n'est pas notée.`));
    } else if (x.type === "inconnue") {
      bulle.append(el("div", "", "Note inconnue"), el("div", "info", "Durée ou débit vidéo absents du MediaInfo de la fiche."));
    } else {
      bulle.append(el("div", "", "Fiche non lue"), el("div", "info", x.message));
      const b = el("button", "reessayer", "Réessayer"); b.type = "button";
      b.addEventListener("click", (e) => { e.stopPropagation(); ERREURS.clear(); fermer(); planifier(0); });
      bulle.append(b);
    }
    bulle.hidden = false;
    void l;
  }

  function dessiner() {
    const lus = [...P.values()].filter((p) => FICHES.has(p.hash) || ERREURS.has(p.hash)).length;
    for (const l of P.values()) {
      if (!l.bouton) creerPoste(l);
      const b = l.bouton, x = RESULTATS.get(l.hash);
      b.className = "p";
      l.etoile.style.display = "none";
      if (!x) { b.classList.add("att"); b.textContent = ""; b.setAttribute("aria-label", `Note en cours de lecture (${lus} fiches lues sur ${P.size})`); }
      else if (x.type === "note") { b.classList.add(x.couleur); b.textContent = String(x.note); b.setAttribute("aria-label", `Note ${x.note} sur 100, voir le détail`); l.etoile.style.display = x.etoile ? "" : "none"; }
      else if (x.type === "bonus") { b.classList.add("bonus"); b.textContent = "Bonus"; b.setAttribute("aria-label", "Bonus seuls, sans le film : pas de note, voir pourquoi"); }
      else if (x.type === "erreur") { b.classList.add("sans"); b.textContent = "!"; b.setAttribute("aria-label", "Fiche non lue, voir pourquoi"); }
      else { b.classList.add("sans"); b.textContent = x.type === "inconnue" ? "?" : "–"; b.setAttribute("aria-label", "Pas de note pour cette version, voir pourquoi"); }
    }
    if (OUVERTE) { if (P.has(OUVERTE.hash)) dessinerBulle(); else fermer(); }
  }

  // géométrie : marge de droite assez large -> notes dans la marge ; sinon dans la ligne
  function coupee(e, r) {
    for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowY === "visible" && s.overflowX === "visible") continue;
      const a = p.getBoundingClientRect(), milieu = r.top + r.height / 2;
      if (milieu < a.top || milieu > a.bottom) return true;
    }
    return false;
  }
  function hoteDe(l) {
    if (l.hote) return l.hote;
    l.hote = el("span", "notes-c411-hote");
    l.hote.style.cssText = "display:inline-flex;align-items:center;flex:none;vertical-align:middle";
    const s = l.hote.attachShadow({ mode: "open" });
    s.append(el("style", "", CSS));
    return l.hote;
  }
  // dans la ligne : juste avant le code du type de fichier (« PURE-UHD-REMUX »), sinon avant le dernier élément (la taille)
  function pointInsertion(l) {
    const feuilles = [...l.el.querySelectorAll("*")].filter((x) => !x.children.length && !x.closest(".notes-c411-hote"));
    const codes = feuilles.filter((x) => /^[A-Z0-9]{2,}(?:-[A-Z0-9]+)+$/.test((x.textContent || "").trim()));
    const cible = codes[codes.length - 1];
    if (cible) return { parent: cible.parentElement, avant: cible };
    const conteneur = l.lien || l.el, enfants = [...conteneur.children].filter((c) => !aNous(c));
    return { parent: conteneur, avant: enfants[enfants.length - 1] || null };
  }
  // Bas des éléments fixes ou collants posés en haut de l'écran (plusieurs empilés : on descend de l'un à l'autre)
  function basDesBandeaux(cw, droite) {
    let y = 0;
    const xs = [Math.round(cw / 2), Math.min(cw - 4, Math.round(droite + 40)), Math.round(cw * 0.25)];
    for (let tour = 0; tour < 4; tour++) {
      let bas = y;
      for (const x of xs) {
        for (const e of document.elementsFromPoint(x, y + 1)) {
          if (aNous(e) || e === calque) continue;
          for (let p = e; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
            const pos = getComputedStyle(p).position;
            if (pos !== "fixed" && pos !== "sticky") continue;
            const r = p.getBoundingClientRect();
            if (r.top <= y + 2 && r.bottom > bas && r.height < innerHeight * 0.4) bas = r.bottom;
            break;
          }
        }
      }
      if (bas <= y) break;
      y = bas;
    }
    return y;
  }
  let enAttentePlacement = false;
  function planPlacer() { if (enAttentePlacement) return; enAttentePlacement = true; requestAnimationFrame(() => { enAttentePlacement = false; placer(); }); }
  function placer() {
    if (!P.size || !BLOC || !BLOC.isConnected) { if (calque) calque.style.display = "none"; return; }
    creerCalque();
    calque.style.display = "";
    const theme = sombre() ? "sombre" : "clair";
    calque.setAttribute("data-theme", theme);
    const cw = document.documentElement.clientWidth, zr = BLOC.getBoundingClientRect();
    let droite = zr.right;
    for (let p = BLOC.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const r = p.getBoundingClientRect();
      if (r.width >= cw * 0.98 || r.right >= cw - 8 || r.right <= droite) continue;
      const s = getComputedStyle(p), fond = s.backgroundColor || "";
      if (parseFloat(s.borderRightWidth) > 0 || (fond && !/rgba\(.*,\s*0\)|transparent/.test(fond))) droite = r.right;   // le bord de la carte centrale
    }
    ETROIT = cw - droite < 96;
    const o = calque.getBoundingClientRect();
    // bandeaux fixes ou collants du haut (barre de C411, barre d'actions de la fiche) : rien de l'extension ne passe dessus
    const haut = basDesBandeaux(cw, droite);
    calque.style.width = "0px"; calque.style.height = "0px";   // mesurer la page sans le calque (sinon il l'empêcherait de raccourcir)
    const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), docW = document.documentElement.scrollWidth;
    calque.style.width = docW + "px"; calque.style.height = docH + "px";
    calque.style.clipPath = haut > 0 ? `inset(${Math.max(0, Math.round(haut - o.top))}px 0 0 0)` : "";
    for (const l of P.values()) {
      if (!l.bouton) continue;
      const r = l.el.getBoundingClientRect();
      const visible = l.el.isConnected && r.width > 0 && r.height > 0 && !coupee(l.el, r);
      l.rect = r; l.visible = visible;
      if (ETROIT) {
        const h = hoteDe(l);
        h.setAttribute("data-theme", theme);
        l.racine.className = "enligne"; l.racine.style.transform = ""; l.racine.hidden = false;
        if (l.racine.parentNode !== h.shadowRoot) h.shadowRoot.append(l.racine);
        if (!h.isConnected || !l.el.contains(h)) { const pi = pointInsertion(l); try { pi.parent.insertBefore(h, pi.avant); } catch (e) { (l.lien || l.el).append(h); } }
      } else {
        if (l.hote && l.hote.isConnected) l.hote.remove();
        l.racine.className = "poste";
        if (l.racine.parentNode !== racineCalque) racineCalque.insertBefore(l.racine, bulle);
        l.racine.hidden = !visible;
        if (visible) l.racine.style.transform = `translate(${Math.round(droite + 14 - o.left)}px, ${Math.round(r.top + r.height / 2 - 13 - o.top)}px)`;
      }
    }
    if (OUVERTE && bulle && !bulle.hidden) {
      const l = P.get(OUVERTE.hash);
      if (!l || !l.visible) { fermer(); return; }
      const largeur = bulle.offsetWidth || 300;
      const x = Math.max(8, Math.min(zr.right - largeur, cw - largeur - 8));
      bulle.style.transform = `translate(${Math.round(x - o.left)}px, ${Math.round(l.rect.bottom + 8 - o.top)}px)`;
    }
  }
  function maj() { calculer(); dessiner(); placer(); }

  // ---------- suivi de la page (application sans rechargement) ----------
  function nettoyer() {
    for (const l of P.values()) retirerLigne(l);
    P.clear(); BLOC = null; PAGE = null; file = []; RESULTATS = new Map(); PRET = false;
    fermer();
    if (calque) calque.style.display = "none";
  }
  let enPasse = false, aRefaire = false;
  async function passe() {
    if (enPasse) { aRefaire = true; return; }
    enPasse = true;
    try {
      const h = hashPage();
      if (!h) { nettoyer(); return; }
      if (PAGE !== h) { nettoyer(); PAGE = h; ERREURS.clear(); DIAG.requetesPage = {}; DIAG.fichesVues = (DIAG.fichesVues || 0) + 1; }
      const lignes = trouverLignes(h);
      const voulues = new Set(lignes.map((l) => l.hash));
      for (const [k, l] of P) if (!voulues.has(k)) { retirerLigne(l); P.delete(k); }
      for (const l of lignes) {
        const a = P.get(l.hash);
        if (a) { if (a.el !== l.el) { if (a.hote) { a.hote.remove(); } a.el = l.el; } a.lien = l.lien; a.courante = l.courante; }
        else P.set(l.hash, l);
      }
      const inconnues = lignes.map((l) => l.hash).filter((k) => !FICHES.has(k) && !CHERCHEES.has(k));
      if (inconnues.length) {
        const v = await stock.lire(inconnues.map((k) => "f:" + k));
        for (const k of inconnues) { CHERCHEES.add(k); const e = v["f:" + k]; if (valable(e)) FICHES.set(k, e); }
      }
      if (hashPage() !== h) { aRefaire = true; return; }
      demander([...P.values()]);
      maj();
    } catch (e) { if (DIAG.erreurs.length < 5) DIAG.erreurs.push("passe : " + (e && e.message)); }
    finally { enPasse = false; if (aRefaire) { aRefaire = false; planifier(50); } }
  }
  let minuteur = null;
  function planifier(ms = 150) { clearTimeout(minuteur); minuteur = setTimeout(passe, ms); }

  function demarrer() {
    new MutationObserver((liste) => {
      for (const m of liste) {
        if (aNous(m.target) || (m.target.closest && m.target.closest(".notes-c411-hote"))) continue;
        const noeuds = [...m.addedNodes, ...m.removedNodes];
        if (noeuds.length && noeuds.every(aNous)) continue;
        planifier(); return;
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "open", "hidden"] });
    let adresse = location.href;
    setInterval(() => { if (location.href !== adresse) { adresse = location.href; planifier(0); } }, 700);
    addEventListener("scroll", planPlacer, { capture: true, passive: true });
    addEventListener("resize", planPlacer, { passive: true });
    document.addEventListener("mousedown", (e) => {
      if (!OUVERTE) return;
      const chemin = e.composedPath ? e.composedPath() : [];
      if (chemin.includes(bulle) || chemin.some((n) => n && n.classList && n.classList.contains("p"))) return;
      fermer();
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && OUVERTE) fermer(); }, true);
    try {
      chrome.storage.onChanged.addListener((ch, zone) => {
        if (zone !== "local") return;
        const v = {};
        if (ch.profil) v.profil = ch.profil.newValue;
        if (ch.equipement) v.equipement = ch.equipement.newValue;
        if (ch.notation) v.notation = ch.notation.newValue;
        if (ch.profil || ch.equipement || ch.notation) { reglages(v); maj(); }
        // mémoire vidée depuis la fenêtre de l'extension : tout est relu
        const vides = Object.keys(ch).filter((k) => k.startsWith("f:") && ch[k].newValue === undefined);
        if (vides.length) { for (const k of vides) { FICHES.delete(k.slice(2)); CHERCHEES.delete(k.slice(2)); } planifier(0); }
      });
      chrome.runtime.onMessage.addListener((msg, _de, repondre) => {
        if (msg && msg.type === "notes-c411-diagnostic") repondre({ texte: diagnostic() });
        return false;
      });
    } catch (e) { /* extension rechargée : la page continue avec ce qu'elle a */ }
    stock.lire(["profil", "equipement", "notation"]).then((v) => { reglages({ profil: v.profil, equipement: v.equipement, notation: v.notation }); planifier(0); });
  }

  // Diagnostic : rien de personnel (ni jeton, ni cookie, ni contenu des fiches), seulement des noms de champs et des comptes
  function diagnostic() {
    const etats = {};
    for (const x of RESULTATS.values()) compte(etats, x.type === "note" ? "note " + x.couleur : x.type);
    const manifeste = (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return "?"; } })();
    return [
      `ReleaseScore ${manifeste} — diagnostic`,
      `page : ${hashPage() ? "fiche" : "autre"} ; fenêtre ${document.documentElement.clientWidth} px ; mode ${ETROIT ? "dans la ligne" : "marge"} ; thème ${sombre() ? "sombre" : "clair"}`,
      `titre « Versions » : ${DIAG.titre ? "trouvé" : "NON trouvé"} ; ${DIAG.structure}`,
      `fiches : ${[...P.keys()].filter((k) => FICHES.has(k)).length} lues sur ${P.size}, ${ERREURS.size} en erreur, prêt : ${PRET ? "oui" : "non"}`,
      `résultats : ${JSON.stringify(etats)}`,
      `requêtes pour cette fiche : ${JSON.stringify(DIAG.requetesPage)} ; depuis l'ouverture de l'onglet (${DIAG.fichesVues || 0} fiche(s) affichée(s)) : ${JSON.stringify(DIAG.requetes)} ; attentes 429 : ${DIAG.attentes429} ; lecture de la fiche refusée : ${ficheRefusee ? "oui" : "non"}`,
      `MediaInfo lu dans : ${JSON.stringify(DIAG.sources)}`,
      `champs de la fiche : ${DIAG.clesFiche || "(pas de réponse)"}`,
      `champs de metadata : ${DIAG.clesMeta || "(aucun)"}`,
      `champs de tmdbData : ${DIAG.clesTmdb || "(aucun)"}`,
      `aperçu tmdbData : ${DIAG.apercuTmdb || "(pas de réponse)"}`,
      `champs de /mediainfo : ${DIAG.clesMediainfo || "(pas demandé)"}`,
      `profil : ${PROFIL.affiche} ; notation : ${MODE}${MODE === "pousse" ? ` (difficulté ${(() => { const x = [...RESULTATS.values()].find((r) => r.type === "note"); return x && x.ctx.D ? `${x.ctx.D.D.toFixed(2)} sur ${x.ctx.D.n} version(s) en CRF` : "?"; })()})` : ""} ; œuvre : ${JSON.stringify(P.size ? oeuvre([...P.values()]) : {})}`,
      `erreurs : ${DIAG.erreurs.join(" | ") || "aucune"}`,
    ].join("\n");
  }

  if (document.body) demarrer(); else addEventListener("DOMContentLoaded", demarrer);
})();
