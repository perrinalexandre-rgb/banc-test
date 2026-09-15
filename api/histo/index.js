enovaQ — INSTRUCTIONS POUR ALEX — 15/09/2026 (remplace celles du 12/09)
=======================================================================
Deux mises en ligne dans le depot du site Azure (blue-tree-01b458e10).
Fichiers joints :
  1) « enovaQ histo index v2.1 pour Alex.txt »  -> devient api/histo/index.js
  2) « enovaQ pupitre 1509a.html »              -> devient la page du site

-----------------------------------------------------------------------
A. L'EXTRACTION (…/api/histo?essai=1 repond 500 aujourd'hui)
-----------------------------------------------------------------------
La v2.1 remplace la v2 : ZERO dependance — plus aucun module a installer,
elle lit le stockage en direct. Si ton collage du 12 etait bon mais que
la v2 mourait sur « Cannot find module '@azure/storage-blob' », cette
version regle le probleme d'elle-meme.

1. Ouvrir  api/histo/index.js  dans le depot.
2. REMPLACER TOUT SON CONTENU par le contenu du fichier joint
   « enovaQ histo index v2.1 pour Alex.txt ».
   (Contenu seulement — on ne renomme rien, on ne touche pas a
    function.json, on n'installe rien.)
3. Commit + push. Azure redeploie seul (2-5 min).

VERIFICATION, dans un navigateur :
   a) …azurestaticapps.net/api/histo?essai=1
      -> doit repondre { "ok": true, "version": "v2.1 …" }
   b) …/api/histo?jour=2026-09-13&de=22:00&a=23:00
      -> doit afficher des lignes de donnees
   c) En cas de doute sur le rangement : …/api/histo?essai=2
      (liste les conteneurs ; attendu « histo », blob AAAA-MM-JJ.jsonl)

SI a) repond ENCORE une erreur : portail Azure -> la Static Web App ->
Fonctions API -> Log stream, et envoyer la PREMIERE ligne d'erreur —
elle dira tout (collage tronque / deploiement non passe / autre).

Note : la v2.1 refuse les fenetres de plus d'une heure (413) — normal,
le pupitre demande heure par heure.

-----------------------------------------------------------------------
B. LE PUPITRE (le site sert encore un ancien fichier)
-----------------------------------------------------------------------
1. REMPLACER TOUT LE CONTENU de la page servie (index.html a la racine)
   par le contenu du fichier joint « enovaQ pupitre 1509a.html ».
2. Commit + push.
VERIFICATION : recharger (Ctrl+F5) — pied de page « ui 1509a.58 · lot 58 »,
la page s'ouvre sur le Pupitre simple (schema du batiment). Les photos
sont INCORPOREES au fichier : aucun dossier photos/ a creer.

-----------------------------------------------------------------------
Ces deux collages debloquent d'un coup : l'extraction Excel, le bouton
« Retablir AUTOMATIQUEMENT » (repose des compteurs effaces) et la future
« date de depart ». En cas de souci : la reponse exacte de A-a + la
premiere ligne du Log stream suffisent.
(Paquet produit par Claude Fable 5 pour enovaQ.)
