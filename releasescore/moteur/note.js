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
  // Lot 4b (10/11/2026) : profils de base neutres ; critères d'équipement venus du questionnaire « Ton équipement »
  // (configuration/reglages.json), donnés par V2.equipement({...}).
  // Lot « Ton équipement » (22/11/2026) : TOUS les critères d'équipement sortent du profil (« Dolby Vision sans HDR10 » et
  // « Fichier AVI » n'y sont plus ; anciens profils enregistrés : ces deux clés sont ignorées). Dix questions, chacune
  // Oui / Non / Je ne sais pas : Dolby Vision seul (dv), profil 7 (dvp7), 3D (d3), AV1 (av1), H.264 10 bits (h10), .avi (avi),
  // DTS (dts), Opus (opus), TrueHD / DTS-HD MA tels quels (hd), sous-titres en image PGS / VobSub (pgs). Voir compatibilite().
  //   « Non » : version × 0,5, badge rouge ; « Je ne sais pas » : × 0,9, badge orange « ? » ; sauf la 3D (« Je ne sais pas » = « Non »).
  //   Le facteur compte UNE fois par version (× 0,5 si au moins un « Non », sinon × 0,9 si au moins un « Je ne sais pas »).
  //   Audio : une piste que l'appareil ne lit pas est ignorée dans la note audio (comme le DTS avant) ; la version n'est
  //   touchée que si AUCUNE piste de la langue voulue n'est lisible. DTS-HD MA non transmis tel quel : son cœur DTS compte.
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
  //   { w, h, par (anamorphique seulement), bits, hdr, dvp (profil Dolby Vision), d3 (3D), codec, video (Mb/s), lib, enc,
  //     pistes: [{ format, brut, canaux, debit (kb/s), langue, role }], st: [{ langue, force, sdh, img ("pgs" | "vobsub" : sous-titres en image) }] }
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
        const T = /plus|e-ac-3|eac3/.test(f) ? [84, 45, "E-AC3"] : /dolby digital|ac-3|ac3/.test(f) ? [76, 55, "AC3"] : /dts/.test(f) ? [84, 70, "DTS"]
          : /he-aac|sbr/.test(f) ? [72, 22, "HE-AAC"] : /aac/.test(f) ? [82, 40, "AAC"] : /opus/.test(f) ? [84, 30, "Opus"] : [70, 60, "?"];
        const d = p.debit > 0 ? p.debit : DEBIT_TYPIQUE[T[2]];
        n = T[0] * (1 - Math.exp(-(d / ch) / T[1])) + (/joc|atmos/.test(f) || (T[2] === "E-AC3" && d >= 768) ? 3 : 0); type = T[2];
      }
      return { note: Math.min(100, n * fCan), type };
    }
    const LANG = { vff: "VFF", vfq: "VFQ", vfb: "VFB", vo: "VO", autre: "autre" };

    // ---------- Équipement de l'installation (questionnaire « Ton équipement », 22/11/2026) ----------
    // Chaque clé : "oui" (lu sans conversion), "non" (pas lu) ou null (je ne sais pas). Sans appel : rien de renseigné.
    // court : badge (« ? » ajouté pour « Je ne sais pas ») ; non / doute : texte de « Manque » et de « Pourquoi cette note ? ».
    const EQUIPEMENT = {
      dv: { court: "DV seul", non: "Dolby Vision seul non lu par ton écran", doute: "Dolby Vision seul à vérifier", titre: "Dolby Vision sans HDR10 : couleurs fausses (vert / violet) sur un écran qui ne lit pas le Dolby Vision" },
      dvp7: { court: "DV P7", non: "Dolby Vision profil 7 non lu", doute: "Dolby Vision profil 7 à vérifier", titre: "Dolby Vision profil 7 (double couche des remux UHD) : non lu, l'image s'affiche en HDR10 seulement, ou avec des couleurs fausses selon l'appareil" },
      d3: { court: "3D", non: "3D non lue par ton écran", doute: "3D (écran non renseigné : comptée « Non »)", titre: "Version 3D (côte à côte, dessus-dessous, Blu-ray 3D) : les télés récentes ne la lisent plus" },
      av1: { court: "AV1", non: "AV1 non décodé par ton appareil", doute: "AV1 à vérifier", titre: "Vidéo AV1" },
      h10: { court: "H.264 10 bits", non: "H.264 10 bits non décodé par ton appareil", doute: "H.264 10 bits à vérifier", titre: "Vidéo H.264 en 10 bits (Hi10P, surtout les animés) : peu d'appareils la décodent eux-mêmes" },
      avi: { court: "AVI", non: "fichier .avi non lu par ton appareil", doute: "fichier .avi à vérifier", titre: "Fichier .avi : compatibilité limitée selon les appareils" },
      dts: { court: "DTS", non: "DTS non lu par ton appareil", doute: "DTS à vérifier", titre: "Audio DTS" },
      opus: { court: "Opus", non: "Opus non lu par ton appareil", doute: "Opus à vérifier", titre: "Audio Opus" },
      hd: { court: "TrueHD", non: "TrueHD non transmis tel quel", doute: "TrueHD tel quel à vérifier", titre: "Audio sans perte (TrueHD, DTS-HD MA) transmis tel quel à la barre de son ou à l'ampli (HDMI eARC)" },
      pgs: { court: "PGS", non: "sous-titres en image (PGS) non lus sans conversion", doute: "sous-titres en image (PGS) à vérifier", titre: "Sous-titres en image (PGS, VobSub) : avec Plex, les afficher (même les forcés) fait convertir toute la vidéo ; les sous-titres en texte (SRT, ASS) n'ont pas ce problème" },
    };
    const CLES_EQ = Object.keys(EQUIPEMENT);
    let EQ = Object.fromEntries(CLES_EQ.map((k) => [k, null]));
    const ouiNon = (x) => (x === "oui" || x === "non" ? x : null);
    function equipement(e) {
      if (e !== undefined) EQ = Object.fromEntries(CLES_EQ.map((k) => [k, ouiNon(e && e[k])]));
      return EQ;
    }
    // 3D d'après le nom de la release (22/11/2026) : SBS, H-OU, MVC, BD3D… ; « 3D » seul ne compte pas quand il est dans le titre
    // de l'œuvre (Piranha 3D). titres : titres de l'œuvre ; inconnus (extension, ancienne fiche) : « 3D » seul ne compte pas.
    const MOTS_3D_FORTS = /(^|[^A-Z0-9])(H[ ._-]?SBS|HALF[ ._-]?SBS|SBS|H[ ._-]?OU|HALF[ ._-]?OU|H[ ._-]?TAB|MVC|BD3D|3D[ ._-]?BLU[ ._-]?RAY)([^A-Z0-9]|$)/i;
    const MOT_3D = /(^|[^A-Z0-9])3D([^A-Z0-9]|$)/i;
    function est3D(nom, titres) {
      const t = String(nom || "");
      if (MOTS_3D_FORTS.test(t)) return true;
      return MOT_3D.test(t) && Array.isArray(titres) && titres.length > 0 && !titres.some((x) => MOT_3D.test(x || ""));
    }
    // Lisibilité d'une piste audio : 2 = lue, 1 = je ne sais pas, 0 = pas lue ; k = la question qui décide ; core : DTS-HD MA
    // non transmis tel quel mais son cœur DTS lu (la piste compte comme un DTS de 1 509 kb/s)
    const niveau = (k) => (EQ[k] === "oui" ? 2 : EQ[k] === "non" ? 0 : 1);
    function lisibilite(p) {
      const f = (String(p.format || "") + " " + String(p.brut || "")).toLowerCase();
      if (/truehd|mlp/.test(f)) return { n: niveau("hd"), k: "hd", nom: "TrueHD" };
      if (/xll|dts-hd master|dts:x/.test(f)) {
        const hd = niveau("hd"), dts = niveau("dts");
        if (hd === 2) return { n: 2, k: "hd", nom: "DTS-HD MA" };
        if (hd === 0) return { n: dts, k: "dts", nom: "DTS-HD MA", core: dts > 0 };
        return dts === 2 ? { n: 2 } : { n: 1, k: "hd", nom: "DTS-HD MA" };   // tel quel : je ne sais pas ; le cœur DTS lu suffit
      }
      if (/dts/.test(f)) return { n: niveau("dts"), k: "dts", nom: "DTS" };
      if (/opus/.test(f)) return { n: niveau("opus"), k: "opus", nom: "Opus" };
      return { n: 2 };
    }
    // Sous-titres en image gênants (pgs) : français forcés seulement en image (affichés d'office avec la VF), ou français complets
    // seulement en image quand ils sont lus (profil « Sous-titres français », ou pas de piste française dans la langue retenue).
    // Sous-titres inconnus, ou lus avant le 22/11/2026 (sans « img ») : rien n'est compté.
    function stImage(v, r, sansVf) {
      if (!v || !Array.isArray(v.st) || !v.st.length || !v.st.some((x) => x.img !== undefined)) return null;
      const fr = v.st.filter((x) => x.langue === "fr");
      const seulementImage = (l) => l.length > 0 && l.every((x) => x.img);
      const forces = fr.filter((x) => x.force), complets = fr.filter((x) => !x.force);
      const gene = seulementImage(forces) || ((r.st === "pref" || r.st === "requis" || sansVf) && seulementImage(complets));
      if (!gene) return null;
      return fr.some((x) => x.img === "vobsub") && !fr.some((x) => x.img === "pgs") ? "VobSub" : "PGS";
    }
    // Ce que ton équipement ne lit pas dans une version : { items: [{ k, etat ("non" | "doute"), court, texte, titre }], f }
    // audio : { etat, cles: [clé, nom] } calculé par juger (lisibilité des pistes de la langue voulue)
    function compatibilite(v, r, audio, sansVf) {
      const items = [];
      const ajoute = (k, rep, court, texte) => {
        if (rep === "oui") return;
        const etat = rep === "non" || k === "d3" ? "non" : "doute", D = EQUIPEMENT[k];
        items.push({ k, etat, court: (court || D.court) + (etat === "doute" ? " ?" : ""), texte: texte ? texte[etat] : D[etat], titre: D.titre });
      };
      if (v.hdr === "DV seul") ajoute("dv", EQ.dv);
      else if (v.dvp === 7 && /^DV \+/.test(v.hdr || "") && EQ.dv !== "non") ajoute("dvp7", EQ.dvp7);   // écran sans DV : la couche HDR10 suffit
      if (v.d3) ajoute("d3", EQ.d3);
      if (v.codec === "AV1") ajoute("av1", EQ.av1);
      if (v.codec === "H.264" && v.bits >= 10) ajoute("h10", EQ.h10);
      if (v.avi) ajoute("avi", EQ.avi);
      if (audio && audio.etat !== 2) for (const [k, nom] of audio.cles) ajoute(k, audio.etat === 0 ? "non" : null, nom,
        k === "hd" ? { non: `${nom} non transmis tel quel`, doute: `${nom} tel quel à vérifier` } : { non: `${nom} non lu par ton appareil`, doute: `${nom} à vérifier` });
      const img = stImage(v, r, sansVf);
      if (img) ajoute("pgs", EQ.pgs, img, { non: `sous-titres en image (${img}) non lus sans conversion`, doute: `sous-titres en image (${img}) à vérifier` });
      const f = items.some((x) => x.etat === "non") ? 0.5 : items.length ? 0.9 : 1;
      return { items, f };
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

    const PROFILS = {
      "HDLight 1080p": { res: "1080", basse: "penal", hdr: "sdr-pref", codec: "pref", langue: "vff", st: "indiff", audio: "correct", poidsAudio: 15, cible: 2, plafond: 2.5 },
      "1080p Haute qualité": { res: "1080", basse: "penal", hdr: "sdr-pref", codec: "pref", langue: "vff", st: "indiff", audio: "bon", poidsAudio: 20, cible: 4, plafond: 6 },
      "4KLight": { res: "2160", basse: "penal", hdr: "indiff", codec: "pref", langue: "vff", st: "indiff", audio: "bon", poidsAudio: 20, cible: 5, plafond: 6 },
      "4K HDR cinéma": { res: "2160", basse: "penal", hdr: "requis", codec: "indiff", langue: "vff", st: "indiff", audio: "sansperte", poidsAudio: 35, cible: 20, plafond: 40 },
      "Petit fichier": { res: "1080", basse: "ok", hdr: "sdr-pref", codec: "pref", langue: "vf", st: "indiff", audio: "correct", poidsAudio: 10, cible: 1, plafond: 1.5 },
      "Qualité maximale": { res: "2160", basse: "penal", hdr: "indiff", codec: "indiff", langue: "vff", st: "indiff", audio: "sansperte", poidsAudio: 30, cible: 0, plafond: 0 },
    };
    const CHAMPS = [
      ["res", "Résolution idéale", [["1080", "1080p"], ["2160", "4K (2160p)"]]],
      ["basse", "Résolution plus basse que l'idéale", [["penal", "Pénalisée (×0,6)"], ["ok", "Acceptée (comparée à l'idéal)"]]],
      ["hdr", "HDR", [["sdr-req", "SDR requis (HDR ×0,6)"], ["sdr-pref", "SDR préféré (HDR ×0,9)"], ["indiff", "Indifférent"], ["pref", "HDR préféré (SDR ×0,9)"], ["requis", "HDR requis (SDR ×0,6)"]]],
      ["codec", "Codec H.265 / AV1", [["requis", "Requis (H.264 ×0,6)"], ["pref", "Préféré (H.264 ×0,9)"], ["indiff", "Indifférent"]]],
      ["langue", "Langue", [["vff", "VFF requise (sinon ×0,7)"], ["vf", "VF : VFF ou VFQ (sinon ×0,7)"], ["vo", "VO requise (sinon ×0,7)"], ["indiff", "Indifférente"]]],
      ["st", "Sous-titres français", [["indiff", "Indifférents"], ["pref", "Préférés (sinon ×0,9)"], ["requis", "Requis (sinon ×0,7)"]]],
      ["audio", "Audio idéal", [["correct", "Correct : AC3 5.1 ~448 kb/s"], ["bon", "Bon : E-AC3 Atmos 768 kb/s"], ["sansperte", "Sans perte : TrueHD / DTS-HD MA"]]],
      ["poidsAudio", "Importance de l'audio dans la note globale (%)", "nombre", 0, 60, 5],
      ["cible", "Poids cible (Go par heure, 0 = sans limite)", "nombre", 0, 60, 0.5],
      ["plafond", "Poids plafond (Go par heure, 0 = sans limite)", "nombre", 0, 80, 0.5],
    ];
    // Réglage absent d'un profil enregistré avant son ajout (lot VOSTFR : « st ») : sa valeur neutre. Les réglages d'affichage de
    // Rechercher (3D, Opus, note minimale, un temps dans le profil le 22/11/2026) sont passés dans la ligne « Masquer » de la page
    // et dans Ton équipement : valeurs déjà enregistrées ignorées, comme « dv » et « avi ».
    const NEUTRES = { st: "indiff" };
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
      // Pistes que ton appareil ne lit pas (Ton équipement : DTS, Opus, TrueHD / DTS-HD MA tels quels) : ignorées dans la note audio ;
      // DTS-HD MA non transmis tel quel mais DTS lu : compté comme son cœur DTS (1 509 kb/s). Lisibilité « je ne sais pas » : comptée.
      const pistes = (v.pistes || []).map((p) => {
        const x = { ...p, ...notePiste(p) };
        if (p.role) return x;
        const L = lisibilite(p);
        x.lisible = L.n;
        if (L.n === 0) { x.ignoree = true; x.pourquoi = L.k === "hd" ? `${L.nom} non transmis tel quel` : `ton appareil ne lit pas le ${L.nom}`; }
        else if (L.core) { x.note = notePiste({ format: "DTS", brut: "DTS", canaux: p.canaux, debit: 1509 }).note; x.core = true; x.pourquoi = "cœur DTS : DTS-HD MA non transmis tel quel"; }
        if (L.n < 2) x.cle = [L.k, L.nom];
        return x;
      });
      // langue « ? » (estimation d'après un titre sans langue, ou fichier sans langue indiquée) : pas pénalisée, comme avant
      // VO (lot VOSTFR) : piste dans la langue originale (o.vo, langue TMDB) ; œuvre française : ses pistes françaises
      const estVo = (p) => p.langue === "vo" || (o.vo === "fr" && ["vff", "vfq", "vfb"].includes(p.langue));
      const voulues = (p) => !p.role && (p.langue === "?" || (r.langue === "vff" ? p.langue === "vff" : r.langue === "vf" ? ["vff", "vfq"].includes(p.langue) : r.langue === "vo" ? estVo(p) : true));
      const candidates = pistes.filter(voulues);   // sert aussi au critère de langue (pistes illisibles comprises : la langue est bien dans le fichier)
      // langue voulue absente : on se rabat sur une autre VF, puis sur la VO (le critère de langue pénalise déjà)
      const lisibles = (l) => l.filter((p) => !p.ignoree);
      const secours = pistes.filter((p) => !p.role && ["vff", "vfq", "vfb"].includes(p.langue));
      const retenue = (lisibles(candidates).length ? lisibles(candidates) : lisibles(secours).length ? lisibles(secours) : lisibles(pistes.filter((p) => !p.role))).slice().sort((a, b) => b.note - a.note)[0] || null;
      // Ton équipement, audio : la meilleure lisibilité parmi les pistes de la langue voulue (sinon de secours) ; la version n'est
      // touchée que si aucune n'est lue à coup sûr
      const groupe = candidates.length ? candidates : secours.length ? secours : pistes.filter((p) => !p.role);
      const etatAudio = groupe.length ? Math.max(...groupe.map((p) => p.lisible ?? 2)) : 2;
      const clesAudio = etatAudio < 2 ? [...new Map(groupe.filter((p) => (p.lisible ?? 2) === etatAudio && p.cle).map((p) => [p.cle.join("|"), p.cle])).values()] : [];
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
      // Ton équipement (22/11/2026) : un seul critère pour tout ce que l'écran ou l'appareil ne lit pas (× 0,5 si un « Non »,
      // sinon × 0,9 si un « Je ne sais pas »), détaillé dans j.eq (badges rouges et orange des pages)
      const sansVf = !!retenue && !["vff", "vfq", "vfb", "?"].includes(retenue.langue);
      const eq = compatibilite(v, r, { etat: etatAudio, cles: clesAudio }, sansVf);
      if (eq.items.length) crit.push({ ok: false, lib: eq.items.map((x) => x.texte).join(", "), f: eq.f, detail: "Ton équipement", equipement: true });
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
      return { NV, pistes, retenue, NA, goh, crit, fPoids, poidsLib, wv, wa, pv, pa, fCrit, globale, taille: v.taille, eq };
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
    return { classe, classeDe, largeurAffichee, maxiDe, effort, materiel, pixelsUtiles, facteurPixels, noteVideo, notePiste, ideal, juger, verdict, aspectOeuvre, aspectDe, equipement, EQUIPEMENT, CLES_EQ, compatibilite, est3D, sousTitres, PROFILS, CHAMPS, NEUTRES, AUDIO_IDEAL, LANG, EFFORT,
      sourceDe, difficulte, lignesPoussee, POUSSE, MODES: [["rapide", "Rapide"], ["pousse", "Poussée"]] };
  })();

  const N = { MAXI, v2: V2 };
  if (typeof module === "object" && module.exports) module.exports = N;
  else racine.Note = N;
})(this);
