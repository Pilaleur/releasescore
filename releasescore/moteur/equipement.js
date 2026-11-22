// equipement.js — questionnaire « Ton équipement » (lot 4b, 10/11/2026) : règles fixes qui mènent des réponses au profil conseillé,
// et aide IA (texte à copier, lecture de la réponse). Commun au serveur (require("./equipement.js")) et à la page
// de configuration (<script src="/equipement.js"> → Equipement). Aucune requête : tout est calculé sur place.
//
// Principe : les notes vidéo et audio sont les mêmes pour tout le monde ; les réponses règlent seulement le profil
// (note globale). Mêmes réponses = même profil. Chaque question peut rester sans réponse (réglage neutre).
//
// Réponses (E) : taille (pouces) et distance (m) : nombre ou vide ; def : "1080" | "4k" ; hdr : "oui" | "non" ;
//   critères d'équipement (22/11/2026, voir note.js) : dv, dvp7, d3, av1, h10, avi, dts, opus, hd, pgs : "oui" | "non" ;
//   son : "tv" | "barre" | "51" | "atmos" ; priorite : "place" | "equilibre" | "qualite" ; null ou absent = je ne sais pas.
//   lecteurs : façons de regarder les films (["plex", "kodi"…], LECTEURS) ; deduits : critères remplis d'après les lecteurs
//   (« déduit de ton lecteur », voir deduire) ; ecran, appareil : textes libres (modèles donnés à l'IA), sans effet sur le profil.
// Deux sortes de réponses :
//   - celles qui règlent le PROFIL conseillé : taille et distance, définition, HDR, son, priorité ;
//   - celles qui règlent les CRITÈRES D'ÉQUIPEMENT, appliqués à tous les profils (note.js) : ce que l'écran et l'appareil lisent.

