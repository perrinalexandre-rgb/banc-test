/* =========================================================================
 *  enovaQ — api/histo/index.js — VERSION 2 (refournie le 12/09/2026)
 *  -----------------------------------------------------------------------
 *  Reecriture equivalente a la v2 remise le 07/09 (« enovaQ histo index v2
 *  pour Alex.txt ») : meme contrat, meme comportement — si tu as encore le
 *  fichier du 07/09, l'un ou l'autre convient ; celui-ci ajoute le mode
 *  essai=2 (diagnostic du stockage).
 *
 *  POUR ALEX — a coller TEL QUEL comme CONTENU de api/histo/index.js dans
 *  le depot du site Azure (blue-tree…). Le .txt n'est la que pour passer
 *  les filtres mail : on colle le CONTENU, on ne renomme rien, on ne
 *  touche pas a function.json. Commit + push : Azure redeploie seul.
 *
 *  CE QUE FAIT CETTE FONCTION
 *  - GET /api/histo?jour=AAAA-MM-JJ&de=HH:MM&a=HH:MM
 *      renvoie, en TEXTE BRUT (une ligne JSON par ligne), les lignes de
 *      l'historique du jour dont l'heure de Paris « tl » est dans
 *      [de, a).  a = 24:00 accepte pour « jusqu'a minuit ».
 *  - La regle qui remplace la v1 : le fichier d'un jour peut faire
 *      50-85 Mo — ON NE LE CHARGE JAMAIS EN ENTIER. Lecture PAR TRANCHES
 *      (2 Mo), reperage du debut de fenetre par dichotomie sur le blob,
 *      et ARRET DE LA LECTURE des que la fenetre est passee.
 *  - Fenetre limitee a 61 minutes : au-dela, 413 (le pupitre du lot 45+
 *      demande heure par heure, c'est prevu pour).
 *  - Jour absent : 404 (le pupitre saute le jour, c'est prevu aussi).
 *  - /api/histo?essai=1 : repond { ok:true, version:"v2", ... } SANS
 *      toucher au stockage — c'est le test « le collage a pris ».
 *  - /api/histo?essai=2 : diagnostic — liste les conteneurs du compte et
 *      dit si le blob du jour existe (utile si le rangement differe).
 *
 *  RANGEMENT ATTENDU (celui de l'archivage en service depuis le 07/09) :
 *      conteneur « histo », blob « AAAA-MM-JJ.jsonl », ~1 ligne / 3 s,
 *      chaque ligne = le JSON publie par l'automate + « tl » (heure de
 *      Paris HH:MM:SS) pose a l'ecriture.
 *  Connexion : variable d'application ENOVAQ_STORAGE (repli :
 *      AzureWebJobsStorage si elle manque — dit dans essai=1).
 * ========================================================================= */

const { BlobServiceClient } = require("@azure/storage-blob");

const CONTENEUR   = "histo";
const TRANCHE     = 2 * 1024 * 1024;   /* 2 Mo par lecture               */
const FENETRE_MAX = 61;                /* minutes — au-dela : 413        */

function chaineConnexion() {
  return process.env.ENOVAQ_STORAGE || process.env.AzureWebJobsStorage || "";
}

/* petite aide : lire [debut, fin) du blob en Buffer */
async function lirePlage(blob, debut, longueur) {
  if (longueur <= 0) return Buffer.alloc(0);
  const r = await blob.download(debut, longueur);
  const morceaux = [];
  for await (const m of r.readableStreamBody) morceaux.push(m);
  return Buffer.concat(morceaux);
}

/* heure « tl » (HH:MM:SS) de la premiere ligne COMPLETE apres l'offset —
 * on lit un petit bout, on saute la ligne entamee, on regarde la suivante */
async function heureApres(blob, offset, taille) {
  const bout = await lirePlage(blob, offset, Math.min(64 * 1024, taille - offset));
  let t = bout.toString("utf8");
  if (offset > 0) {
    const nl = t.indexOf("\n");
    if (nl < 0) return null;
    t = t.slice(nl + 1);
  }
  const fin = t.indexOf("\n");
  const ligne = fin >= 0 ? t.slice(0, fin) : t;
  const m = /"tl"\s*:\s*"(\d\d:\d\d:\d\d)"/.exec(ligne);
  return m ? m[1] : null;
}

