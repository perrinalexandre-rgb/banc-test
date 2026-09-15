/* =========================================================================
 *  enovaQ — api/histo/index.js — VERSION 2.2 (15/09/2026, soir)
 *  -----------------------------------------------------------------------
 *  REMPLACE la v2.1. En plus du ZERO DEPENDANCE : la fonction ne peut
 *  PLUS mourir en silence (« Backend call failure ») — budget de temps
 *  interne : si la lecture approche la limite d'Azure, elle repond un
 *  message PROPRE disant l'etape atteinte ; connexions reutilisees
 *  (beaucoup plus rapide) ; et essai=3 chronometre une vraie lecture.
 *  -----------------------------------------------------------------------
 *  REMPLACE la v2 du 12/09. Difference : ZERO DEPENDANCE — plus
 *  aucun « require » de bibliotheque a installer. La lecture du stockage
 *  Azure se fait en direct (https + crypto, fournis par Node lui-meme).
 *  Si la v2 mourait au demarrage avec « Cannot find module
 *  '@azure/storage-blob' », cette version regle le probleme : le collage
 *  seul suffit, quel que soit l'etat du projet.
 *
 *  POUR ALEX — coller TEL QUEL comme CONTENU de api/histo/index.js
 *  (on colle le contenu, on ne renomme rien, on ne touche pas a
 *  function.json). Commit + push : Azure redeploie seul (2-5 min).
 *
 *  CONTRAT (identique v2) :
 *   - GET /api/histo?jour=AAAA-MM-JJ&de=HH:MM&a=HH:MM
 *       -> TEXTE brut, une ligne JSON par ligne, heures de Paris « tl »
 *          dans [de, a). a = 24:00 accepte. Fenetre max 61 min (413).
 *   - Jour absent : 404. Lecture PAR TRANCHES (2 Mo) avec reperage par
 *       dichotomie et ARRET des que la fenetre est passee — le fichier
 *       d'un jour (50-85 Mo) n'est JAMAIS charge en entier.
 *   - /api/histo?essai=1 : { ok:true, version:"v2.1", ... } sans toucher
 *       au stockage — le test « le collage a pris ».
 *   - /api/histo?essai=2 : diagnostic — liste les conteneurs, dit si le
 *       blob du jour existe et sa taille.
 *
 *  RANGEMENT ATTENDU : conteneur « histo », blob « AAAA-MM-JJ.jsonl ».
 *  Connexion : variable d'application ENOVAQ_STORAGE (repli :
 *  AzureWebJobsStorage). essai=1 dit laquelle est utilisee.
 * ========================================================================= */

const https = require("https");
const crypto = require("crypto");

const CONTENEUR   = "histo";
const TRANCHE     = 2 * 1024 * 1024;
const FENETRE_MAX = 61;
const XMS_VERSION = "2020-10-02";
const AGENT = new https.Agent({ keepAlive: true, maxSockets: 4 });
const BUDGET_MS = 22000;   /* Azure coupe vers 30 s : on repond AVANT, proprement */

/* ----------------------------------------------------------------------
 *  Connexion : on lit AccountName / AccountKey / (BlobEndpoint ou
 *  EndpointSuffix) dans la chaine de connexion.
 * ---------------------------------------------------------------------- */
function compte() {
  const cxn = process.env.ENOVAQ_STORAGE || process.env.AzureWebJobsStorage || "";
  const p = {};
  cxn.split(";").forEach(m => {
    const i = m.indexOf("=");
    if (i > 0) p[m.slice(0, i).trim()] = m.slice(i + 1).trim();
  });
  if (!p.AccountName || !p.AccountKey) return null;
  const hote = p.BlobEndpoint
    ? p.BlobEndpoint.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    : p.AccountName + ".blob." + (p.EndpointSuffix || "core.windows.net");
  return {
    nom: p.AccountName,
    cle: Buffer.from(p.AccountKey, "base64"),
    hote,
    source: process.env.ENOVAQ_STORAGE ? "ENOVAQ_STORAGE"
                                       : "AzureWebJobsStorage (repli)",
  };
}

