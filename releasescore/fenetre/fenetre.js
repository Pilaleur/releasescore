// fenetre.js — fenêtre de l'extension « ReleaseScore » (ex « Notes C411 ») : profil actif, profils à soi, questionnaire « Ton équipement »,
// explication des notes, mémoire des fiches, diagnostic. Tout reste dans le navigateur (chrome.storage.local) ; aucune requête.
//   profil      { nom, r (réglages), affiche (nom montré : « … (modifié) ») } : lu par contenu/fiche.js, qui renote aussitôt
//   profils     { nom: réglages } : tes profils enregistrés
//   equipement  réponses du questionnaire (règles : moteur/equipement.js, les mêmes que l'outil)
//   f:<empreinte>  une fiche lue (écrite par contenu/fiche.js)

(() => {
  "use strict";
  const V2 = Note.v2, EQ = Equipement;
  const DEFAUT = "HDLight 1080p";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, texte) => { const x = document.createElement(tag); if (cls) x.className = cls; if (texte != null) x.textContent = texte; return x; };
  const nb = (x) => Number(x).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const lire = (cles) => new Promise((res) => chrome.storage.local.get(cles, (v) => res(v || {})));
  const ecrire = (o) => new Promise((res) => chrome.storage.local.set(o, res));
  const retirer = (cles) => new Promise((res) => chrome.storage.local.remove(cles, res));

  // réglage absent d'un profil enregistré avant son ajout : sa valeur neutre (comme profils.js de l'outil)
  const NEUTRE = { st: "indiff" };
  const val = (r, k) => String((r && r[k]) ?? NEUTRE[k]);
  const pareil = (a, b) => V2.CHAMPS.every(([k]) => val(a, k) === val(b, k));

  let profils = {}, equipement = {}, etat = { nom: DEFAUT, r: { ...V2.PROFILS[DEFAUT] } };
  const estBase = (nom) => !!V2.PROFILS[nom];
  const source = (nom) => V2.PROFILS[nom] || (profils[nom] && { ...NEUTRE, ...profils[nom] }) || null;
  const modifie = () => !pareil(etat.r, source(etat.nom));
  const affiche = () => etat.nom + (modifie() ? " (modifié)" : "");
  const sauver = () => ecrire({ profil: { nom: etat.nom, r: etat.r, affiche: affiche() }, profils, equipement });

  // ---------- profil ----------
  const LIB = Object.fromEntries(V2.CHAMPS.filter((c) => Array.isArray(c[2])).map(([k, , choix]) => [k, Object.fromEntries(choix)]));
  function resume(r) {
    const court = (t) => String(t || "").replace(/\s*\(.*$/, "").replace(/\s*:.*$/, "");
    return [r.res === "2160" ? "4K" : "1080p", court(LIB.hdr[r.hdr]).replace("Indifférent", "HDR indifférent"), court(LIB.codec[r.codec]).replace("Requis", "H.265 requis").replace("Préféré", "H.265 préféré").replace("Indifférent", "codec indifférent"),
      court(LIB.langue[r.langue]).replace("Indifférente", "langue indifférente"), r.cible > 0 ? `cible ${nb(r.cible)} Go/h, plafond ${nb(Math.max(r.plafond || 0, r.cible))} Go/h` : "sans limite de poids"].join(" · ");
  }
  function dessinerProfil() {
    if (!source(etat.nom)) etat.nom = DEFAUT;   // profil supprimé : ses réglages restent, comptés comme HDLight modifié
    const m = modifie(), sel = $("profil");
    sel.replaceChildren();
    const option = (n) => { const o = el("option", "", n + (n === etat.nom && m ? " (modifié)" : "")); o.value = n; o.selected = n === etat.nom; return o; };
    for (const n of Object.keys(V2.PROFILS)) sel.append(option(n));
    const miens = Object.keys(profils).sort((a, b) => a.localeCompare(b));
    if (miens.length) { const g = el("optgroup"); g.label = "Mes profils"; g.append(...miens.map(option)); sel.append(g); }
    $("resume-profil").textContent = resume(etat.r);
    // réglages détaillés
    const zone = $("reglages");
    zone.replaceChildren();
    for (const [k, lib, choix, min, max, pas] of V2.CHAMPS) {
      const l = el("label", "", lib);
      let c;
      if (choix === "nombre") { c = el("input"); c.type = "number"; c.min = min; c.max = max; c.step = pas; c.value = etat.r[k]; }
      else {
        c = el("select");
        for (const [v, t] of choix) { const o = el("option", "", v === "auto" ? `${t} : ${V2.selon(k).texte}` : t); o.value = v; o.selected = String(etat.r[k]) === v; c.append(o); }
      }
      c.addEventListener("change", () => {
        const num = c.type === "number", v = num ? parseFloat(String(c.value).replace(",", ".")) : c.value;
        if (num && !(v >= 0)) { c.value = etat.r[k]; return; }
        etat = { nom: etat.nom, r: { ...etat.r, [k]: v } };
        changer();
      });
      l.append(c); zone.append(l);
    }
    // actions
    const a = $("actions-profil");
    a.replaceChildren();
    const bouton = (texte, titre, fn) => { const b = el("button", "", texte); b.type = "button"; if (titre) b.title = titre; b.addEventListener("click", fn); a.append(b); };
    if (m) bouton("Réinitialiser", `remettre les réglages de « ${etat.nom} »`, () => { etat = { nom: etat.nom, r: { ...source(etat.nom) } }; changer(); });
    if (m && !estBase(etat.nom)) bouton("Enregistrer", `remplacer les réglages de ton profil « ${etat.nom} »`, () => { profils[etat.nom] = { ...etat.r }; changer(); });
    if (!m && !estBase(etat.nom)) {
      let arme = false;
      bouton("Supprimer ce profil", "", (e) => {
        if (!arme) { arme = true; e.currentTarget.textContent = "Confirmer la suppression"; return; }
        delete profils[etat.nom]; etat = { nom: DEFAUT, r: { ...V2.PROFILS[DEFAUT] } }; changer();
      });
    }
  }
  function changer() { sauver(); dessinerProfil(); }

  $("profil").addEventListener("change", () => { const n = $("profil").value, s = source(n); if (s) { etat = { nom: n, r: { ...s } }; changer(); } });
  $("modifier").addEventListener("click", () => {
    const ouvert = $("reglages").hidden;
    $("reglages").hidden = !ouvert;
    $("modifier").setAttribute("aria-expanded", String(ouvert));
    $("modifier").textContent = ouvert ? "Fermer les réglages" : "Modifier";
  });
  $("nouveau").addEventListener("click", () => {
    const ouvert = $("creation").hidden;
    $("creation").hidden = !ouvert;
    $("nouveau").setAttribute("aria-expanded", String(ouvert));
    $("alerte-nom").hidden = true;
    if (ouvert) { $("nom-profil").value = estBase(etat.nom) ? `${etat.nom} (perso)` : ""; $("nom-profil").focus(); $("nom-profil").select(); }
  });
  function creer() {
    const nom = $("nom-profil").value.trim(), alerte = $("alerte-nom");
    const dire = (t) => { alerte.textContent = t; alerte.hidden = false; };
    if (!nom) return dire("Donne un nom à ton profil.");
    if (estBase(nom)) return dire("Ce nom est celui d'un profil de base : choisis-en un autre.");
    if (profils[nom]) return dire("Tu as déjà un profil de ce nom : choisis-le dans la liste pour le modifier.");
    profils[nom] = { ...etat.r };
    etat = { nom, r: { ...etat.r } };
    $("creation").hidden = true; $("nouveau").setAttribute("aria-expanded", "false");
    if ($("reglages").hidden) $("modifier").click();   // le nouveau profil s'ouvre sur ses réglages
    changer();
  }
  $("creer").addEventListener("click", creer);
  $("nom-profil").addEventListener("keydown", (e) => { if (e.key === "Enter") creer(); });

  // ---------- équipement ----------
  const OUI_NON = [["oui", "Oui"], ["non", "Non"]];
  const QUESTIONS = [
    ["def", "Définition de l'écran", [["1080", "1080p"], ["4k", "4K"]], ""],
    ["hdr", "L'écran affiche le HDR", OUI_NON, "HDR10 ou HDR10+. Écran HDR peu lumineux (moins de 500 nits environ) : choisis plutôt « SDR préféré » dans le profil."],
    ["dv", "L'écran lit le Dolby Vision", OUI_NON, "Un fichier en Dolby Vision sans HDR10 s'affiche avec des couleurs fausses (vert / violet) sur un écran qui ne le lit pas."],
    ["av1", "Ton appareil lit l'AV1", OUI_NON, "L'appareil qui lit le fichier : la télé elle-même, une box, une clé HDMI… « Lit » = directement, sans conversion."],
    ["dts", "Ton appareil lit le DTS", OUI_NON, ""],
    ["avi", "Ton appareil lit les .avi", OUI_NON, ""],
    ["son", "Son", [["tv", "Télé"], ["barre", "Barre de son"], ["51", "5.1"], ["atmos", "Ampli Atmos"]], ""],
    ["priorite", "Priorité", [["place", "Gagner de la place"], ["equilibre", "Équilibre"], ["qualite", "Qualité d'abord"]], ""],
  ];
  let E = {};   // réponses en cours de saisie
  function resumeEquipement() {
    const e = equipement || {}, rempli = Object.keys(e).length > 0;
    $("resume-equipement").textContent = !rempli ? "Questionnaire pas encore rempli" : e.taille ? `Écran ${nb(e.taille)} pouces${e.distance ? `, vu à ${nb(e.distance)} m` : ""}` : "Taille de l'écran non renseignée";
    const NOMS = { hdr: "le HDR", dv: "le Dolby Vision", av1: "l'AV1", dts: "le DTS", avi: "les .avi" };
    const oui = Object.keys(NOMS).filter((k) => e[k] === "oui").map((k) => NOMS[k]), non = Object.keys(NOMS).filter((k) => e[k] === "non").map((k) => NOMS[k]);
    $("resume-lit").textContent = !rempli ? "Réglages neutres : rien n'est refusé, le Dolby Vision seul et les .avi sont déconseillés (× 0,9)."
      : [oui.length ? `Lit ${oui.join(", ")}` : "", non.length ? `ne lit pas ${non.join(", ")}` : ""].filter(Boolean).join(" · ") || "Aucune réponse sur ce que lisent l'écran et l'appareil.";
    $("ouvrir-equipement").textContent = rempli ? "Refaire le questionnaire" : "Remplir le questionnaire";
  }
  function dessinerQuestions() {
    const zone = $("questions");
    zone.replaceChildren();
    // écran : taille et distance
    const q0 = el("div", "q");
    q0.append(el("span", "lib", "Écran"));
    const mesure = el("div", "mesure");
    const champ = (k, label) => { const i = el("input", "court"); i.type = "text"; i.inputMode = "decimal"; i.value = E[k] ?? ""; i.setAttribute("aria-label", label); i.addEventListener("input", () => { E[k] = i.value; dessinerResultat(); }); return i; };
    mesure.append(champ("taille", "Taille en pouces"), "pouces, regardé à", champ("distance", "Distance en mètres"), "m");
    q0.append(mesure, el("span", "aide", "Vide = je ne sais pas. La distance sert à savoir si la 4K se voit depuis ta place."));
    zone.append(q0);
    for (const [k, lib, choix, aide] of QUESTIONS) {
      const q = el("div", "q");
      q.append(el("span", "lib", lib));
      const seg = el("span", "seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", lib);
      for (const [v, t] of [...choix, [null, "Je ne sais pas"]]) {
        const b = el("button", v === null ? "nsp" : "", t); b.type = "button";
        b.setAttribute("aria-pressed", String((E[k] ?? null) === v));
        b.addEventListener("click", () => { if (v === null) delete E[k]; else E[k] = v; dessinerQuestions(); dessinerResultat(); });
        seg.append(b);
      }
      q.append(seg);
      if (aide) q.append(el("span", "aide", aide));
      zone.append(q);
    }
  }
  function dessinerResultat() {
    const c = EQ.conseiller(E, V2), u = $("resultat");
    u.replaceChildren();
    for (const [reglage, valeur, pourquoi] of c.L) { const l = el("li"); l.append(el("b", "", reglage), el("span", "valeur", valeur), el("span", "pourquoi", pourquoi)); u.append(l); }
    // 0.1.4 (choix du 17/11/2026) : « Mon équipement » est toujours créé, même quand les réponses donnent exactement un
    // profil de base (il est alors seulement signalé) : un profil à soi, que l'on peut retoucher sans toucher aux profils de base.
    $("effet").textContent = c.profil ? `En enregistrant : le profil « ${EQ.NOM_PROFIL} » est créé (ou mis à jour) dans Mes profils et devient ton profil actif.${c.base ? ` Ses réglages sont pour l'instant ceux du profil de base « ${c.base} ».` : ""}`
      : c.criteres ? "En enregistrant : ton profil actif ne change pas ; les critères d'équipement s'appliquent à tous les profils." : "Aucune réponse pour l'instant : rien ne change.";
  }
  function montrer(vue) { $("vue-principale").hidden = vue !== "principale"; $("vue-equipement").hidden = vue !== "equipement"; scrollTo(0, 0); }
  $("ouvrir-equipement").addEventListener("click", () => { E = { ...equipement }; for (const k of ["taille", "distance"]) if (E[k] != null) E[k] = String(E[k]).replace(".", ","); dessinerQuestions(); dessinerResultat(); montrer("equipement"); });
  $("retour").addEventListener("click", () => montrer("principale"));
  $("retour-bas").addEventListener("click", () => montrer("principale"));
  $("enregistrer-equipement").addEventListener("click", () => {
    equipement = EQ.nettoyer(E);
    V2.equipement(equipement);
    const c = EQ.conseiller(equipement, V2);
    if (c.profil) { profils[EQ.NOM_PROFIL] = { ...c.r }; etat = { nom: EQ.NOM_PROFIL, r: { ...c.r } }; }   // toujours (0.1.4)
    changer(); resumeEquipement(); montrer("principale");
    // confirmation (0.1.4) : ce qui vient d'être fait, visible en revenant sur la vue principale
    const conf = $("confirmation");
    conf.textContent = c.profil ? `Enregistré : profil « ${EQ.NOM_PROFIL} » créé (ou mis à jour) et activé.${c.base ? ` Mêmes réglages que « ${c.base} » pour l'instant.` : ""}`
      : c.criteres ? "Enregistré : tes critères d'équipement s'appliquent à tous les profils. Ton profil actif ne change pas." : "Enregistré : aucune réponse, rien ne change.";
    conf.hidden = false;
  });

  // ---------- mémoire des fiches, état, diagnostic ----------
  async function compter() {
    const tout = await lire(null), n = Object.keys(tout).filter((k) => k.startsWith("f:")).length;
    $("memoire").textContent = n === 0 ? "Aucune fiche gardée en mémoire" : `${n.toLocaleString("fr-FR")} fiche${n > 1 ? "s" : ""} gardée${n > 1 ? "s" : ""} en mémoire`;
    $("vider").disabled = n === 0;
  }
  let videArme = false;
  $("vider").addEventListener("click", async () => {
    if (!videArme) { videArme = true; $("vider").textContent = "Confirmer"; setTimeout(() => { videArme = false; $("vider").textContent = "Vider"; }, 4000); return; }
    videArme = false; $("vider").textContent = "Vider";
    const tout = await lire(null);
    await retirer(Object.keys(tout).filter((k) => k.startsWith("f:")));
    compter();
  });
  const ongletActif = () => new Promise((res) => { try { chrome.tabs.query({ active: true, currentWindow: true }, (t) => res((t && t[0]) || null)); } catch (e) { res(null); } });
  async function dessinerEtat() {
    const t = await ongletActif(), e = $("etat");
    let u = null;
    try { u = t && t.url ? new URL(t.url) : null; } catch (x) { u = null; }
    const c411 = u && /(^|\.)c411\.org$/.test(u.hostname);
    e.classList.toggle("active", !!c411);
    e.textContent = !c411 ? "ouvre une fiche de C411" : /^\/torrents\/[0-9a-f]{40}/i.test(u.pathname) ? "active sur cette fiche" : "active sur C411 (fiches)";
  }
  $("diagnostic").addEventListener("click", async () => {
    const zone = $("texte-diagnostic"), t = await ongletActif();
    const montrerTexte = (texte) => { zone.value = texte; zone.hidden = false; zone.focus(); zone.select(); };
    if (!t) return montrerTexte("Onglet introuvable.");
    try {
      chrome.tabs.sendMessage(t.id, { type: "notes-c411-diagnostic" }, async (rep) => {
        if (chrome.runtime.lastError || !rep) return montrerTexte("Pas de réponse de la page : ouvre une fiche de C411 (ou recharge-la avec F5), puis recommence.");
        montrerTexte(rep.texte);
        try { await navigator.clipboard.writeText(rep.texte); $("diagnostic").textContent = "Copié"; setTimeout(() => { $("diagnostic").textContent = "Copier le diagnostic"; }, 2500); } catch (e) { /* le texte reste sélectionné : Ctrl + C */ }
      });
    } catch (e) { montrerTexte("Pas de réponse de la page."); }
  });

  // ---------- départ ----------
  (async () => {
    const v = await lire(["profil", "profils", "equipement"]);
    profils = v.profils && typeof v.profils === "object" ? v.profils : {};
    equipement = v.equipement && typeof v.equipement === "object" ? v.equipement : {};
    V2.equipement(equipement);
    if (v.profil && v.profil.r) etat = { nom: v.profil.nom || DEFAUT, r: { ...V2.PROFILS[DEFAUT], ...v.profil.r } };
    dessinerProfil(); resumeEquipement(); compter(); dessinerEtat();
  })();
})();
