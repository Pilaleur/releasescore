// lecteur-mediainfo.js — lit le MediaInfo (ou le BDInfo) d'une fiche C411 et en tire les faits utiles à la note.
//
// Le texte vient de la fiche C411 (champ metadata.nfoContent). Présentations rencontrées (25 fiches de La Femme de ménage, 08/11/2026) :
//   - MediaInfo en anglais ou en français, colonnes alignées ou « clé : valeur » serré ;
//   - MediaInfo dans un cadre ou sous un dessin ASCII (║, │…) : les caractères du cadre sont retirés ;
//   - présentation maison de la team avant le vrai MediaInfo (BYOR « FICHE / PISTES ») : ignorée, seul le vrai MediaInfo compte ;
//   - BDInfo (disque BDMV complet) ;
//   - résumé de MediaInfo (titres en majuscules « GENERAL », « VIDEO », « AUDIO #1 », débit écrit « Bitrate » en un mot, sans
//     taille de piste) : vu sur Brice de Nice 4KLight QTZ (12/11/2026), lu comme un MediaInfo (débit = étiquette) ;
//   - présentation bilingue « Largeur | Width :> 1424 pixels » (Alice au pays des merveilles NOTAG, 12/11/2026) : « :> » vaut « : »,
//     chaque nom de la clé compte.
// Débit vidéo absent (ni taille de piste ni débit affiché : MediaInfo abrégé, image ISO BDAV) : débit global du fichier (« Overall
// bit rate », sinon taille du fichier ÷ durée) moins les pistes audio (débit courant du format quand il manque), la moitié du
// débit global au moins (comme la base du NAS) ; videoMesure « estime » (« déduit du débit global »).
// On ne se fie jamais au champ « description » de la fiche (présentation faite avec un modèle, chiffres parfois faux).
//
// Débit vidéo : la taille réelle de la piste (« Stream size » / « Taille du flux ») ÷ la durée, quand elle est donnée ;
// sinon le débit affiché (« Bit rate »), qui peut être une étiquette écrite à l'encodage (vu sur Harry Potter 6 QTZ).
//
// Résultat (environ 300 octets en JSON) :
//   { lu: "mediainfo" | "bdinfo", conteneur (« Matroska », « AVI », « MPEG-4 »…), duree (min), w, h, bits, hdr ("SDR" | "HDR10" | "HDR10+" | "HLG" | "DV + HDR10" | "DV + HDR10+" | "DV seul"),
//     codec ("H.264" | "H.265" | "AV1" | "XviD" | autre), video (Mb/s), videoEtiquette (Mb/s), videoMesure ("taille" | "etiquette"),
//     lib (encodeur vidéo : « x265 4.1… », vide si inconnu), enc ({ subme, me, trellis, rd, ref, bframes, rcla, + réglages de la
//     notation poussée : voir lireReglages } ou null), maxfall (HDR, cd/m², si le MediaInfo le donne),
//     reglages ({ mode, psyrd, aq, sao } ou null : pour information),
//     pistes: [{ format (nom commercial), brut (format MediaInfo), canaux, debit (kb/s), langue ("vff" | "vfq" | "vfb" | "vo" | "autre"),
//                role ("" | "AD" | "commentaire"), titre }],
//     st: [{ langue ("fr" ou code à 2 lettres, "?" inconnue), force (sous-titres forcés : seulement les passages en langue étrangère),
//            sdh (pour sourds et malentendants) }] (lot VOSTFR, 11/11/2026 ; [] = aucun sous-titre) }
//     par (fichier anamorphique seulement : rapport des pixels, d'après « Display aspect ratio »),
//     l: 6 (lecture du 12/11/2026 : « Bitrate » en un mot (l 2), format d'affichage (l 3), débit déduit du débit global,
//     présentation « :> » et langue absente = « ? » (l 4) ; 17/11/2026 : torrent à plusieurs fichiers, le plus long (l 5),
//     avec « nf » = nombre de fichiers décrits quand il y en a plusieurs ; 17/11/2026, soir (l 6) : « dtot » = somme des durées
//     des fichiers (min) et « vmoy » = débit vidéo moyen pondéré par la durée (Mb/s), pour les séries ; 18/11/2026 (l 7) : réglages
//     d'encodage complets dans « enc » (voir lireReglages) et « maxfall » (HDR : luminosité moyenne maximale, cd/m²), pour la
//     notation poussée ; voir aRelire)
// Version de l'extension « ReleaseScore » (ex « Notes C411 ») : identique à interface/lecteur-mediainfo.js de l'outil, sauf aRelire :
// ici, seules les fiches à plusieurs fichiers lues avant « l 6 » sont relues (l'outil relit toutes celles lues avant « l 6 »).
// ou null si le texte n'est ni un MediaInfo ni un BDInfo lisible.
// Faits lus avant le lot VOSTFR : pas de « st » (fiches-c411.js relit la fiche quand la version s'affiche).