(function (racine) {
  const num = (t) => { const v = parseFloat(String(t ?? "").replace(",", ".")); return v > 0 && Number.isFinite(v) ? v : null; };
  const nb = (x, d = 1) => Number(x).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d });
  const DES_CRITERES = ["dv", "dvp7", "d3", "av1", "h10", "avi", "dts", "opus", "hd", "pgs"];
  const CHOIX = { def: ["1080", "4k"], hdr: ["oui", "non"], ...Object.fromEntries(DES_CRITERES.map((k) => [k, ["oui", "non"]])),
    son: ["tv", "barre", "51", "atmos"], priorite: ["place", "equilibre", "qualite"] };
  const DU_PROFIL = ["taille", "distance", "def", "hdr", "son", "priorite"];
  // Comment regardes-tu tes films ? (22/11/2026) Kodi, VLC et Infuse lisent presque tout eux-mêmes (sous-titres en image, Opus,
  // H.264 10 bits, .avi, DTS décodé) : quand on ne regarde qu'avec eux, ces réponses sont déduites. Plex et Jellyfin / Emby
  // convertissent ce que l'appareil ne lit pas ; le lecteur de la télé dépend du modèle : rien n'est déduit.
  const LECTEURS = [["plex", "Plex"], ["jellyfin", "Jellyfin / Emby"], ["kodi", "Kodi"], ["vlc", "VLC"], ["infuse", "Infuse"], ["tv", "Lecteur de la télé / clé USB"]];
  const LISENT_TOUT = ["kodi", "vlc", "infuse"], DEDUCTIBLES = ["pgs", "opus", "h10", "avi", "dts"];
  // -> { clé: "oui" } : ce qui se déduit des lecteurs cochés (rien si l'un d'eux convertit ou dépend de l'appareil)
  function deduire(lecteurs) {
    const l = (Array.isArray(lecteurs) ? lecteurs : []).filter((x) => LECTEURS.some(([k]) => k === x));
    return l.length && l.every((x) => LISENT_TOUT.includes(x)) ? Object.fromEntries(DEDUCTIBLES.map((k) => [k, "oui"])) : {};
  }

  // Réponses nettoyées : seules les valeurs connues sont gardées (taille 10 à 300 pouces, distance 0,3 à 20 m)
  function nettoyer(E) {
    const o = {};
    const t = num(E?.taille), d = num(E?.distance);
    if (t && t >= 10 && t <= 300) o.taille = t;
    if (d && d >= 0.3 && d <= 20) o.distance = d;
    for (const k of Object.keys(CHOIX)) if (CHOIX[k].includes(String(E?.[k] ?? ""))) o[k] = String(E[k]);
    for (const k of ["ecran", "appareil"]) { const s = String(E?.[k] ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120); if (s) o[k] = s; }
    const lecteurs = (Array.isArray(E?.lecteurs) ? E.lecteurs : []).filter((x, i, a) => LECTEURS.some(([k]) => k === x) && a.indexOf(x) === i);
    if (lecteurs.length) o.lecteurs = lecteurs;
    const deduits = (Array.isArray(E?.deduits) ? E.deduits : []).filter((x, i, a) => DES_CRITERES.includes(x) && o[x] != null && a.indexOf(x) === i);
    if (deduits.length) o.deduits = deduits;
    return o;
  }
  const repond = (E, cles) => cles.some((k) => E?.[k] != null && E[k] !== "");

  // Distances d'après la taille de l'écran (diagonale en pouces, image 16:9) :
  //   dNet : 60 pixels par degré (vue de 10/10) : jusque-là, la 4K est nette pour tout le monde ;
  //   dMax : 94 pixels par degré (limite mesurée de l'œil, Cambridge / Meta, Nature Communications 2025) : au-delà, plus personne ne la sépare du 1080p.
  const distances = (taille) => (taille ? { net: taille * 0.03964, max: taille * 0.0621 } : null);

  const POIDS = { place: { 1080: [1, 1.5], 2160: [3, 4] }, equilibre: { 1080: [2, 2.5], 2160: [5, 6] }, qualite: { 1080: [4, 6], 2160: [20, 40] } };

  // Réponses -> { r (réglages du profil), L (lignes [réglage, valeur, pourquoi]), base (nom du profil de base identique, ou null),
  //   profil (vrai si au moins une réponse règle le profil), criteres (vrai si au moins une réponse règle un critère d'équipement) }
  // V2 : Note.v2 (profils de base et liste des champs), facultatif (sans lui, « base » reste null).
  function conseiller(E0, V2) {
    const E = nettoyer(E0), L = [];
    const r = { basse: "penal", codec: "pref" };
    const t = E.taille || null, d = E.distance || null, D = distances(t);
    // 17/11/2026 : écran 4K qui affiche le HDR → 4K gardée même de loin, pour profiter du HDR (sur C411, le HDR
    // n'existe presque qu'en 4K) ; « Gagner de la place » reste prioritaire. En 4K, HDR préféré (SDR × 0,9).
    const pourHdr = E.def === "4k" && E.hdr === "oui" && E.priorite !== "place";
    const ou = t && d ? `À ${nb(d)} m d'un ${nb(t)} pouces` : "";
    // Résolution idéale : un écran 4K donne la 4K, sauf raison mesurée (distance) ou priorité à la place
    if (E.def === "1080") { r.res = "1080"; L.push(["Résolution idéale", "1080p", "Ton écran est en 1080p : la 4K n'y apporte rien."]); }
    else if (E.def !== "4k") { r.res = "1080"; L.push(["Résolution idéale", "1080p", "Définition de l'écran non renseignée : réglage neutre."]); }
    else if (E.priorite === "place") { r.res = "1080"; L.push(["Résolution idéale", "1080p", "Écran 4K, mais priorité à la place : un fichier 4K pèse bien plus lourd."]); }
    else if (!t || !d) { r.res = "2160"; L.push(["Résolution idéale", "4K", "Écran 4K ; taille ou distance non renseignée, donc pas de calcul."]); }
    else if (d <= D.net) { r.res = "2160"; L.push(["Résolution idéale", "4K", `${ou}, la 4K est nette pour tout le monde (jusqu'à ${nb(D.net)} m).`]); }
    else if (d <= D.max && E.priorite === "qualite") { r.res = "2160"; L.push(["Résolution idéale", "4K", `${ou}, le gain de la 4K est fin mais encore visible (jusqu'à ${nb(D.max)} m) : gardé, puisque tu vises la qualité.`]); }
    else if (pourHdr) { r.res = "2160"; L.push(["Résolution idéale", "4K", `${ou}, la finesse de la 4K ${d <= D.max ? "se voit à peine" : "ne se voit plus"}, mais la 4K est gardée pour le HDR de ton écran : sur C411, le HDR n'existe presque qu'en 4K.`]); }
    else if (d <= D.max) { r.res = "1080"; L.push(["Résolution idéale", "1080p", `${ou}, le gain de la 4K est fin (nette jusqu'à ${nb(D.net)} m, visible jusqu'à ${nb(D.max)} m). « Qualité d'abord » la garde.`]); }
    else { r.res = "1080"; L.push(["Résolution idéale", "1080p", `${ou}, l'œil ne sépare plus la 4K du 1080p, même avec une très bonne vue (limite : ${nb(D.max)} m).`]); }
    // HDR
    if (E.hdr === "non") { r.hdr = "sdr-req"; L.push(["HDR", "SDR requis", "Ton écran n'affiche pas le HDR."]); }
    else if (E.hdr === "oui" && r.res === "2160") { r.hdr = "pref"; L.push(["HDR", "HDR préféré (SDR × 0,9)", "Ton écran affiche le HDR : les versions HDR passent devant. Écran peu lumineux : « Indifférent » ou « SDR préféré » se règlent dans le profil."]); }
    else if (E.hdr === "oui") { r.hdr = "indiff"; L.push(["HDR", "Indifférent", "Ton écran affiche le HDR, mais il est rare en 1080p : réglage neutre."]); }
    else { r.hdr = "indiff"; L.push(["HDR", "Indifférent", "Non renseigné : réglage neutre."]); }
    // Critères d'équipement (appliqués à tous les profils, pas seulement au profil conseillé) : trois lignes, ce qui est lu, ce qui
    // ne l'est pas (× 0,5), ce qui n'est pas renseigné (× 0,9, sauf la 3D : comptée « Non »)
    const NOMS = { dv: "Dolby Vision", dvp7: "DV profil 7", d3: "3D", av1: "AV1", h10: "H.264 10 bits", avi: ".avi", dts: "DTS", opus: "Opus", hd: "TrueHD / DTS-HD MA tels quels", pgs: "sous-titres en image" };
    const liste = (f) => DES_CRITERES.filter(f).map((k) => NOMS[k]).join(", ");
    const C = [];
    if (DES_CRITERES.some((k) => E[k] === "oui")) C.push(["Lu sans conversion", "accepté", liste((k) => E[k] === "oui") + "."]);
    if (DES_CRITERES.some((k) => E[k] === "non" || (k === "d3" && E[k] !== "oui"))) C.push(["Pas lu", "× 0,5 · badge rouge", liste((k) => E[k] === "non" || (k === "d3" && E[k] !== "oui")) + (E.d3 == null ? " (3D non renseignée : comptée « Non »)." : ".")]);
    if (DES_CRITERES.some((k) => E[k] == null && k !== "d3")) C.push(["Non renseigné", "× 0,9 · badge orange « ? »", liste((k) => E[k] == null && k !== "d3") + " : à vérifier sur les versions concernées."]);
    // Audio
    const SON = { tv: ["correct", 15, "Haut-parleurs de la télé : au-delà d'un AC3 5.1 correct, la différence ne s'entend pas."], barre: ["bon", 15, "Barre de son : un E-AC3 de bon débit s'entend."],
      51: ["bon", 20, "Installation 5.1 : l'audio pèse plus dans la note."], atmos: E.priorite === "qualite" ? ["sansperte", 30, "Ampli Atmos et qualité d'abord : pistes sans perte."] : ["bon", 25, "Ampli Atmos : E-AC3 Atmos de bon débit."] };
    const son = SON[E.son] || ["correct", 15, "Non renseigné : réglage neutre."];
    r.audio = son[0]; r.poidsAudio = son[1];
    const A = ["Audio idéal", { correct: "Correct (AC3 5.1)", bon: "Bon (E-AC3 Atmos)", sansperte: "Sans perte" }[son[0]] + ` · ${son[1]} % de la note`, son[2]];
    // Langue : pas demandée ici, elle se règle dans le profil (valeur des profils de base)
    r.langue = "vff"; r.st = "indiff"; // sous-titres (lot VOSTFR) : indifférents, comme les profils de base
    // Poids (cible / plafond en Go par heure)
    const P = POIDS[E.priorite || "equilibre"][r.res === "2160" ? 2160 : 1080];
    r.cible = P[0]; r.plafond = P[1]; if (E.priorite === "place") r.basse = "ok";
    const Pd = ["Poids", `cible ${nb(P[0])} · plafond ${nb(P[1])} Go/h`, `${{ place: "Gagner de la place", equilibre: "Équilibre", qualite: "Qualité d'abord" }[E.priorite] || "Non renseigné : équilibre"} · film de 2 h : ${nb(P[0] * 2)} Go visés, ${nb(P[1] * 2)} Go au plus.`];
    L.push(...C.map((x) => [...x, true]), A, Pd); // 4e élément vrai : critère d'équipement (pas un réglage du profil conseillé)
    let base = null;
    if (V2) base = Object.keys(V2.PROFILS).find((n) => V2.CHAMPS.every(([k]) => String(V2.PROFILS[n][k]) === String(r[k]))) || null;
    return { r, L, base, profil: repond(E, DU_PROFIL), criteres: repond(E, DES_CRITERES), E };
  }
  const NOM_PROFIL = "Mon équipement";

  // ---------- Aide IA : texte à copier dans l'IA de son choix, réponse à coller ----------
  // Format strict, une ligne par fait : « CLE = valeur ; sûr » ou « ; pas sûr » ; « inconnu » accepté (la question reste sans réponse).
  // L'IA donne les faits, l'outil fait les calculs ; l'outil n'envoie rien lui-même.
  const CLES_IA = [["TAILLE_POUCES", "taille", "nombre"], ["DEFINITION", "def", "1080p | 4K"], ["HDR", "hdr", "oui | non"], ["DOLBY_VISION", "dv", "oui | non"],
    ["DOLBY_VISION_PROFIL_7", "dvp7", "oui | non"], ["3D", "d3", "oui | non"],
    ["AV1", "av1", "oui | non"], ["H264_10_BITS", "h10", "oui | non"], ["AVI", "avi", "oui | non"], ["DTS", "dts", "oui | non"], ["OPUS", "opus", "oui | non"],
    ["TRUEHD_DTSHD_TELS_QUELS", "hd", "oui | non"], ["SOUS_TITRES_IMAGE", "pgs", "oui | non"]];
  const nomsLecteurs = (l) => (Array.isArray(l) ? l : []).map((x) => (LECTEURS.find(([k]) => k === x) || [])[1]).filter(Boolean).join(", ");
  const texteIA = (ecran, appareil, lecteurs) => `Je remplis un questionnaire sur mon équipement vidéo.
Mon écran : ${String(ecran || "").trim() || "(marque et modèle)"}
Mon appareil de lecture : ${String(appareil || "").trim() || "(télé, box, clé HDMI… avec le modèle)"}
Je regarde mes films avec : ${nomsLecteurs(lecteurs) || "(Plex, Jellyfin, Kodi, VLC, lecteur de la télé…)"}

Réponds UNIQUEMENT avec les lignes ci-dessous, complétées, sans aucune phrase autour.
Après chaque valeur, écris « ; sûr » si tu en es certain, « ; pas sûr » sinon.
Si tu ne sais pas, écris « inconnu » : ne devine pas.

${CLES_IA.map(([c, , f]) => `${c} = ${f === "nombre" ? "" : `(${f})`}`).join("\n")}

TAILLE_POUCES : un nombre. HDR, DOLBY_VISION, DOLBY_VISION_PROFIL_7 (double couche des remux UHD), 3D : ce que l'écran affiche.
AV1, H264_10_BITS (Hi10P), AVI, DTS, OPUS : ce que l'appareil de lecture lit directement, sans conversion par le serveur (Plex…).
TRUEHD_DTSHD_TELS_QUELS : le son TrueHD et DTS-HD MA arrive-t-il tel quel jusqu'à la barre de son ou l'ampli (HDMI eARC) ?
SOUS_TITRES_IMAGE : l'appareil affiche-t-il les sous-titres PGS et VobSub sans que le serveur convertisse la vidéo ?`;
  // -> { valeurs: { champ: valeur }, marques: { champ: "sur" | "doute" }, n, doutes }
  function lireIA(texte) {
    const valeurs = {}, marques = {};
    for (const ligne of String(texte || "").split(/\r?\n/)) {
      const m = ligne.replace(/[*`]/g, "").match(/^\s*(?:[-•]\s*)?([A-Z0-9_]+)\s*[=:]\s*([^;]*?)\s*(?:;\s*(.*))?$/i);
      const c = m && CLES_IA.find(([k]) => k === m[1].toUpperCase());
      if (!c) continue;
      const brut = m[2].trim().toLowerCase().replace(/^\(|\)$/g, ""), sur = /^s[uû]r/i.test((m[3] || "").trim());
      let v = null;
      if (brut.includes("|")) continue; // ligne du modèle recopiée sans réponse : « (oui | non) »
      if (c[2] === "nombre") { const x = num(brut); if (x && x >= 10 && x <= 300) v = String(x).replace(".", ","); }
      else if (c[1] === "def") v = /4k|2160|uhd/.test(brut) ? "4k" : /1080|full ?hd/.test(brut) ? "1080" : null;
      else v = /^oui/.test(brut) ? "oui" : /^non/.test(brut) ? "non" : null;
      if (v === null) continue; // « inconnu » ou illisible : la question reste sur « Je ne sais pas »
      valeurs[c[1]] = v; marques[c[1]] = sur ? "sur" : "doute";
    }
    const n = Object.keys(valeurs).length;
    return { valeurs, marques, n, doutes: Object.values(marques).filter((x) => x === "doute").length };
  }

  const E = { conseiller, nettoyer, distances, repond, texteIA, lireIA, deduire, num, CLES_IA, CHOIX, DU_PROFIL, DES_CRITERES, LECTEURS, DEDUCTIBLES, NOM_PROFIL };
  if (typeof module === "object" && module.exports) module.exports = E;
  else racine.Equipement = E;
})(this);
