![ReleaseScore](images/bandeau-releasescore.png)

# ReleaseScore

Extension Chrome qui affiche une **note sur 100** à côté de chaque version d'un film ou d'une série, directement sur les fiches de torrent du tracker, d'après ton profil. Elle complète le site sans le modifier.

**[Télécharger la dernière version](../../releases/latest)** (fichier `releasescore-x.y.z.zip`, dans « Assets »).

Pour noter aussi tes propres fichiers et remplacer ceux qui sont de qualité insuffisante ou trop lourds : **[LibraryScore](../../../libraryscore)**, l'outil complet pour NAS, avec les mêmes notes.

---

## Comment la note est calculée

Uniquement à partir de ce qui se mesure dans le MediaInfo de chaque version. Ni votes de confiance, ni bonus de team.

- **Vidéo** : résolution, débit réel de la piste, codec (H.264, H.265, AV1…), 10 bits, réglages d'encodage. Seuls les pixels utiles comptent : les bandes noires sont retirées.
- **Audio** : la meilleure piste dans ta langue (format, débit, canaux, Atmos).
- **Ton profil** : ce que tu veux (1080p ou 4K, VFF ou VO, HDR, poids visé en Go par heure de film…). La note baisse si un critère manque ou si le fichier dépasse ton plafond de poids.

Six profils sont fournis : HDLight 1080p (par défaut), 1080p Haute qualité, 4KLight, 4K HDR cinéma, Petit fichier, Qualité maximale. Tu peux les modifier ou en créer d'autres. Le questionnaire **« Ton équipement »** (taille de l'écran, distance, HDR, Dolby Vision…) crée un profil adapté à ta télé.

### Deux notations : rapide et poussée

Dans la fenêtre de l'extension, le réglage **« Notation »** propose deux façons de noter. La fiche ouverte se renote aussitôt quand tu changes.

- **Rapide** (par défaut) : débit, résolution, codec, 10 bits et effort de l'encodeur. Simple et stable.
- **Poussée** : tient compte en plus des **paramètres d'encodage publiés** dans le MediaInfo (CRF ou 2 passes, réglages qui gardent ou lissent le détail fin) et de la **difficulté du film**, mesurée sur ses versions encodées en x265 avec un CRF : un film plein de grain ou de mouvement demande plus de débit qu'un film calme. Sans paramètres publiés, ou s'ils ont été effacés, la version n'a ni bonus ni malus : elle est notée comme un encodage moyen, et le résumé l'indique (« Paramètres non publiés »). Un remux, un disque complet ou un WEB-DL non ré-encodé reste neutre.

### Les couleurs

**La couleur ne suit pas la note** : elle dit si la version correspond à ton profil.

| Couleur | Signification |
|---|---|
| 🟢 Vert | dans ton profil |
| 🟡 Jaune | un critère manque |
| 🔴 Rouge | plus lourd que ton plafond |
| ⚪ Gris | deux critères ou plus manquent |

Une version rouge peut donc avoir une meilleure note qu'une jaune : elle est meilleure, mais trop lourde pour ce que tu veux.

### Sur une fiche

- Une note à droite de chaque ligne du bloc « Versions » (rien dans les listes de recherche). Si la fenêtre est étroite, la note se place dans la ligne.
- ⭐ marque la meilleure note parmi les versions vertes.
- **Survol** d'une note : un résumé (vidéo, audio, ce qui manque). **Clic** : le résumé reste ouvert. **« Pourquoi cette note ? »** : le détail complet.
- « – » pas de MediaInfo sur la fiche · « ? » durée ou débit inconnus · « ! » fiche non lue (bouton « Réessayer ») · « Bonus » torrent qui ne contient que les bonus, sans le film.
- À la première visite, les notes arrivent petit à petit (une fiche lue toutes les 0,67 s). En notation poussée, elles attendent que toutes les versions soient lues (la difficulté du film se mesure sur l'ensemble). Les fiches sont ensuite gardées : la fois suivante, tout s'affiche tout de suite.

---

## Installer

Sur ordinateur, avec Chrome. Elle devrait aussi fonctionner avec Edge ou Brave, mais ce n'est pas testé.

1. Télécharge `releasescore-x.y.z.zip` ([dernière version](../../releases/latest)), puis clic droit → « Extraire tout ». Range le dossier `releasescore` à un endroit où il restera : si tu le déplaces ou le supprimes, Chrome perd l'extension.
2. Dans la barre d'adresse de Chrome, tape `chrome://extensions` puis Entrée.
3. Active **« Mode développeur »**, en haut à droite.
4. Clique sur **« Charger l'extension non empaquetée »** et choisis le dossier `releasescore` (celui qui contient `manifest.json`).
5. Clique sur la pièce de puzzle à droite de la barre d'adresse, puis sur l'épingle à côté de ReleaseScore.
6. Ouvre une fiche de torrent (ou appuie sur F5 si elle était déjà ouverte).

L'extension n'est pas sur le Chrome Web Store : le mode développeur est la façon normale d'installer une extension téléchargée à part. Tout son code est lisible dans ce dépôt (dossier `releasescore`).

**Mettre à jour** : copie le contenu de la nouvelle version dans ton dossier `releasescore`, en remplaçant les fichiers. Garde le même dossier : avec un autre, tes profils seraient perdus. Puis, dans `chrome://extensions`, clique sur la flèche ronde de la carte ReleaseScore.

---

## Vie privée et autorisations

- L'extension lit les fiches avec ta session du navigateur, comme quand tu cliques toi-même. Aucune clé à donner, rien n'est envoyé ailleurs que sur le site du tracker.
- Elle ne s'active que sur le site du tracker. Autorisations demandées : `storage` et `unlimitedStorage` (garder tes profils et les fiches déjà lues, dans ton Chrome) et `activeTab` (savoir, quand tu ouvres la fenêtre de l'extension, si l'onglet affiché est une fiche, et en tirer le diagnostic).

## Un souci ?

Si une note te paraît fausse ou si l'affichage se décale : dans la fenêtre de l'extension, « Un problème d'affichage ? » → « Copier le diagnostic », et colle-le dans le sujet du forum avec le lien de la fiche. Le diagnostic ne contient ni identifiant ni clé.

## Licence

MIT : voir le fichier `LICENSE`.

**Keep the score up!**