/* ----------------------------------------------------------------------
 *  Signature SharedKey (format officiel Azure, version 2015-02-21+) :
 *  VERB \n Content-Encoding \n Content-Language \n Content-Length \n
 *  Content-MD5 \n Content-Type \n Date \n If-Modified-Since \n If-Match
 *  \n If-None-Match \n If-Unmodified-Since \n Range \n
 *  en-tetes x-ms-* canonises \n /compte/chemin(+params canonises)
 * ---------------------------------------------------------------------- */
function requete(cpt, methode, chemin, params, range) {
  return new Promise((resoudre, rejeter) => {
    const date = new Date().toUTCString();
    const enTetes = {
      "x-ms-date": date,
      "x-ms-version": XMS_VERSION,
    };
    if (range) enTetes["Range"] = range;
    const canonHead = Object.keys(enTetes)
      .filter(k => k.startsWith("x-ms-"))
      .sort()
      .map(k => k + ":" + enTetes[k])
      .join("\n");
    const cles = Object.keys(params || {}).sort();
    const canonRes = "/" + cpt.nom + chemin
      + cles.map(k => "\n" + k.toLowerCase() + ":" + params[k]).join("");
    const aSigner = [
      methode, "", "", "", "", "", "", "", "", "", "",
      range || "",
      canonHead,
      canonRes,
    ].join("\n");
    const signature = crypto.createHmac("sha256", cpt.cle)
                            .update(aSigner, "utf8").digest("base64");
    enTetes["Authorization"] = "SharedKey " + cpt.nom + ":" + signature;
    const qs = cles.length
      ? "?" + cles.map(k => k + "=" + encodeURIComponent(params[k])).join("&")
      : "";
    const req = https.request(
      { host: cpt.hote, path: chemin + qs, method: methode, headers: enTetes,
        agent: AGENT },
      rep => {
        const morceaux = [];
        rep.on("data", m => morceaux.push(m));
        rep.on("end", () => resoudre({
          status: rep.statusCode,
          entetes: rep.headers,
          corps: Buffer.concat(morceaux),
        }));
      });
    req.on("error", rejeter);
    req.setTimeout(8000, () => { req.destroy(new Error("delai stockage (8 s)")); });
    req.end();
  });
}

const cheminBlob = jour => "/" + CONTENEUR + "/" + jour + ".jsonl";

async function tailleBlob(cpt, jour) {
  const r = await requete(cpt, "HEAD", cheminBlob(jour), {}, null);
  if (r.status === 404) return -1;
  if (r.status !== 200) throw new Error("HEAD " + r.status);
  return parseInt(r.entetes["content-length"] || "0", 10);
}

async function lirePlage(cpt, jour, debut, longueur) {
  if (longueur <= 0) return Buffer.alloc(0);
  const r = await requete(cpt, "GET", cheminBlob(jour), {},
                          "bytes=" + debut + "-" + (debut + longueur - 1));
  if (r.status !== 206 && r.status !== 200)
    throw new Error("GET " + r.status);
  return r.corps;
}