(function (racine) {
  // ---------- nombres, tailles, débits, durées ----------
  const ESP = /[\s   ]/g;
  // « 3 690 », « 98.1 », « 14,9 » (virgule décimale française)
  const nombre = (s) => { const m = String(s || "").replace(ESP, "").match(/-?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(",", ".")) : null; };
  // débit en kb/s : « 14.9 Mb/s », « 3 690 kb/s », « 14,9 Mb/s », « 4 221 kb/s »
  function kbps(s) {
    const t = String(s || ""), n = nombre(t);
    if (n == null) return null;
    return /[MG]b(it)?\/?s|Mbps/i.test(t) ? n * (/G/.test(t) ? 1e6 : 1000) : /kb(it)?\/?s|kbps/i.test(t) ? n : n / 1000;
  }
  // taille en octets : « 13.1 GiB (96%) », « 602 MiB », « 13,1 Gio », « 3.39 GiB »
  function octets(s) {
    const t = String(s || "").split("(")[0], n = nombre(t);
    if (n == null) return null;
    const u = (t.match(/([KMGT])i?[Bo]/i) || [])[1];
    const binaire = /[KMGT]i[Bo]|[KMGT]io/i.test(t) || /[KMGT]o/.test(t);
    const p = { K: 1, M: 2, G: 3, T: 4 }[(u || "").toUpperCase()] || 0;
    return n * Math.pow(binaire ? 1024 : 1000, p);
  }
  // durée en minutes : « 2 h 6 min », « 2 h 11 min 27 s », « 45 min 12 s », « 02:11:27.838 »
  function minutes(s) {
    const t = String(s || "");
    const hms = t.match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (hms) return +hms[1] * 60 + +hms[2] + +hms[3] / 60;
    const h = t.match(/(\d+)\s*h/), m = t.match(/(\d+)\s*min/), sec = t.match(/(\d+)\s*s\b/), ms = t.match(/(\d+)\s*ms/);
    if (!h && !m && !sec) return null;
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (sec && !ms ? +sec[1] / 60 : 0);
  }
  // format d'affichage : « 1.850 », « 16:9 », « 2.40:1 », « 1,85 » -> nombre
  function rapport(s) {
    const m = String(s || "").replace(ESP, "").match(/^(\d+(?:[.,]\d+)?)(?::(\d+(?:[.,]\d+)?))?/);
    if (!m) return null;
    const a = Number(m[1].replace(",", ".")), b = m[2] ? Number(m[2].replace(",", ".")) : 1;
    return a > 0 && b > 0 ? a / b : null;
  }
  // débit courant d'une piste audio dont le débit manque (kb/s), pour déduire le débit vidéo du débit global
  function debitCourant(p) {
    const f = `${p.format || ""} ${p.brut || ""}`.toLowerCase(), ch = p.canaux || 6;
    return /truehd|mlp/.test(f) ? 3500 : /xll|dts-hd master|dts:x/.test(f) ? 3000 : /flac|pcm/.test(f) ? 2000 : /dts/.test(f) ? 1509
      : /e-ac-3|eac3|plus/.test(f) ? 640 : /ac-3|ac3|dolby digital/.test(f) ? (ch >= 6 ? 448 : 192) : /aac/.test(f) ? (ch >= 6 ? 384 : 192)
      : /opus/.test(f) ? 192 : 384;
  }
  const canauxDe = (s) => { const l = String(s || "").match(/\d+/g); return l ? Math.max(...l.map(Number)) : null; };

  // ---------- langue et rôle d'une piste audio ----------
  const NOMS_LANGUE = { en: /english|anglais/, es: /spanish|espagnol|castillan/, it: /italian|italien/, de: /german|allemand/, ja: /japanese|japonais/,
    ko: /korean|coréen|coreen/, zh: /chinese|chinois|mandarin|cantonese/, pt: /portugu/, ru: /russian|russe/, hi: /hindi/, nl: /dutch|néerlandais/, sv: /swedish|suédois/,
    da: /danish|danois/, no: /norwegian|norvégien/, fi: /finnish|finnois/, pl: /polish|polonais/, tr: /turkish|turc/, ar: /arabic|arabe/, he: /hebrew|hébreu/, th: /thai/ };
  function lireLangue(langue, titre, service, ctx) {
    const L = String(langue || "").toLowerCase().trim(), T = String(titre || "").toLowerCase(), S = String(service || "").toLowerCase();
    const tout = `${L} ${T}`;
    const role = /comment/.test(`${T} ${S}`) ? "commentaire"
      : /audio.?desc|\bad\b|descripti|visually impaired|malvoyant|\[ad\]|\(ad\)/.test(`${T} ${S}`) ? "AD" : "";
    const francais = /^(fr|fre|fra|french|fran)/.test(L) || (!L && /\b(vff|vfq|vfb|vf|french|français|francais|truefrench)\b/.test(T));
    if (francais) {
      if (/\(ca\)|fr-ca|canad|québ|queb|\bvfq\b/.test(tout)) return { langue: "vfq", role };
      if (/\(be\)|fr-be|belg|\bvfb\b/.test(tout)) return { langue: "vfb", role };
      if (/\(fr\)|fr-fr|france|\bvff\b|truefrench|\bvfi\b/.test(tout)) return { langue: "vff", role };
      return { langue: ctx.vfDefaut || "vff", role }; // « French » sans précision : la langue annoncée par la release
    }
    if (!L && !T.trim()) return { langue: "?", role }; // aucune langue indiquée (image ISO…) : inconnue, pas pénalisée (12/11/2026)
    if (ctx.vo && NOMS_LANGUE[ctx.vo]) return { langue: NOMS_LANGUE[ctx.vo].test(L) || L.startsWith(ctx.vo) ? "vo" : "autre", role };
    return { langue: L || T ? "vo" : "autre", role };
  }

  // ---------- sous-titres (lot VOSTFR, 11/11/2026) ----------
  // langue : « fr » pour le français (toutes variantes), sinon le code à 2 lettres (« en »…), « ? » inconnue.
  // force : sous-titres forcés (ne traduisent que les passages dans une autre langue) : ils ne comptent pas comme « sous-titres français ».
  const CODES = { english: "en", anglais: "en", spanish: "es", espagnol: "es", italian: "it", italien: "it", german: "de", allemand: "de", japanese: "ja",
    japonais: "ja", korean: "ko", coréen: "ko", chinese: "zh", chinois: "zh", portuguese: "pt", portugais: "pt", russian: "ru", russe: "ru", dutch: "nl", arabic: "ar", arabe: "ar" };
  // pistes identiques (même langue, forcée ou non, SDH ou non) gardées une seule fois : quelques dizaines d'octets par version
  const unique = (l) => { const vu = new Set(); return l.filter((s) => { const k = `${s.langue}|${s.force}|${s.sdh}`; if (vu.has(k)) return false; vu.add(k); return true; }); };
  function lireSousTitre(langue, titre, service, forceChamp) {
    const L = String(langue || "").toLowerCase().trim(), T = String(titre || "").toLowerCase();
    const fr = /^(fr|fre|fra|french|fran)/.test(L) || (!L && /\b(vff|vfq|vfb|vf|vostfr|french|français|francais|truefrench)\b/.test(T));
    const mot = (L.match(/^[a-zà-ÿ]+/) || [""])[0];
    const langueSt = fr ? "fr" : CODES[mot] || (/^[a-z]{2}\b/.test(L) ? L.slice(0, 2) : L ? mot.slice(0, 12) || "?" : "?");
    const force = /^(yes|oui|1|true)/i.test(String(forceChamp || "")) || /forc/.test(T);
    const sdh = /hearing|malentend|sourd|\bsdh\b|\bcc\b/i.test(`${T} ${service || ""}`);
    return { langue: langueSt, force, sdh };
  }
  // langue d'une piste française sans précision, d'après le nom de la release et la langue C411
  function vfDefaut(nom, langueC411) {
    const t = " " + String(nom || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ") + " ";
    const c = String((langueC411 || []).join(" ")).toLowerCase();
    if (/\sVFQ\s/.test(t) && !/\s(VFF|VF2|TRUEFRENCH|VFI)\s/.test(t)) return "vfq";
    if (!/\s(VFF|VF2|TRUEFRENCH|VFI|VFQ)\s/.test(t) && /québ|queb/.test(c) && !/vff|truefrench/.test(c)) return "vfq";
    if (/\sVFB\s/.test(t) && !/\s(VFF|VF2|TRUEFRENCH)\s/.test(t)) return "vfb";
    return "vff";
  }

  // ---------- HDR ----------
  function hdrDe(format, transfert) {
    const f = String(format || ""), t = String(transfert || "");
    const plus = /2094|hdr10\+|hdr10 ?plus/i.test(f), dix = /2086|hdr10/i.test(f);
    if (/dolby vision/i.test(f)) {
      // profil 8 / 7 : couche HDR10 compatible (« HDR10 compatible », « / SMPTE ST 2086 ») ; profil 5 : Dolby Vision seul
      const reste = f.replace(/^[^/]*dolby vision[^/]*?(?=\/|$)/i, " ");
      if (plus) return "DV + HDR10+";
      if (dix || /compatible/i.test(f) || /PQ/.test(t) && /\/\s*smpte/i.test(reste)) return "DV + HDR10";
      if (/hlg/i.test(f) || /HLG/.test(t)) return "DV + HLG";
      return "DV seul";
    }
    if (plus) return "HDR10+";
    if (dix || /PQ|2084/i.test(t)) return "HDR10";
    if (/HLG/i.test(f) || /HLG/i.test(t)) return "HLG";
    return "SDR";
  }
  const codecDe = (f) => /AVC|H\.?264/i.test(f) ? "H.264" : /HEVC|H\.?265/i.test(f) ? "H.265" : /AV1/i.test(f) ? "AV1"
    : /MPEG-4 Visual|XviD|DivX/i.test(f) ? "XviD" : /VP9/i.test(f) ? "VP9" : /MPEG Video|MPEG-2/i.test(f) ? "MPEG-2" : String(f || "") || null;

  // ---------- paramètres d'encodage x264 / x265 ----------
  // enc : réglages utiles à la note. Effort (les deux modes) : subme, me, trellis, rd, ref, bframes, rcla.
  // Notation poussée (18/11/2026, lecture « l 7 ») : rc ("crf" | "2pass" | "abr" | "cbr" | "cqp"), crf, br (débit visé, kb/s),
  // vbv (plafond VBV, kb/s), sao (x265 : true / false), db (somme des deux réglages du deblock ; -99 = deblock coupé),
  // psyrd, psyrdoq (x265), psytr (psy-trellis, x264), psy (x264 : false = psy coupé), aqm (mode d'aq), sis (x265 : strong-intra-smoothing),
  // svt (SVT-AV1 écrit par ffmpeg : « libsvtav1 CRF=22.0 preset=5 », preset). Un réglage absent du texte : null (non compté).
  const ME_X264 = { dia: 0, hex: 1, umh: 2, esa: 3, tesa: 4 };
  const virgule = (x) => String(x).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(".", ",");
  function lireReglages(texte, lib) {
    if (!texte) return { enc: null, reglages: null };
    const t = String(texte);
    // SVT-AV1 par ffmpeg : une seule ligne « libsvtav1 CRF=22.0 preset=5 pix_fmt=… » (pas de « / »)
    const svt = t.match(/svtav1\b.*?\bcrf=(\d+(?:\.\d+)?)/i);
    if (svt && !/\s\/\s/.test(t)) {
      const preset = (t.match(/\bpreset=(-?\d+)/i) || [])[1];
      return { enc: { rc: "crf", crf: Number(svt[1]), svt: preset != null ? Number(preset) : null },
        reglages: { mode: `CRF ${virgule(svt[1])}${preset != null ? ` (SVT-AV1, preset ${preset})` : ""}`, psyrd: null, aq: null, sao: null } };
    }
    const p = {};
    for (const morceau of t.split(/\s\/\s/)) {
      const i = morceau.indexOf("=");
      if (i < 0) p[morceau.trim()] = true; else p[morceau.slice(0, i).trim()] = morceau.slice(i + 1).trim();
    }
    const x264 = /x264/i.test(lib || "") || p.trellis != null;
    const num = (k) => (p[k] == null || p[k] === true ? null : nombre(p[k]));
    // mode de débit : CRF, ou débit visé (1 ou 2 passes, CBR). x265 récent : « rc=abr » + « stats-read=2 » en 2e passe ;
    // x265 ancien : « rc=2 » + « pass » ; x264 : « rc=2pass », « rc=abr », « rc=cbr », « rc=crf ».
    const rc0 = String(p.rc || "").toLowerCase().replace(/\s+/g, "");
    const passes = rc0 === "2pass" || Number(p["stats-read"]) >= 1 || Number(p.pass) === 2 || (p.pass === true && p.bitrate != null);
    const crf = num("crf");
    const rc = passes ? "2pass" : rc0 === "crf" || (crf != null && !["abr", "cbr", "cqp"].includes(rc0) && p.bitrate == null) ? "crf"
      : rc0 === "cbr" ? "cbr" : rc0 === "cqp" ? "cqp" : rc0 === "abr" || p.bitrate != null ? "abr" : null;
    const psyrdBrut = p["psy-rd"] ?? (p.psy_rd != null && p.psy_rd !== true ? String(p.psy_rd).split(":")[0] : null);
    const psytr = x264 && p.psy_rd != null && p.psy_rd !== true ? nombre(String(p.psy_rd).split(":")[1]) : null;
    // deblock : x265 « deblock=-2:-2 » (ou « no-deblock ») ; x264 « deblock=1:-3:-3 » (1er chiffre : activé)
    let db = null;
    if (p["no-deblock"] === true) db = -99;
    else if (p.deblock != null) {
      const d = String(p.deblock === true ? "0:0" : p.deblock).split(":").map(Number);
      if (x264 && d.length >= 3) db = d[0] === 0 ? -99 : d[1] + d[2]; else if (d.length >= 2 && d.every(Number.isFinite)) db = d[0] + d[1];
    }
    const aqm = p["aq-mode"] != null ? num("aq-mode") : p.aq != null && p.aq !== true ? nombre(String(p.aq).split(":")[0]) : null;
    const vbv = num("vbv-maxrate") ?? num("vbv_maxrate");
    const enc = {
      subme: num("subme"), ref: num("ref"), bframes: num("bframes"),
      me: x264 ? (ME_X264[String(p.me || "").toLowerCase()] ?? null) : num("me"),
      trellis: x264 ? num("trellis") : null, rd: x264 ? null : num("rd"),
      rcla: num("rc-lookahead") ?? num("rc_lookahead"),
      rc, crf: rc === "crf" ? crf : null, br: rc !== "crf" ? num("bitrate") : null, vbv: vbv > 0 ? vbv : null,
      sao: x264 ? null : p["no-sao"] === true ? false : p.sao === true ? true : null,
      db, psyrd: psyrdBrut != null ? nombre(psyrdBrut) : null, psyrdoq: x264 ? null : num("psy-rdoq"), psytr,
      psy: x264 && p.psy != null ? Number(p.psy) !== 0 : null, aqm,
      sis: x264 ? null : p["no-strong-intra-smoothing"] === true ? false : p["strong-intra-smoothing"] === true ? true : null,
    };
    const mode = rc === "crf" ? `CRF ${p.crf != null && p.crf !== true ? virgule(p.crf) : "?"}`
      : p.bitrate != null ? `débit visé ${Math.round(nombre(p.bitrate)).toLocaleString("fr-FR")} kb/s${passes ? ", 2 passes" : rc === "cbr" ? ", CBR" : ", 1 passe"}` : rc0 ? rc0.toUpperCase() : null;
    const aq = p["aq-mode"] != null ? `mode ${p["aq-mode"]}, force ${p["aq-strength"] ?? "?"}` : p.aq ? `mode ${String(p.aq).split(":")[0]}, force ${String(p.aq).split(":")[1] ?? "?"}` : null;
    const sao = enc.sao === true ? "oui" : enc.sao === false ? "non" : null;
    return { enc, reglages: { mode, psyrd: psyrdBrut != null ? String(psyrdBrut).replace(/\.?0+$/, "").replace(".", ",") : null, aq: aq ? aq.replace(/\.00\b/, "").replace(".", ",") : null, sao } };
  }

  // ---------- MediaInfo (anglais ou français) ----------
  const CADRE = /^[\s║│┃┆┇┊┋|▌▐]+|[\s║│┃┆┇┊┋|▌▐]+$/g;
  const ENTETE = /^(General|Général|Video|Vidéo|Audio|Text|Texte|Menu|Image|Chapters|Chapitres|Other|Autre)(\s*#\s*\d+)?$/i;
  // Tous les fichiers décrits, chacun = liste de sections { nom, champs } (un bloc « General » par fichier).
  function blocs(texte) {
    const fichiers = [];
    let bloc = null, cur = null;
    for (const brute of String(texte).split(/\r?\n/)) {
      const l = brute.replace(CADRE, "");
      if (!l) continue;
      const e = l.match(ENTETE);
      if (e) {
        const nom = e[1].toLowerCase().replace("général", "general").replace("vidéo", "video").replace("texte", "text");
        if (nom === "general") { bloc = []; fichiers.push(bloc); } // un fichier de plus
        if (!bloc) continue;
        cur = { nom, champs: {} }; bloc.push(cur); continue;
      }
      if (!cur) continue;
      const lc = l.replace(/\s*:>\s*/, " : "); // « Largeur | Width :> 1424 pixels »
      const m = lc.match(/^(\S.*?)\s+:\s(.*)$/) || lc.match(/^(\S.*?)\s*:\s+(.*)$/);
      if (m) for (const k of m[1].split("|").map((x) => x.trim()).filter(Boolean)) if (!(k in cur.champs)) cur.champs[k] = m[2].trim();
    }
    return fichiers;
  }
  // Durée d'un fichier (minutes) : piste vidéo, sinon bloc « General » ; sans piste vidéo : -1 (jamais retenu ni compté).
  function dureeDe(b) {
    const v = b.find((s) => s.nom === "video")?.champs, g = b.find((s) => s.nom === "general")?.champs || {};
    return v ? (minutes(v["Duration"] || v["Durée"]) || minutes(g["Duration"] || g["Durée"]) || 0) : -1;
  }
  // Torrent à plusieurs fichiers (un bloc « General » par fichier, à la suite) : seul le fichier LE PLUS LONG sert à la note
  // (décision du 17/11/2026 ; avant : le premier fichier, dont la durée était comparée à la taille de tout le torrent :
  // pack « BONUS » de L'Odyssée, premier fichier de 5 min 27 s). Durées égales ou inconnues : le premier. Un seul fichier : rien ne change.
  // Le tableau rendu porte « nf » (nombre de fichiers décrits) quand il y en a plusieurs.
  const sections = (texte) => choisir(blocs(texte));
  function choisir(fichiers) {
    if (fichiers.length <= 1) return fichiers[0] || [];
    let choisi = fichiers[0], d0 = dureeDe(choisi);
    for (const b of fichiers.slice(1)) { const d = dureeDe(b); if (d > d0) { choisi = b; d0 = d; } }
    choisi.nf = fichiers.length;
    return choisi;
  }
  const champ = (c, ...cles) => { for (const k of cles) if (c[k] != null && c[k] !== "") return c[k]; return null; };

  // Torrent à plusieurs fichiers (17/11/2026, soir) : le fichier le plus long donne les faits (règle des films, voir sections) ;
  // en plus, pour les séries (le choix film / série se fait dans la page, pas ici) :
  //   dtot = somme des durées de tous les fichiers avec une piste vidéo (minutes ; bonus compris : choix du 17/11/2026),
  //   vmoy = débit vidéo moyen de ces fichiers, pondéré par leur durée (Mb/s).
  // Avant (l 5) : la page prenait pour une série taille ÷ débit du seul fichier le plus long (Les Anneaux de pouvoir S01 :
  // 9,0 h pour SUPPLY, 9,8 h pour CHiLL, même saison).
  function lireMediainfo(texte, ctx) {
    const tous = blocs(texte);
    const S = choisir(tous);
    const base = lireBloc(S, ctx);
    if (!base || tous.length <= 1) return base;
    let dtot = 0, dv = 0, vxd = 0;
    for (const b of tous) {
      const d = dureeDe(b);
      if (!(d > 0)) continue;
      dtot += d;
      const x = b === S ? base : lireBloc(b, ctx);
      if (x && x.video > 0) { vxd += x.video * d; dv += d; }
    }
    if (dtot > 0) base.dtot = Math.round(dtot * 10) / 10;
    if (dv > 0) base.vmoy = arrondi(vxd / dv, 2);
    return base;
  }
  function lireBloc(S, ctx) {
    const gen = S.find((s) => s.nom === "general")?.champs || {};
    const vid = S.find((s) => s.nom === "video")?.champs;
    if (!vid) return null;
    const duree = minutes(champ(vid, "Duration", "Durée")) || minutes(champ(gen, "Duration", "Durée"));
    const w = nombre(champ(vid, "Width", "Largeur")), h = nombre(champ(vid, "Height", "Hauteur"));
    // anamorphique : format d'affichage différent de largeur ÷ hauteur (plus de 3 %) -> rapport des pixels
    const dar = rapport(champ(vid, "Display aspect ratio", "Rapport largeur/hauteur à l'affichage", "Format d'affichage", "Rapport d'aspect à l'affichage", "Proportions de l'affichage"));
    const par = dar && w > 0 && h > 0 ? dar / (w / h) : null;
    const etiquette = kbps(champ(vid, "Bit rate", "Bitrate", "Débit") || champ(vid, "Nominal bit rate", "Nominal bitrate", "Débit nominal"));
    const taille = octets(champ(vid, "Stream size", "Taille du flux", "Taille des données"));
    const mesure = taille && duree ? taille * 8 / (duree * 60) / 1e6 : null;
    // la taille réelle de la piste prime ; l'étiquette seule si la taille manque ou paraît absurde (plus de 3 fois l'étiquette)
    const fiable = mesure && (!etiquette || (mesure < etiquette / 1000 * 3 && mesure > etiquette / 1000 / 3));
    const lib = champ(vid, "Writing library", "Bibliothèque utilisée") || "";
    const { enc, reglages } = lireReglages(champ(vid, "Encoding settings", "Paramètres d'encodage"), lib);
    // luminosité moyenne de l'image la plus lumineuse (HDR, cd/m²) : film sombre sous 120 (notation poussée, 18/11/2026)
    const maxfall = nombre(champ(vid, "Maximum Frame-Average Light Level", "MaxFALL", "Niveau de luminosité moyen du contenu", "MaxFALL_Original"));
    const pistes = S.filter((s) => s.nom === "audio").map(({ champs: a }) => {
      const dA = minutes(champ(a, "Duration", "Durée")) || duree;
      const tA = octets(champ(a, "Stream size", "Taille du flux"));
      const debit = kbps(champ(a, "Bit rate", "Bitrate", "Débit")) ?? (tA && dA ? tA * 8 / (dA * 60) / 1000 : null);
      const titre = champ(a, "Title", "Titre") || "";
      const l = lireLangue(champ(a, "Language", "Langue"), titre, champ(a, "Service kind", "Genre de service", "Type de service"), ctx);
      return { format: champ(a, "Commercial name", "Format, Nom commercial IfAny", "Nom commercial") || "", brut: champ(a, "Format") || "",
        canaux: canauxDe(champ(a, "Channel(s)", "Canal(aux)", "Canaux")), debit: debit != null ? Math.round(debit) : null, ...l, titre: titre.slice(0, 60) };
    });
    // débit vidéo absent : débit global moins l'audio (débit courant du format pour une piste sans débit)
    let video = fiable ? mesure : etiquette != null ? etiquette / 1000 : null, videoMesure = fiable ? "taille" : etiquette != null ? "etiquette" : null;
    if (video == null) {
      let global = kbps(champ(gen, "Overall bit rate", "Débit global", "Débit total"));
      const tF = octets(champ(gen, "File size", "Taille du fichier"));
      if (!(global > 0) && tF && duree) global = tF * 8 / (duree * 60) / 1000;
      if (global > 0) {
        const audio = pistes.reduce((t, p) => t + (p.debit > 0 ? p.debit : debitCourant(p)), 0);
        video = Math.max(global - audio, global * 0.5) / 1000; videoMesure = "estime";
      }
    }
    const st = unique(S.filter((s) => s.nom === "text").map(({ champs: t }) =>
      lireSousTitre(champ(t, "Language", "Langue"), champ(t, "Title", "Titre"), champ(t, "Service kind", "Genre de service", "Type de service"), champ(t, "Forced", "Forcé", "Forcée"))));
    return {
      lu: "mediainfo", conteneur: champ(gen, "Format") || null, duree: duree ? Math.round(duree * 10) / 10 : null, w, h,
      ...(par && Math.abs(par - 1) > 0.03 && par > 0.5 && par < 2.5 ? { par: Math.round(par * 1000) / 1000 } : {}), bits: nombre(champ(vid, "Bit depth", "Profondeur binaire", "Profondeur de bits")) || 8,
      hdr: hdrDe(champ(vid, "HDR format", "Format HDR"), champ(vid, "Transfer characteristics", "Caractéristiques du transfert")),
      codec: codecDe(champ(vid, "Format")), video: arrondi(video, 2),
      videoEtiquette: etiquette != null ? arrondi(etiquette / 1000, 2) : null, videoMesure,
      lib: /x26[45]|nvenc|qsv|quick ?sync|amf|vce|videotoolbox|svt|rav1e|aom|xvid|divx/i.test(lib) ? lib.slice(0, 60) : "",
      enc: enc && Object.values(enc).some((x) => x != null) ? enc : null, reglages, ...(maxfall > 0 ? { maxfall } : {}), pistes, st, ...(S.nf > 1 ? { nf: S.nf } : {}), l: 7,
    };
  }

  // ---------- BDInfo ----------
  function lireBdinfo(texte, ctx) {
    const lignes = String(texte).split(/\r?\n/).map((l) => l.replace(CADRE, ""));
    const duree = minutes((lignes.find((l) => /^Length:/i.test(l)) || "").replace(/^Length:/i, ""));
    const bloc = (nom) => {
      const i = lignes.findIndex((l) => new RegExp(`^${nom}:\\s*$`, "i").test(l));
      if (i < 0) return [];
      const out = [];
      for (let j = i + 1; j < lignes.length; j++) {
        const l = lignes[j];
        if (/^[A-Z ]+:\s*$/.test(l)) break;
        if (!l || /^-{3,}/.test(l) || /^Codec\s{2,}/.test(l)) continue;
        out.push(l);
      }
      return out;
    };
    // colonnes séparées par 2 espaces ou plus ; la description (dernière colonne) peut elle-même contenir des doubles espaces
    const colonnes = (l, n) => { const c = l.replace(/^\*\s*/, "").split(/\s{2,}/).map((x) => x.trim()).filter(Boolean); return [...c.slice(0, n - 1), c.slice(n - 1).join(" ")]; };
    const videos = bloc("VIDEO");
    const principale = videos.find((l) => !l.startsWith("*")) || videos[0];
    if (!principale) return null;
    const [codecV, debitV, descV = ""] = colonnes(principale, 3);
    const res = Number((descV.match(/(\d{3,4})[pi]/) || [])[1]) || null;
    const avecDV = videos.some((l) => /dolby vision/i.test(l));
    let hdr = hdrDe(descV, /\bPQ\b/.test(descV) ? "PQ" : /HLG/.test(descV) ? "HLG" : "");
    if (avecDV && !/^DV/.test(hdr)) hdr = hdr === "SDR" ? "DV seul" : hdr === "HDR10+" ? "DV + HDR10+" : "DV + HDR10";
    const pistes = bloc("AUDIO").map((l) => {
      const [codec, langue = "", debit = "", desc = ""] = colonnes(l, 4);
      // TrueHD / DTS-HD : le débit propre de la piste sans perte est le 3e élément de la description (« 7.1 / 48 kHz / 3690 kbps »)
      const propre = (desc.match(/\/\s*([\d,]+)\s*kbps/) || [])[1];
      const kb = Number(String(propre || debit).replace(/[^\d.]/g, "")) || null;
      const brut = /truehd/i.test(codec) ? (/atmos/i.test(codec) ? "MLP FBA" : "MLP") : /dts-hd master/i.test(codec) ? "DTS XLL" : /dts:x/i.test(codec) ? "DTS XLL X"
        : /lpcm/i.test(codec) ? "PCM" : /plus/i.test(codec) ? "E-AC-3" : /dolby digital/i.test(codec) ? "AC-3" : /dts/i.test(codec) ? "DTS" : codec;
      const fmt = /truehd/i.test(codec) ? `Dolby TrueHD${/atmos/i.test(codec) ? " with Dolby Atmos" : ""}` : codec.replace(/\s*Audio$/i, "");
      const c = desc.match(/^(\d)\.(\d)/);
      return { format: fmt, brut, canaux: c ? +c[1] + +c[2] : null, debit: kb, ...lireLangue(langue, "", "", ctx), titre: "" };
    });
    // sous-titres : « Presentation Graphics  French  25.56 kbps  1920x1080 / 1758 Captions ». BDInfo ne dit pas lesquels sont forcés :
    // une piste qui a moins d'un cinquième des sous-titres de la plus fournie de la même langue est comptée comme forcée
    // (La Femme de ménage, BDMV : 43 sous-titres contre 1 758 à 2 536 pour les autres pistes françaises).
    const brutsSt = bloc("SUBTITLES").map((l) => {
      const [, langue = "", , desc = ""] = colonnes(l, 4);
      return { ...lireSousTitre(langue, "", "", ""), n: Number(((desc.match(/(\d+)\s*Captions?/i) || [])[1] || "").replace(/\D/g, "")) || null };
    });
    const maxi = {};
    for (const s of brutsSt) if (s.n) maxi[s.langue] = Math.max(maxi[s.langue] || 0, s.n);
    const st = unique(brutsSt.map(({ n, ...s }) => ({ ...s, force: s.force || (n != null && maxi[s.langue] > 0 && n < maxi[s.langue] / 5) })));
    return {
      lu: "bdinfo", conteneur: "BDAV", duree: duree ? Math.round(duree * 10) / 10 : null, w: res >= 2000 ? 3840 : res >= 1000 ? 1920 : res >= 700 ? 1280 : 720, h: res || null,
      bits: nombre((descV.match(/(\d+) bits/) || [])[1]) || 8, hdr, codec: codecDe(codecV),
      video: arrondi(Number(String(debitV).replace(/[^\d.]/g, "")) / 1000, 2), videoEtiquette: null, videoMesure: "bdinfo",
      lib: "", enc: null, reglages: null, pistes, st, l: 7,
    };
  }
  const arrondi = (x, n = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);

  // texte : metadata.nfoContent ; ctx : { nom (de la release), langueC411 (valeurs C411), vo (langue originale TMDB : "en"…) }
  function lire(texte, ctx = {}) {
    if (!texte || typeof texte !== "string") return null;
    const c = { vo: ctx.vo || null, vfDefaut: vfDefaut(ctx.nom, ctx.langueC411) };
    try {
      if (/^\s*DISC INFO:|PLAYLIST REPORT:/m.test(texte) && /^\s*VIDEO:\s*$/m.test(texte)) return lireBdinfo(texte, c);
      return lireMediainfo(texte, c);
    } catch (e) { return null; }
  }

  // Faits d'une fiche à relire UNE fois quand sa version s'affiche (fiches-c411.js, recherche-c411.js ; la page Rechercher a la même règle) :
  // lus avant le lot VOSTFR (sans « st ») ; sans débit vidéo avant le 12/11/2026 (« Bitrate » en un mot) ; image plus étroite que 1,7:1
  // lue avant le 12/11/2026 (peut-être anamorphique : format d'affichage pas encore lu) ; sans débit vidéo ou toutes pistes
  // « autre » lues avant la lecture « l 4 » (débit déduit du débit global, présentation « :> », langue absente = « ? »).
  const aRelire = (f) => !!f && (f.st === undefined || (!(f.video > 0) && !(f.l >= 4))
    || (!(f.l >= 3) && f.lu === "mediainfo" && f.w > 0 && f.h > 0 && f.w / f.h < 1.7)
    || (!(f.l >= 4) && (f.pistes || []).length > 0 && f.pistes.every((x) => x.langue === "autre"))
    || (f.nf > 1 && !(f.l >= 6))   // l 6 (17/11/2026, soir) : durée totale et débit moyen des fichiers (séries)
    || (!(f.l >= 7) && f.reglages != null));   // l 7 (18/11/2026, notation poussée) : réglages d'encodage complets et MaxFALL ;
                       // seules les fiches qui avaient des réglages sont relues (environ une sur trois), les autres n'ont rien de plus à lire
  // lireLangue, lireSousTitre : aussi pour la base du NAS (recherche-c411.js)
  const M = { lire, aRelire, sections, blocs, kbps, octets, minutes, hdrDe, lireReglages, vfDefaut, lireLangue, lireSousTitre, unique };
  if (typeof module === "object" && module.exports) module.exports = M;
  else racine.LecteurMediainfo = M;
})(this);