module.exports = async function (context, req) {
  const q = (req.query || {});
  const tetes = {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };
  const json = (status, corps) => {
    context.res = { status, headers: { ...tetes, "Content-Type": "application/json; charset=utf-8" },
                    body: JSON.stringify(corps) };
  };

  try {
    /* ----- essai=1 : le collage a pris, sans toucher au stockage ----- */
    if (q.essai === "1") {
      json(200, { ok: true, version: "v2 (12/09/2026)",
                  connexion: process.env.ENOVAQ_STORAGE ? "ENOVAQ_STORAGE"
                           : process.env.AzureWebJobsStorage ? "AzureWebJobsStorage (repli)"
                           : "AUCUNE — a configurer",
                  conteneur_attendu: CONTENEUR });
      return;
    }

    const cxn = chaineConnexion();
    if (!cxn) { json(500, { erreur: "aucune chaine de stockage (ENOVAQ_STORAGE absente)" }); return; }
    const service = BlobServiceClient.fromConnectionString(cxn);

    /* ----- essai=2 : diagnostic du rangement ----- */
    if (q.essai === "2") {
      const conteneurs = [];
      for await (const c of service.listContainers()) conteneurs.push(c.name);
      const jour = q.jour || new Date().toISOString().slice(0, 10);
      let present = false, taille = 0;
      try {
        const p = await service.getContainerClient(CONTENEUR)
                               .getBlockBlobClient(jour + ".jsonl").getProperties();
        present = true; taille = p.contentLength || 0;
      } catch (_) { /* absent */ }
      json(200, { ok: true, version: "v2", conteneurs, conteneur_attendu: CONTENEUR,
                  blob_du_jour: jour + ".jsonl", present, taille });
      return;
    }

    /* ----- parametres ----- */
    const jour = String(q.jour || "");
    let de = String(q.de || "00:00"), a = String(q.a || "24:00");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) { json(400, { erreur: "jour attendu AAAA-MM-JJ" }); return; }
    if (!/^\d{2}:\d{2}$/.test(de) || !(/^\d{2}:\d{2}$/.test(a) || a === "24:00")) {
      json(400, { erreur: "de/a attendus HH:MM (a = 24:00 accepte)" }); return;
    }
    const minutes = t => t === "24:00" ? 1440 : (+t.slice(0, 2)) * 60 + (+t.slice(3, 5));
    if (minutes(a) <= minutes(de)) { json(400, { erreur: "fenetre vide (a <= de)" }); return; }
    if (minutes(a) - minutes(de) > FENETRE_MAX) {
      json(413, { erreur: "fenetre trop large (" + (minutes(a) - minutes(de))
                        + " min > " + FENETRE_MAX + ") — demandez heure par heure" });
      return;
    }

    /* ----- le blob du jour ----- */
    const blob = service.getContainerClient(CONTENEUR).getBlockBlobClient(jour + ".jsonl");
    let taille = 0;
    try { taille = (await blob.getProperties()).contentLength || 0; }
    catch (e) {
      if (e.statusCode === 404) { json(404, { erreur: "pas d'historique le " + jour }); return; }
      throw e;
    }
    if (taille === 0) { json(404, { erreur: "historique vide le " + jour }); return; }

    /* ----- dichotomie : trouver un point de depart AVANT la fenetre.
       Le fichier est chronologique (ecrit au fil de l'eau) : on cherche
       le plus grand offset dont la ligne suivante est encore < de. ----- */
    const cible = de + ":00";
    let bas = 0, haut = taille;
    for (let i = 0; i < 22 && haut - bas > TRANCHE; i++) {
      const mi = Math.floor((bas + haut) / 2);
      const h = await heureApres(blob, mi, taille);
      if (h === null) { haut = mi; continue; }     /* fin de fichier / illisible */
      if (h < cible) bas = mi; else haut = mi;
    }

    /* ----- lecture sequentielle depuis `bas`, arret des la fenetre passee ----- */
    const finFen = a === "24:00" ? "99:99:99" : a + ":00";
    let position = bas, reste = "", sorties = [], fini = false;
    while (position < taille && !fini) {
      const morceau = await lirePlage(blob, position, Math.min(TRANCHE, taille - position));
      position += morceau.length;
      let texte = reste + morceau.toString("utf8");
      const derniereNL = texte.lastIndexOf("\n");
      if (derniereNL < 0) { reste = texte; continue; }
      reste = texte.slice(derniereNL + 1);
      texte = texte.slice(0, derniereNL);
      for (const ligne of texte.split("\n")) {
        const m = /"tl"\s*:\s*"(\d\d:\d\d:\d\d)"/.exec(ligne);
        if (!m) continue;                       /* ligne abimee : sautee   */
        if (m[1] < cible) continue;             /* avant la fenetre        */
        if (m[1] >= finFen) { fini = true; break; }  /* fenetre passee : STOP */
        sorties.push(ligne);
      }
    }
    if (!fini && reste) {                        /* derniere ligne sans \n  */
      const m = /"tl"\s*:\s*"(\d\d:\d\d:\d\d)"/.exec(reste);
      if (m && m[1] >= cible && m[1] < finFen) sorties.push(reste);
    }

    context.res = { status: 200, headers: tetes,
                    body: sorties.length ? sorties.join("\n") + "\n" : "" };
  } catch (e) {
    json(500, { erreur: "histo v2 : " + (e && e.message ? e.message : String(e)) });
  }
};