async function heureApres(cpt, jour, offset, taille) {
  const bout = await lirePlage(cpt, jour, offset,
                               Math.min(8 * 1024, taille - offset));
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
  const t0 = Date.now();
  let etape = "depart";
  const tempsMort = () => Date.now() - t0 > BUDGET_MS;
  const tetes = {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };
  const json = (status, corps) => {
    context.res = { status,
      headers: { ...tetes, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(corps) };
  };

  try {
    if (q.essai === "1") {
      const cpt = compte();
      json(200, { ok: true, version: "v2.2 (15/09/2026, zero dependance, budget interne)",
                  connexion: cpt ? cpt.source : "AUCUNE — a configurer",
                  compte: cpt ? cpt.nom : null,
                  conteneur_attendu: CONTENEUR });
      return;
    }

    const cpt = compte();
    if (!cpt) { json(500, { erreur: "aucune chaine de stockage (ENOVAQ_STORAGE absente)" }); return; }

    if (q.essai === "2") {
      const r = await requete(cpt, "GET", "/", { comp: "list" }, null);
      const conteneurs = [];
      const xml = r.corps.toString("utf8");
      const re = /<Name>([^<]+)<\/Name>/g;
      let m2; while ((m2 = re.exec(xml))) conteneurs.push(m2[1]);
      const jour = q.jour || new Date().toISOString().slice(0, 10);
      let taille = -1;
      try { taille = await tailleBlob(cpt, jour); } catch (e) { /* laisse -1 */ }
      json(200, { ok: true, version: "v2.2", conteneurs,
                  conteneur_attendu: CONTENEUR,
                  blob_du_jour: jour + ".jsonl",
                  present: taille >= 0, taille: Math.max(0, taille) });
      return;
    }

    if (q.essai === "3") {           /* une VRAIE lecture, chronometree */
      const j3 = String(q.jour || new Date().toISOString().slice(0, 10));
      etape = "essai3-head";
      const t1 = Date.now();
      const taille3 = await tailleBlob(cpt, j3);
      const msHead = Date.now() - t1;
      if (taille3 < 0) { json(404, { erreur: "pas d'historique le " + j3 }); return; }
      etape = "essai3-debut";
      const t2 = Date.now();
      const hDeb = await heureApres(cpt, j3, 0, taille3);
      const msDeb = Date.now() - t2;
      etape = "essai3-milieu";
      const t3 = Date.now();
      const hMil = await heureApres(cpt, j3, Math.floor(taille3 / 2), taille3);
      const msMil = Date.now() - t3;
      json(200, { ok: true, version: "v2.2", jour: j3, taille: taille3,
                  ms_head: msHead, tl_debut: hDeb, ms_debut: msDeb,
                  tl_milieu: hMil, ms_milieu: msMil, ms_total: Date.now() - t0 });
      return;
    }
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

    etape = "taille";
    const taille = await tailleBlob(cpt, jour);
    if (taille < 0)  { json(404, { erreur: "pas d'historique le " + jour }); return; }
    if (taille === 0){ json(404, { erreur: "historique vide le " + jour }); return; }

    const cible = de + ":00";
    let bas = 0, haut = taille;
    for (let i = 0; i < 26 && haut - bas > TRANCHE; i++) {
      etape = "dichotomie " + i + " [" + bas + ".." + haut + "]";
      if (tempsMort()) { json(500, { erreur: "budget depasse a l'etape " + etape,
                                     ms: Date.now() - t0 }); return; }
      const mi = Math.floor((bas + haut) / 2);
      const h = await heureApres(cpt, jour, mi, taille);
      if (h === null) { haut = mi; continue; }
      if (h < cible) bas = mi; else haut = mi;
    }

    const finFen = a === "24:00" ? "99:99:99" : a + ":00";
    let position = bas, reste = "", sorties = [], fini = false;
    while (position < taille && !fini) {
      etape = "lecture " + position + "/" + taille + " (" + sorties.length + " lignes)";
      if (tempsMort()) { json(500, { erreur: "budget depasse a l'etape " + etape,
                                     ms: Date.now() - t0 }); return; }
      const morceau = await lirePlage(cpt, jour, position,
                                      Math.min(TRANCHE, taille - position));
      position += morceau.length;
      let texte = reste + morceau.toString("utf8");
      const derniereNL = texte.lastIndexOf("\n");
      if (derniereNL < 0) { reste = texte; continue; }
      reste = texte.slice(derniereNL + 1);
      texte = texte.slice(0, derniereNL);
      for (const ligne of texte.split("\n")) {
        const m = /"tl"\s*:\s*"(\d\d:\d\d:\d\d)"/.exec(ligne);
        if (!m) continue;
        if (m[1] < cible) continue;
        if (m[1] >= finFen) { fini = true; break; }
        sorties.push(ligne);
      }
    }
    if (!fini && reste) {
      const m = /"tl"\s*:\s*"(\d\d:\d\d:\d\d)"/.exec(reste);
      if (m && m[1] >= cible && m[1] < finFen) sorties.push(reste);
    }

    context.res = { status: 200, headers: tetes,
                    body: sorties.length ? sorties.join("\n") + "\n" : "" };
  } catch (e) {
    json(500, { erreur: "histo v2.2 [" + etape + "] : "
                        + (e && e.message ? e.message : String(e)),
                ms: Date.now() - t0 });
  }
};
