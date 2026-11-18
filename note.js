// note.js — notes des fichiers vidéo (notation v2, validée le 08/11/2026), communes au serveur (require("./note.js").v2)
// et aux pages (<script src="/note.js"> → Note.v2).
// D'abord les FAITS (note vidéo, note audio : identiques pour tout le monde), ensuite TES PRÉFÉRENCES (profil : note globale).
// L'ancienne note (qualité brute, facteur de source) a été retirée lors de la refonte (08/11/2026).
// Deux modes depuis le 18/11/2026 : « rapide » (la note v2) et « poussée » (o.mode = "pousse" : paramètres d'encodage publiés et
// difficulté du film en plus ; voir NOTATION POUSSÉE plus bas). Les deux : débit demandé en r^0,5 au-dessus du 1080p (facteurPixels).
// Copie exacte dans l'extension ReleaseScore (moteur/note.js).

(function (racine) {
  const MAXI = { 2160: 95, 1080: 85, 720: 45, 576: 32, 480: 28 }; // maximum de la note vidéo par classe de résolution

  // =====================================================================================================================
  // NOUVELLE NOTATION (v2, validée le 08/11/2026) : d'abord les FAITS (note vidéo, note audio, identiques pour tout le monde),
  // ensuite TES PRÉFÉRENCES (profil : note globale). Moteur de claude/moteur-notes-v2.js, avec trois ajouts :
  //   - le format de l'image du film (« aspect ») est un paramètre, déduit des versions recadrées de la même œuvre (aspectOeuvre) ;
  //   - l'animation demande moitié moins de débit (× 0,5 sur k, comme la qualité brute ci-dessus) ;
  //   - le DTS-HD MA écrit « DTS ES XLL » est reconnu, et le DTS:X compte comme l'Atmos (+4).
  // Ajouts du 08/11/2026 (soir) : profil « 1080p Haute qualité » ; version IMAX / Open Matte (v.pleinCadre, d'après son nom) :
  // image pleine à format variable, ses bandes noires éventuelles ne sont pas retirées (elle n'est pas comptée au format du film).
  // Pas de facteur de source ici (choix du 08/11 : la note v2 ne garde que ce qui se mesure).
  // Lot 4b (10/11/2026) : profils de base neutres. Les critères « Dolby Vision sans HDR10 » et « Fichier AVI » ont le choix
  // « Selon ton équipement » (auto, par défaut) : refusé si l'équipement ne le lit pas, déconseillé (× 0,9) s'il n'est pas
  // renseigné, accepté s'il le lit. Deux critères d'équipement s'ajoutent, sans réglage de profil : vidéo AV1 refusée (× 0,5)
  // si l'appareil ne la décode pas ; pistes DTS ignorées dans la note audio si l'appareil ne les lit pas.
  // L'équipement vient du questionnaire « Ton équipement » (configuration/reglages.json), donné par V2.equipement({...}).
  // Lot VOSTFR (11/11/2026) : réglage « Langue » : « VO requise » (piste dans la langue originale de l'œuvre, o.vo ; œuvre française :
  // ses pistes françaises) ; nouveau réglage « Sous-titres français » (indifférents, préférés × 0,9, requis × 0,7), d'après v.st :
  // seuls les sous-titres français complets comptent (pas les forcés, qui ne traduisent que les passages en langue étrangère).
  // Sous-titres inconnus (v.st absent : version estimée, fiche lue avant ce lot, base du NAS pas encore mise à jour) : pas pénalisé.
  // Profils de base : « Indifférents » (aucune note ne change) ; un profil enregistré avant ce lot (sans « st ») compte comme indifférent.
  // Fichiers anamorphiques (12/11/2026, Brice de Nice TRUNKDU92 : 1440 × 1036 affiché en 1916 × 1036) : v.par = rapport des
  // pixels (largeur affichée ÷ largeur stockée), lu dans le MediaInfo (« Display aspect ratio »). La classe (et le critère de
  // résolution) suit la largeur AFFICHÉE ; la note maximale suit les PIXELS RÉELS : entre le maximum de la classe du dessous et
  // celui de la classe, en proportion des pixels utiles (choix « C » du 12/11) ; une image complète (97 % des pixels ou plus)
  // garde le maximum de sa classe. Les bandes noires d'un fichier anamorphique se calculent sur sa largeur affichée.
  // Films plus étroits que 16:9 (12/11/2026, Alice au pays des merveilles 1951, 4:3) : classe aussi d'après la hauteur
  // (1440 × 1080 = 1080p), format du film déduit des versions étroites, bandes noires sur les côtés retirées des pixels utiles.
  // Faits d'une version (lecteur-mediainfo.js, ou estimation d'après le titre) :
  //   { w, h, par (anamorphique seulement), bits, hdr, codec, video (Mb/s), lib, enc, pistes: [{ format, brut, canaux, debit (kb/s), langue, role }], st: [{ langue, force, sdh }] }
  // =====================================================================================================================
  const V2 = (function () {
    const P1080 = 1920 * 1080;
    const classe = (w) => (w >= 3000 ? 2160 : w >= 1700 ? 1080 : w >= 1200 ? 720 : 576);
    const CODEC = { "H.264": 1, "H.265": 1.6, "AV1": 2, "XviD": 0.7 };
    const EFFORT = { fast: 0.92, medium: 1, slow: 1.06, "slow+": 1.08, slower: 1.1, veryslow: 1.12, placebo: 1.13 };
    function effort(v) {
      const e = v.enc; if (!e) return null;
      // réglages sans aucun indice d'effort (SVT-AV1, ou seulement le mode de débit) : effort inconnu (comme avant la lecture « l 7 »)
      if (["subme", "ref", "bframes", "me", "trellis", "rd", "rcla"].every((k) => e[k] == null)) return null;
      if (/x264/i.test(v.lib || "") || e.trellis != null) {
        if (e.subme >= 11) return "placebo"; if (e.subme >= 10 && e.me >= 2) return "veryslow"; if (e.subme >= 9) return "slower";
        if (e.subme >= 8) return "slow"; if (e.subme >= 7) return "medium"; return "fast";
      }
      if (e.subme >= 5 || e.me >= 4) return "placebo"; if (e.rd >= 6 && e.subme >= 4) return "veryslow"; if (e.subme >= 4) return "slower";
      if (e.rd >= 4 && e.me >= 3) return (e.ref >= 5 || e.bframes >= 8 || e.rcla >= 40) ? "slow+" : "slow";
      if (e.rd >= 3 && e.subme >= 2) return "medium"; return "fast";
    }
    const materiel = (v) => /nvenc|qsv|quick ?sync|amf|vce|videotoolbox/i.test(v.lib || "");
    // Débit demandé selon les pixels utiles (r = pixels ÷ ceux d'un 1080p) : r^0,75 jusqu'au 1080p, r^0,5 au-dessus
    // (décision du 18/11/2026, les deux modes : une 4K demande 2 × le débit d'un 1080p, et non 2,83 × ; mesuré à CRF égal sur
    // 88 versions x265 : 1,9 ×). Sous le 1080p, rien ne change.
    const facteurPixels = (r) => (r <= 1 ? Math.pow(r, 0.75) : Math.pow(r, 0.5));
    // pixels utiles (stockés) : les bandes noires ne comptent pas (aspect = format de l'image du film) : en haut et en bas
    // (film plus large que l'image), ou sur les côtés (film plus étroit, 4:3 : 12/11/2026) ;
    // anamorphique (par : rapport des pixels) : calcul sur la largeur affichée
    function pixelsUtiles(w, h, aspect, par = 1) {
      const a = aspect || 16 / 9, p = par > 0 ? par : 1, hh = h || w;
      return Math.min(w, Math.round(hh * a / p)) * Math.min(hh, Math.round(w * p / a));
    }
    // classe d'un fichier : d'après sa largeur affichée (anamorphique : largeur stockée × par), ou sa hauteur pour une image
    // plus étroite que 16:9 (film 4:3 en 1440 × 1080 : 1080p ; 12/11/2026, Alice au pays des merveilles 1951)
    const largeurAffichee = (v) => Math.round((v.w || 0) * (v.par > 0 ? v.par : 1));
    const classeDe = (v) => classe(Math.max(largeurAffichee(v), Math.round((v.h || 0) * 16 / 9)));
    // note maximale d'après les pixels réels : image complète de la classe (97 % des pixels ou plus) = maximum de la classe ;
    // moins de pixels : entre le maximum de la classe du dessous (à son image complète) et celui de la classe
    const CADRES = { 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] }, DESSOUS = { 1080: 720, 2160: 1080 };
    function maxiDe(cls, utiles, aspect, plein) {
      const bas = DESSOUS[cls];
      if (!bas || !(utiles > 0)) return MAXI[cls];
      const cadre = (c) => (plein ? CADRES[c][0] * CADRES[c][1] : pixelsUtiles(CADRES[c][0], CADRES[c][1], aspect));
      const haut = cadre(cls) * 0.97, b = cadre(bas);
      if (utiles >= haut) return MAXI[cls];
      if (utiles <= b) return MAXI[bas];
      return MAXI[bas] + (MAXI[cls] - MAXI[bas]) * (utiles - b) / (haut - b);
    }
    // =================================================================================================================
    // NOTATION POUSSÉE (18/11/2026 ; analyse : claude/notation-poussee.md). Mode rapide = la note ci-dessus, inchangée ;
    // le mode poussé (o.mode === "pousse") tient compte en plus des paramètres d'encodage publiés (ligne « Encoding settings »
    // du MediaInfo, rien d'autre) et de la difficulté du film. Note toujours sur 100, sans dépasser le maximum de la classe.
    //   - Paramètres absents ou effacés : ni bonus ni malus (encodage moyen : effort moyen observé, détail neutre).
    //   - Remux, BDMV, WEB-DL (« WEB » dans le nom, règle de nommage de C411) non ré-encodés : neutres (c'est la source).
    //   - Effets de réglages appliqués au DÉBIT UTILE, jamais à la note : un encodage ne peut pas passer devant sa source.
    // Calage (collecte du 18/11 : 741 versions de 41 films ; 88 versions x265 en CRF de 36 films ; refait avec l'exposant 0,5) :
    //   pente 0,145 par point de CRF (le débit double tous les 4,8 points) ; à CRF égal : SAO coupé × 1,30, preset medium ou
    //   plus rapide × 0,86 ; 4K / 1080p avec l'exposant 0,5 : × 0,89 ± 0,12 (non significatif) ; animation : 0,89 × le débit d'un
    //   film en prises de vues réelles (6 films, 14 versions), d'où × 0,9 en mode poussé (le mode rapide garde × 0,5).
    const POUSSE = {
      PENTE: 0.145, CRF0: 22, REF: 1.2888,   // REF : ln du débit (Mb/s) d'un 1080p utile à CRF 22, moyenne des 30 films en prises de vues réelles
      SAO_COUPE: 1.30, MEDIUM: 0.86, POIDS: 2.5, DMIN: 0.6, DMAX: 1.6, ANIM: 0.9,
      EFFORT_INCONNU: { "H.265": 1.05, "H.264": 1.09 },             // moyenne des encodages qui publient leurs réglages (x265 130, x264 111)
      MODE: { crf: 1, "2pass": 1, abr: 0.9, cbr: 0.85, cqp: 1 },
      SOURCE: { "WEBRip": 0.93, "HDTV": 0.85 },                       // BluRay, REMUX, BDMV, WEB-DL : 1
      DETAIL: 0.12, SOMBRE: 1.02, MAXFALL_SOMBRE: 120,
    };
    // Source d'après le nom de la release (ou du fichier) : REMUX, BDMV, WEB-DL (« WEB » seul = WEB-DL chez C411), WEBRip, HDTV ; null = encodage
    function sourceDe(nom) {
      const t = " " + String(nom || "").toUpperCase().replace(/[._()\[\]+-]+/g, " ") + " ";
      if (/\sREMUX\s/.test(t)) return "REMUX";
      if (/\s(BDMV|ISO|COMPLETE BLURAY)\s/.test(t)) return "BDMV";
      if (/\sWEB ?RIP\s/.test(t)) return "WEBRip";
      if (/\s(WEB|WEB ?DL)\s/.test(t)) return "WEB-DL";
      if (/\s(HDTV|PDTV)\s/.test(t)) return "HDTV";
      return null;
    }
    const nonReencode = (v) => !v.enc && ["REMUX", "BDMV", "WEB-DL"].includes(v.source);
    // paramètres « publiés » : une ligne de réglages lue (mode de débit, ou indices d'effort)
    const publies = (v) => !!(v.enc && (v.enc.rc || effort(v)));
    function modeDebit(v) {
      const e = v.enc; if (!e || !e.rc) return null;
      const f = POUSSE.MODE[e.rc] ?? 1;
      const lib = e.rc === "crf" ? `CRF ${String(e.crf ?? "?").replace(".", ",")}` : e.rc === "2pass" ? `2 passes${e.br ? ` à ${Math.round(e.br).toLocaleString("fr-FR")} kb/s` : ""}`
        : e.rc === "abr" ? "1 passe (débit moyen visé)" : e.rc === "cbr" ? "débit constant (CBR)" : "quantificateur constant (CQP)";
      return { f, lib };
    }
    function vbv(v) {
      const e = v.enc; if (!e || !(e.vbv > 0) || !(v.video > 0)) return 1;
      const r = e.vbv / 1000 / v.video;
      return r < 1.5 ? 0.92 : r < 2.5 ? 0.97 : 1;
    }
    // réglages qui gardent ou lissent le détail fin (grain, textures) : score de -0,5 à +0,5
    function detail(v) {
      const e = v.enc; if (!e) return { s: 0, lignes: [] };
      let s = 0; const L = [];
      const add = (x, t) => { s += x; L.push({ x, t }); };
      const x264 = /x264/i.test(v.lib || "") || e.trellis != null;
      if (e.db === -99) add(0.25, "deblock coupé");
      else if (e.db != null) { if (e.db <= -4) add(0.25, "deblock très abaissé"); else if (e.db <= -2) add(0.15, "deblock abaissé"); else if (e.db > 0) add(-0.15, "deblock renforcé"); }
      if (e.aqm === 0) add(-0.2, "aq coupé");
      if (x264) {
        if (e.psy === false || (e.psyrd != null && e.psyrd < 0.5)) add(-0.3, "psy-rd coupé (lisse)");
        if (e.psytr > 0) add(0.05, "psy-trellis");
      } else {
        if (e.sao === false) add(0.25, "SAO coupé (garde le détail fin)"); else if (e.sao === true) add(-0.25, "SAO actif (lisse le détail fin)");
        if (e.psyrd != null && e.psyrd < 0.5) add(-0.3, "psy-rd coupé (lisse)");
        if (e.psyrdoq >= 2) add(0.2, "psy-rdoq élevé (garde le grain)"); else if (e.psyrdoq >= 1) add(0.1, "psy-rdoq actif"); else if (e.psyrdoq === 0) add(-0.05, "psy-rdoq coupé");
        if (e.sis === true) add(-0.05, "strong-intra-smoothing");
      }
      return { s: Math.max(-0.5, Math.min(0.5, s)), lignes: L };
    }
    const estSombre = (v) => !!v.hdr && v.hdr !== "SDR" && v.maxfall > 0 && v.maxfall < POUSSE.MAXFALL_SOMBRE;
    // Difficulté du film (D) : d'après ses versions x265 en CRF. Débit ramené à une image 1080p utile et à CRF 22, corrigé des
    // réglages qui changent le débit à CRF égal ; moyenne comparée à celle des films de la collecte, rapprochée de 1 quand il y a
    // peu de versions (poids n / (n + 2,5) : 1 version 29 %, 3 versions 55 %, 10 versions 80 %), bornée à 0,6 – 1,6.
    // faits : faits des versions de l'œuvre (pleinCadre : IMAX / Open Matte) ; o : { aspect, anim }. -> { D, n, rel } ou { D: 1, n: 0 }
    function difficulte(faits, o = {}) {
      const vus = new Set(), z = [];
      for (const f of faits || []) {
        const e = f && f.enc;
        if (!e || e.rc !== "crf" || !(e.crf > 0) || !/x265/i.test(f.lib || "") || !(f.video > 0) || !(f.w > 0) || f.estime) continue;
        const cle = `${f.w}x${f.h}|${f.video}|${e.crf}`;   // même fichier vu deux fois (ta version et sa fiche C411)
        if (vus.has(cle)) continue; vus.add(cle);
        const utiles = f.pleinCadre ? f.w * (f.h || f.w * 9 / 16) : pixelsUtiles(f.w, f.h, o.aspect, f.par);
        const ef = effort(f);
        let y = Math.log(f.video / (facteurPixels(utiles / P1080) * (o.anim ? POUSSE.ANIM : 1))) + POUSSE.PENTE * (e.crf - POUSSE.CRF0);
        if (e.sao === false) y -= Math.log(POUSSE.SAO_COUPE);
        if (ef === "medium" || ef === "fast") y -= Math.log(POUSSE.MEDIUM);
        z.push(y);
      }
      if (!z.length) return { D: 1, n: 0, rel: null };
      const n = z.length, rel = Math.exp(z.reduce((a, b) => a + b, 0) / n - POUSSE.REF);
      return { D: Math.min(POUSSE.DMAX, Math.max(POUSSE.DMIN, Math.pow(rel, n / (n + POUSSE.POIDS)))), n, rel };
    }

    // o : { aspect, anim, mode ("pousse"), D ({ D, n } : difficulte()), sans: { pixels, bits, effort, materiel, codec, anim,
    //       + mode poussé : debit, vbv, source, detail, sombre, difficulte } } (« sans » sert à « Pourquoi cette note ? »)
    // Mode poussé : v.source (sourceDe du nom de la release ou du fichier), v.maxfall (lecteur « l 7 »).
    function noteVideo(v, o = {}) {
      const sans = o.sans || {};
      if (!(v.video > 0) || !(v.w > 0)) return null;
      const pousse = o.mode === "pousse";
      // plein cadre (IMAX / Open Matte : format variable, l'image remplit le cadre) : tous les pixels comptent
      const cls = classeDe(v), tous = v.w * (v.h || v.w * 9 / 16);
      const utiles = v.pleinCadre ? tous : pixelsUtiles(v.w, v.h, o.aspect, v.par);
      const pix = sans.pixels ? tous : utiles, maxi = maxiDe(cls, utiles, o.aspect, v.pleinCadre);
      const fC = sans.codec ? 1 : (CODEC[v.codec] || 1), fB = !sans.bits && v.bits >= 10 ? 1.05 : 1;
      const ef = effort(v), fM = !sans.materiel && materiel(v) ? 0.7 : 1;
      if (!pousse) {
        const fE = !sans.effort && ef ? EFFORT[ef] : 1;
        const fA = o.anim && !sans.anim ? 0.5 : 1;
        const eff = v.video * fC * fB * fE * fM, k = 4 * facteurPixels(pix / P1080) * fA;
        return { note: maxi * (1 - Math.exp(-eff / k)), cls, maxi, pix, fC, fB, fE, ef, fM, fA, eff, k };
      }
      // ---- mode poussé ----
      const source = nonReencode(v) ? "non ré-encodée" : publies(v) ? "verifies" : "non publies";
      const fE = sans.effort ? 1 : ef ? EFFORT[ef] : nonReencode(v) || materiel(v) ? 1 : (POUSSE.EFFORT_INCONNU[v.codec] || 1);
      const md = modeDebit(v), fMd = !sans.debit && md ? md.f : 1, fV = sans.vbv ? 1 : vbv(v);
      const fS = sans.source ? 1 : (POUSSE.SOURCE[v.source] || 1);
      const fA = o.anim && !sans.anim ? POUSSE.ANIM : 1;
      const D = !sans.difficulte && o.D && o.D.D > 0 ? o.D.D : 1;
      const k = 4 * facteurPixels(pix / P1080) * fA * D;
      const eff0 = v.video * fC * fB * fE * fM * fMd * fV * fS;
      const base = maxi * (1 - Math.exp(-eff0 / k));
      // les réglages du détail ne comptent qu'avec assez de débit : 0 sous 60 % du maximum, tout au-dessus de 90 % (à bas débit,
      // lisser est un choix défendable)
      const poidsDetail = Math.max(0, Math.min(1, (base / maxi - 0.6) / 0.3));
      const d = detail(v), fD = sans.detail ? 1 : 1 + POUSSE.DETAIL * d.s * poidsDetail;
      const sombre = estSombre(v), fSom = !sans.sombre && sombre && v.enc && v.enc.aqm === 3 ? POUSSE.SOMBRE : 1;
      const eff = eff0 * fD * fSom;
      return { note: maxi * (1 - Math.exp(-eff / k)), cls, maxi, pix, fC, fB, fE, ef, fM, fA, eff, k,
        pousse: { source, md, fMd, fV, fS, D, Dn: o.D ? o.D.n : 0, base, poidsDetail, d, fD, sombre, fSom } };
    }
    // Lignes de « Pourquoi cette note ? » propres au mode poussé, pour les trois pages (Rechercher, Ma bibliothèque, extension) :
    // [{ lib, pts (effet sur la note vidéo, en points ; null = rien à chiffrer) }] et la mention des paramètres.
    function lignesPoussee(v, o, NV) {
      const P = NV && NV.pousse; if (!P) return null;
      const sans = (s) => { const n = noteVideo(v, { ...o, sans: s }); return n ? NV.note - n.note : 0; };
      const nb2 = (x) => Number(x).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
      const L = [];
      if (!NV.ef) L.push(P.source === "non ré-encodée" ? { lib: `${v.source} non ré-encodé : effort compté × 1 (c'est la source)`, pts: null }
        : materiel(v) ? { lib: "Encodeur matériel : effort compté × 1", pts: null }
        : POUSSE.EFFORT_INCONNU[v.codec] ? { lib: `Effort inconnu : moyenne des encodages ${v.codec === "H.265" ? "x265" : "x264"} (× ${nb2(NV.fE)})`, pts: sans({ effort: true }) }
        : { lib: `Effort inconnu (aucune moyenne mesurée en ${v.codec || "ce codec"}) : compté × 1`, pts: null });
      if (P.md) L.push({ lib: `Mode de débit : ${P.md.lib}${P.fMd !== 1 ? ` (× ${nb2(P.fMd)})` : ""}`, pts: P.fMd !== 1 ? sans({ debit: true }) : null });
      if (P.fV !== 1) L.push({ lib: `Plafond VBV serré : ${Math.round(v.enc.vbv).toLocaleString("fr-FR")} kb/s (× ${nb2(P.fV)})`, pts: sans({ vbv: true }) });
      if (P.fS !== 1) L.push({ lib: `Source ${v.source} (× ${nb2(P.fS)})`, pts: sans({ source: true }) });
      L.push(P.Dn > 0 ? { lib: `Difficulté du film : ${nb2(P.D)} (${P.Dn} version${P.Dn > 1 ? "s" : ""} x265 en CRF)`, pts: sans({ difficulte: true }) }
        : { lib: "Difficulté du film inconnue (aucune version x265 en CRF) : comptée 1", pts: null });
      if (P.d.lignes.length) {
        const t = P.d.lignes.map((x) => `${x.x > 0 ? "+" : "−"}${nb2(Math.abs(x.x))} ${x.t}`).join(", ");
        L.push(P.poidsDetail > 0 ? { lib: `Détail : ${t} (× ${nb2(P.fD)}${P.poidsDetail < 1 ? `, effet réduit de ${Math.round(100 - 100 * P.poidsDetail)} % : débit juste` : ""})`, pts: sans({ detail: true }) }
          : { lib: `Détail : ${t} (sans effet : débit trop bas pour le détail fin)`, pts: null });
      }
      if (P.fSom !== 1) L.push({ lib: `Film sombre (HDR, MaxFALL ${Math.round(v.maxfall)} cd/m²) et aq-mode 3 (× ${nb2(P.fSom)})`, pts: sans({ sombre: true }) });
      const mention = P.source === "verifies" ? "Paramètres vérifiés : la note tient compte des réglages publiés dans le MediaInfo."
        : P.source === "non publies" ? "Paramètres non publiés — note calculée sur un encodage moyen : elle peut sous-estimer ou surestimer cette version."
        : `${v.source} : flux d'origine, sans réglages d'encodage à juger.`;
      return { lignes: L, mention, verifies: P.source === "verifies" };
    }
    // débit courant d'une piste dont le débit est inconnu (kb/s, par type)
    const DEBIT_TYPIQUE = { "E-AC3": 640, AC3: 448, DTS: 1509, AAC: 192, "HE-AAC": 128, Opus: 192, "?": 384 };
    function notePiste(p) {
      const f = (String(p.format || "") + " " + String(p.brut || "")).toLowerCase(), ch = p.canaux || 2;
      const fCan = ch >= 8 ? 1.03 : ch >= 6 ? 1 : ch >= 2 ? 0.75 : 0.6;
      let n, type;
      if (/truehd|mlp|dts-hd master|xll|flac|pcm/.test(f)) { n = 92 + (/atmos|mlp fba|dts:x|xll x/.test(f) ? 4 : 0); type = "sans perte"; }
      else {
        const T = /plus|e-ac-3|eac3/.test(f) ? [84, 45, "E-AC3"] : /dolby digital|ac-3|ac3/.test(f) ? [76, 55, "AC3"] : /dts/.test(f) ? [84, 110, "DTS"]
          : /he-aac|sbr/.test(f) ? [72, 22, "HE-AAC"] : /aac/.test(f) ? [82, 40, "AAC"] : /opus/.test(f) ? [84, 30, "Opus"] : [70, 60, "?"];
        const d = p.debit > 0 ? p.debit : DEBIT_TYPIQUE[T[2]];
        n = T[0] * (1 - Math.exp(-(d / ch) / T[1])) + (/joc|atmos/.test(f) || (T[2] === "E-AC3" && d >= 768) ? 3 : 0); type = T[2];
      }
      return { note: Math.min(100, n * fCan), type };
    }
    const LANG = { vff: "VFF", vfq: "VFQ", vfb: "VFB", vo: "VO", autre: "autre" };

    // ---------- Équipement de l'installation (questionnaire « Ton équipement ») ----------
    // { dv, avi, av1, dts } : "oui" (lu), "non" (pas lu) ou null (non renseigné). Sans appel : rien de renseigné.
    let EQ = { dv: null, avi: null, av1: null, dts: null };
    const ouiNon = (x) => (x === "oui" || x === "non" ? x : null);
    function equipement(e) {
      if (e !== undefined) EQ = { dv: ouiNon(e && e.dv), avi: ouiNon(e && e.avi), av1: ouiNon(e && e.av1), dts: ouiNon(e && e.dts) };
      return EQ;
    }
    // Réglage « Selon ton équipement » des critères « dv » et « avi » : ce qu'il donne chez toi, et pourquoi.
    // -> { v: "refuse" | "deconseille" | "ok", texte (pour la liste du profil), detail (pour « Pourquoi cette note ? ») }
    const SELON = {
      dv: { non: ["refuse", "refusé (ton écran ne lit pas le DV)", "ton écran ne lit pas le DV"], oui: ["ok", "accepté (ton écran lit le DV)", ""],
        inconnu: ["deconseille", "déconseillé × 0,9 (écran non renseigné)", "écran non renseigné"] },
      avi: { non: ["refuse", "refusé (ton appareil ne lit pas les .avi)", "ton appareil ne lit pas les .avi"], oui: ["ok", "accepté (ton appareil lit les .avi)", ""],
        inconnu: ["deconseille", "déconseillé × 0,9 (appareil non renseigné)", "appareil non renseigné"] },
    };
    function selon(k) { const x = SELON[k][EQ[k] || "inconnu"]; return { v: x[0], texte: x[1], detail: x[2] }; }
    // Valeur appliquée d'un critère « dv » ou « avi » du profil r (auto = selon l'équipement ; valeur inconnue = auto)
    function applique(k, r) {
      const v = r[k];
      if (v === "refuse" || v === "deconseille" || v === "ok") return { v, detail: "" };
      return selon(k);
    }
    // Sous-titres d'une version : null si inconnus ; sinon { fr (sous-titres français complets), texte (« français (SDH), anglais »…) }
    const NOMS_ST = { fr: "français", en: "anglais", es: "espagnol", it: "italien", de: "allemand", ja: "japonais", ko: "coréen", zh: "chinois", pt: "portugais", nl: "néerlandais", ru: "russe", ar: "arabe" };
    function sousTitres(v) {
      if (!v || !Array.isArray(v.st)) return null;
      const fr = v.st.filter((x) => x.langue === "fr");
      const complets = fr.filter((x) => !x.force);
      const lfr = complets.length ? `français${complets.some((x) => x.sdh) && complets.some((x) => !x.sdh) ? " (dont SDH)" : complets.every((x) => x.sdh) ? " (SDH)" : ""}`
        : fr.length ? "français forcés seulement" : "";
      const autres = [...new Set(v.st.filter((x) => x.langue !== "fr" && !x.force).map((x) => NOMS_ST[x.langue] || x.langue))];
      const liste = [lfr, ...autres.slice(0, 3)].filter(Boolean);
      return { fr: complets.length > 0, texte: liste.length ? liste.join(", ") + (autres.length > 3 ? ` et ${autres.length - 3} autres` : "") : "aucun" };
    }
    const estDts = (p) => /dts|xll/i.test(String(p.format || "") + " " + String(p.brut || ""));

    const PROFILS = {
      "HDLight 1080p": { res: "1080", basse: "penal", hdr: "sdr-pref", dv: "auto", avi: "auto", codec: "pref", langue: "vff", st: "indiff", audio: "correct", poidsAudio: 15, cible: 2, plafond: 2.5 },
      "1080p Haute qualité": { res: "1080", basse: "penal", hdr: "sdr-pref", dv: "auto", avi: "auto", codec: "pref", langue: "vff", st: "indiff", audio: "bon", poidsAudio: 20, cible: 4, plafond: 6 },
      "4KLight": { res: "2160", basse: "penal", hdr: "indiff", dv: "auto", avi: "auto", codec: "pref", langue: "vff", st: "indiff", audio: "bon", poidsAudio: 20, cible: 5, plafond: 6 },
      "4K HDR cinéma": { res: "2160", basse: "penal", hdr: "requis", dv: "auto", avi: "auto", codec: "indiff", langue: "vff", st: "indiff", audio: "sansperte", poidsAudio: 35, cible: 20, plafond: 40 },
      "Petit fichier": { res: "1080", basse: "ok", hdr: "sdr-pref", dv: "auto", avi: "auto", codec: "pref", langue: "vf", st: "indiff", audio: "correct", poidsAudio: 10, cible: 1, plafond: 1.5 },
      "Qualité maximale": { res: "2160", basse: "penal", hdr: "indiff", dv: "auto", avi: "auto", codec: "indiff", langue: "vff", st: "indiff", audio: "sansperte", poidsAudio: 30, cible: 0, plafond: 0 },
    };
    const CHAMPS = [
      ["res", "Résolution idéale", [["1080", "1080p"], ["2160", "4K (2160p)"]]],
      ["basse", "Résolution plus basse que l'idéale", [["penal", "Pénalisée (×0,6)"], ["ok", "Acceptée (comparée à l'idéal)"]]],
      ["hdr", "HDR", [["sdr-req", "SDR requis (HDR ×0,6)"], ["sdr-pref", "SDR préféré (HDR ×0,9)"], ["indiff", "Indifférent"], ["pref", "HDR préféré (SDR ×0,9)"], ["requis", "HDR requis (SDR ×0,6)"]]],
      ["dv", "Dolby Vision sans HDR10", [["auto", "Selon ton équipement"], ["refuse", "Refusé (×0,5)"], ["deconseille", "Déconseillé (×0,9)"], ["ok", "Accepté"]]],
      ["avi", "Fichier AVI", [["auto", "Selon ton équipement"], ["refuse", "Refusé (note 0)"], ["deconseille", "Déconseillé (×0,9)"], ["ok", "Accepté"]]],
      ["codec", "Codec H.265 / AV1", [["requis", "Requis (H.264 ×0,6)"], ["pref", "Préféré (H.264 ×0,9)"], ["indiff", "Indifférent"]]],
      ["langue", "Langue", [["vff", "VFF requise (sinon ×0,7)"], ["vf", "VF : VFF ou VFQ (sinon ×0,7)"], ["vo", "VO requise (sinon ×0,7)"], ["indiff", "Indifférente"]]],
      ["st", "Sous-titres français", [["indiff", "Indifférents"], ["pref", "Préférés (sinon ×0,9)"], ["requis", "Requis (sinon ×0,7)"]]],
      ["audio", "Audio idéal", [["correct", "Correct : AC3 5.1 ~448 kb/s"], ["bon", "Bon : E-AC3 Atmos 768 kb/s"], ["sansperte", "Sans perte : TrueHD / DTS-HD MA"]]],
      ["poidsAudio", "Importance de l'audio dans la note globale (%)", "nombre", 0, 60, 5],
      ["cible", "Poids cible (Go par heure, 0 = sans limite)", "nombre", 0, 60, 0.5],
      ["plafond", "Poids plafond (Go par heure, 0 = sans limite)", "nombre", 0, 80, 0.5],
    ];
    const AUDIO_IDEAL = { correct: { piste: { format: "Dolby Digital", brut: "AC-3", canaux: 6, debit: 448 }, mbps: 0.9 },
      bon: { piste: { format: "Dolby Digital Plus with Dolby Atmos", brut: "E-AC-3 JOC", canaux: 6, debit: 768 }, mbps: 1.5 },
      sansperte: { piste: { format: "Dolby TrueHD with Dolby Atmos", brut: "MLP FBA", canaux: 8, debit: 3690 }, mbps: 4.5 } };

    // Ton fichier idéal : H.265 10 bits à la cible du profil (moins l'audio de l'idéal), au format du film.
    // Mode poussé : encodé avec de bons paramètres (x265 preset slower, CRF, SAO coupé, deblock abaissé, psy-rdoq actif), sinon
    // le plafond de 100 % de l'idéal effacerait le bonus des versions bien réglées. Même difficulté de film que les versions (o.D).
    const ENC_IDEAL = { subme: 4, me: 3, rd: 4, ref: 5, bframes: 8, rcla: 60, rc: "crf", crf: 20, sao: false, db: -2, psyrd: 2, psyrdoq: 1, aqm: 2, sis: false };
    function ideal(r, o = {}) {
      const audio = AUDIO_IDEAL[r.audio] || AUDIO_IDEAL.correct, a = notePiste(audio.piste).note;
      if (!(r.cible > 0)) return { video: MAXI[+r.res] * 0.99, audio: a, debit: null };
      const w = r.res === "2160" ? 3840 : 1920, h = r.res === "2160" ? 2160 : 1080;
      const debit = Math.max(0.3, r.cible * 8000 / 3600 - audio.mbps);
      const pousse = o.mode === "pousse";
      const v = noteVideo({ w, h, bits: 10, codec: "H.265", video: debit, lib: pousse ? "x265" : "", enc: pousse ? ENC_IDEAL : null }, o).note;
      return { video: v, audio: a, debit };
    }
    const nb = (x, n = 1) => Number(x).toLocaleString("fr-FR", { minimumFractionDigits: n, maximumFractionDigits: n });
    // v : faits + { taille (octets), duree (minutes) } ; r : réglages du profil ; I : ideal(r, o) ; o : { aspect, anim }
    function juger(v, r, I, o = {}) {
      const NV = noteVideo(v, o);
      if (!NV) return null;
      // pistes DTS (DTS, DTS-HD, DTS:X) : ignorées dans la note audio quand l'appareil ne lit pas le DTS (équipement)
      const sansDts = EQ.dts === "non";
      const pistes = (v.pistes || []).map((p) => ({ ...p, ...notePiste(p), ...(sansDts && !p.role && estDts(p) ? { ignoree: true } : {}) }));
      // langue « ? » (estimation d'après un titre sans langue, ou fichier sans langue indiquée) : pas pénalisée, comme avant
      // VO (lot VOSTFR) : piste dans la langue originale (o.vo, langue TMDB) ; œuvre française : ses pistes françaises
      const estVo = (p) => p.langue === "vo" || (o.vo === "fr" && ["vff", "vfq", "vfb"].includes(p.langue));
      const voulues = (p) => !p.role && (p.langue === "?" || (r.langue === "vff" ? p.langue === "vff" : r.langue === "vf" ? ["vff", "vfq"].includes(p.langue) : r.langue === "vo" ? estVo(p) : true));
      const candidates = pistes.filter(voulues);   // sert aussi au critère de langue (pistes DTS comprises : la langue est bien dans le fichier)
      // langue voulue absente : on se rabat sur une autre VF, puis sur la VO (le critère de langue pénalise déjà)
      const lisibles = (l) => l.filter((p) => !p.ignoree);
      const secours = pistes.filter((p) => !p.role && ["vff", "vfq", "vfb"].includes(p.langue));
      const retenue = (lisibles(candidates).length ? lisibles(candidates) : lisibles(secours).length ? lisibles(secours) : lisibles(pistes.filter((p) => !p.role))).slice().sort((a, b) => b.note - a.note)[0] || null;
      const NA = retenue ? retenue.note : 0;
      const heures = (v.duree || 0) / 60, goh = heures > 0 && v.taille > 0 ? v.taille / 1e9 / heures : null;
      const crit = [];
      const ajoute = (ok, lib, f, detail) => crit.push({ ok, lib, f: ok ? 1 : f, detail });
      if (r.basse === "penal") ajoute(NV.cls >= +r.res, `Résolution ${r.res === "2160" ? "4K" : "1080p"} ou plus`, 0.6, NV.cls + "p");
      const estHdr = v.hdr && v.hdr !== "SDR";
      if (r.hdr === "sdr-req") ajoute(!estHdr, "SDR requis", 0.6, v.hdr || "SDR");
      if (r.hdr === "sdr-pref") ajoute(!estHdr, "SDR préféré", 0.9, v.hdr || "SDR");
      if (r.hdr === "requis") ajoute(estHdr, "HDR requis", 0.6, v.hdr || "SDR");
      if (r.hdr === "pref") ajoute(estHdr, "HDR préféré", 0.9, v.hdr || "SDR");   // 17/11/2026 : symétrique de « SDR préféré »
      // Dolby Vision sans HDR10 : refusé (× 0,5), déconseillé (× 0,9) ou accepté, d'après le profil ou, par défaut, l'équipement
      const dv = applique("dv", r);
      if (dv.v !== "ok") ajoute(v.hdr !== "DV seul", "Pas de Dolby Vision seul", dv.v === "refuse" ? 0.5 : 0.9, dv.detail || v.hdr || "SDR");
      // fichier .avi (v.avi est fourni par la page : conteneur du MediaInfo, sinon le titre ou l'extension) : refusé = note 0
      const avi = applique("avi", r);
      if (avi.v !== "ok") ajoute(!v.avi, "Pas de fichier AVI", avi.v === "refuse" ? 0 : 0.9, avi.detail || "AVI");
      // vidéo AV1 : refusée (× 0,5) seulement quand l'équipement dit que l'appareil ne la décode pas
      if (EQ.av1 === "non") ajoute(v.codec !== "AV1", "Pas de vidéo AV1", 0.5, "ton appareil ne décode pas l'AV1");
      if (r.codec !== "indiff") ajoute(v.codec !== "H.264" && v.codec !== "XviD", r.codec === "requis" ? "H.265 / AV1 requis" : "H.265 / AV1 préféré", r.codec === "requis" ? 0.6 : 0.9, v.codec || "?");
      if (r.langue === "vo") ajoute(!!candidates.length, "Piste VO", 0.7,
        [...new Set(pistes.filter((p) => !p.role && LANG[p.langue]).map((p) => LANG[p.langue]))].join(", ") || "aucune");
      else if (r.langue !== "indiff") ajoute(!!candidates.length, r.langue === "vff" ? "Piste VFF" : "Piste VF (VFF ou VFQ)", 0.7,
        [...new Set(pistes.filter((p) => !p.role && LANG[p.langue] && !["vo", "autre"].includes(p.langue)).map((p) => LANG[p.langue]))].join(", ") || "aucune");
      // sous-titres français (lot VOSTFR) : inconnus = pas pénalisé (critère compté comme respecté, marqué « inconnu »)
      if (r.st === "pref" || r.st === "requis") {
        const S = sousTitres(v), lib = r.st === "requis" ? "Sous-titres français requis" : "Sous-titres français préférés";
        if (S) ajoute(S.fr, lib, r.st === "requis" ? 0.7 : 0.9, S.texte);
        else crit.push({ ok: true, lib, f: 1, detail: "pas encore lus", inconnu: true });
      }
      let fPoids = 1, poidsLib = "sans limite";
      if (r.cible > 0 && goh) {
        const pl = Math.max(r.plafond || r.cible, r.cible);
        if (goh <= r.cible) { fPoids = 1; poidsLib = `sous la cible (${nb(r.cible)} Go/h)`; }
        else if (goh <= pl) { fPoids = 1 - 0.15 * (goh - r.cible) / Math.max(0.01, pl - r.cible); poidsLib = `entre cible et plafond (${nb(r.cible)} – ${nb(pl)} Go/h)`; }
        else { fPoids = 0.85 * pl / goh; poidsLib = `au-dessus du plafond (${nb(pl)} Go/h)`; }
        // affiché dans « Manque », sans multiplicateur en plus
        if (goh > pl) crit.push({ ok: false, lib: `plus de ${nb(pl * v.duree / 60, 2)} Go (plafond)`, f: 1, detail: nb(goh, 2) + " Go/h", poids: true });
      }
      const wa = (r.poidsAudio || 0) / 100, wv = 1 - wa;
      const pv = Math.min(1, NV.note / I.video), pa = I.audio > 0 ? Math.min(1, NA / I.audio) : 1;
      const fCrit = crit.reduce((t, c) => t * c.f, 1);
      const globale = 100 * (wv * pv + wa * pa) * fPoids * fCrit;
      return { NV, pistes, retenue, NA, goh, crit, fPoids, poidsLib, wv, wa, pv, pa, fCrit, globale, taille: v.taille };
    }
    // Verdict par rapport à ta version (d = écart de note globale en points, r = rapport de taille)
    function verdict(j, t) {
      if (!j || !t || !(j.taille > 0) || !(t.taille > 0)) return null;
      const d = Math.round(j.globale) - Math.round(t.globale), r = j.taille / t.taille;
      let libelle;
      if (d >= 4) libelle = (d >= 10 ? "Bien meilleur" : "Meilleur") + (r < 0.97 ? ", plus léger" : r > 1.5 ? ", bien plus lourd" : ", plus lourd");
      else if (d >= -3) libelle = r < 0.97 ? (Math.abs(d) < 1 ? "Même note, plus léger" : "Mieux et plus léger") : Math.abs(r - 1) <= 0.03 ? "Équivalente à ta version" : "Même note, plus lourd";
      else if (r <= 0.6 && d >= -14) libelle = "Bien plus léger, un peu moins bon";
      else libelle = "Moins bon";
      // clé de couleur : vert seulement pour « meilleur ou égal ET plus léger »
      const cle = /plus léger/.test(libelle) && d >= -3 && !/moins bon/.test(libelle) ? "top" : d >= 4 ? "mieux" : /Bien plus léger/.test(libelle) ? "leger"
        : /Équivalente/.test(libelle) ? "egale" : libelle === "Moins bon" ? "moins" : "peu";
      return { cle, libelle, d };
    }
    // Format de l'image du film, d'après les versions recadrées (sans bandes noires) : film large = le rapport le plus grand
    // au-dessus de 16:9 (2,76 au plus) ; sinon film étroit (4:3…, 12/11/2026) = le plus grand des rapports sous 1,72
    // (les versions 16:9 ont alors des bandes sur les côtés) ; sinon 16:9.
    function aspectDe(rapports) {
      const l = (rapports || []).filter((r) => r > 0);
      const larges = l.filter((r) => r > 16 / 9 + 0.005), etroits = l.filter((r) => r < 1.72 && r >= 1.2);
      if (larges.length) return Math.min(Math.max(...larges), 2.76);
      if (etroits.length) return Math.max(...etroits);
      return 16 / 9;
    }
    function aspectOeuvre(faits) {
      return aspectDe((faits || []).filter((f) => f && f.w >= 1200 && f.h > 0 && !f.estime).map((f) => largeurAffichee(f) / f.h)); // anamorphique : largeur affichée
    }
    return { classe, classeDe, largeurAffichee, maxiDe, effort, materiel, pixelsUtiles, facteurPixels, noteVideo, notePiste, ideal, juger, verdict, aspectOeuvre, aspectDe, equipement, selon, applique, estDts, sousTitres, PROFILS, CHAMPS, AUDIO_IDEAL, LANG, EFFORT,
      sourceDe, difficulte, lignesPoussee, POUSSE, MODES: [["rapide", "Rapide"], ["pousse", "Poussée"]] };
  })();

  const N = { MAXI, v2: V2 };
  if (typeof module === "object" && module.exports) module.exports = N;
  else racine.Note = N;
})(this);
