// =====================================================================
//  /api/histo — enovaQ (05/09/2026) : lecture de l'historique.
//  GET ?liste=1                          -> { jours: ["2026-09-05", ...] }
//  GET ?jour=2026-09-05                  -> les lignes du jour (JSONL)
//  GET ?jour=2026-09-05&de=10:00&a=11:00 -> seulement 10 h -> 11 h (heure
//      de Paris — filtre sur l'horodatage local "tl" ecrit par /api/data,
//      ete/hiver deja regles). SANS dependance (REST signe, crypto Node).
//  A placer dans api/histo/index.js (function.json a cote).
// =====================================================================
const crypto = require("crypto");

function clientBlob(cs) {
  const m = {};
  for (const p of cs.split(";")) {
    const i = p.indexOf("=");
    if (i > 0) m[p.slice(0, i)] = p.slice(i + 1);
  }
  const compte = m.AccountName;
  const cle = Buffer.from(m.AccountKey || "", "base64");
  const base = (m.BlobEndpoint ||
    ("https://" + compte + ".blob.core.windows.net")).replace(/\/+$/, "");
  async function appel(methode, chemin, params, corps, entetes, delaiMs) {
    const url = new URL(base + chemin);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const h = Object.assign({
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": "2021-08-06",
    }, entetes || {});
    const xms = Object.keys(h).filter(k => k.startsWith("x-ms-")).sort()
      .map(k => k + ":" + h[k]).join("\n");
    const qs = [...url.searchParams.keys()].sort()
      .map(k => k.toLowerCase() + ":" + url.searchParams.get(k)).join("\n");
    const canon = "/" + compte + url.pathname + (qs ? "\n" + qs : "");
    const lg = corps && corps.length ? String(corps.length) : "";
    const aSigner = [methode,
      h["Content-Encoding"] || "", h["Content-Language"] || "", lg,
      h["Content-MD5"] || "", h["Content-Type"] || "", "",
      h["If-Modified-Since"] || "", h["If-Match"] || "",
      h["If-None-Match"] || "", h["If-Unmodified-Since"] || "",
      h["Range"] || ""].join("\n") + "\n" + xms + "\n" + canon;
    h["Authorization"] = "SharedKey " + compte + ":" +
      crypto.createHmac("sha256", cle).update(aSigner, "utf-8").digest("base64");
    const ac = new AbortController();
    const chrono = setTimeout(() => ac.abort(), delaiMs || 30000);
    try {
      return await fetch(url, { method: methode, headers: h,
        body: corps && corps.length ? corps : undefined, signal: ac.signal });
    } finally { clearTimeout(chrono); }
  }
  return { appel };
}

module.exports = async function (context, req) {
  const cs = process.env.ENOVAQ_STORAGE;
  if (!cs) {
    context.res = { status: 500, headers: { "Content-Type": "application/json" },
      body: { erreur: "Stockage non configure : la variable d'environnement "
                    + "ENOVAQ_STORAGE est absente sur ce site." } };
    return;
  }
  const cli = clientBlob(cs);
  const q = req.query || {};
  try {
    if (q.essai) {
      /* Verification de bout en bout : cree le conteneur si besoin et
         ecrit une ligne dans _essai.txt — renvoie l'erreur d'Azure EN
         CLAIR si quelque chose cloche (cle, droits, reseau). */
      let r = await cli.appel("PUT", "/histo", { restype: "container" }, null, null, 8000);
      if (r.status !== 201 && r.status !== 409)
        throw new Error("creation du conteneur : " + r.status + " — " + (await r.text()).slice(0, 300));
      r = await cli.appel("PUT", "/histo/_essai.txt", null, null,
        { "x-ms-blob-type": "AppendBlob", "If-None-Match": "*" }, 8000);
      if (r.status !== 201 && r.status !== 409 && r.status !== 412)
        throw new Error("creation du blob d'essai : " + r.status + " — " + (await r.text()).slice(0, 300));
      const lg = Buffer.from("essai " + new Date().toISOString() + "\n", "utf-8");
      r = await cli.appel("PUT", "/histo/_essai.txt", { comp: "appendblock" }, lg, null, 8000);
      if (r.status !== 201)
        throw new Error("ecriture d'essai : " + r.status + " — " + (await r.text()).slice(0, 300));
      context.res = { status: 200, headers: { "Content-Type": "application/json" },
        body: { ok: true, message: "Stockage operationnel : le kit peut archiver." } };
      return;
    }
    if (q.liste) {
      const r = await cli.appel("GET", "/histo",
        { restype: "container", comp: "list" }, null, null, 15000);
      if (r.status === 404) {
        context.res = { status: 200, headers: { "Content-Type": "application/json" },
                        body: { jours: [] } };
        return;
      }
      if (!r.ok) throw new Error("liste : " + r.status);
      const xml = await r.text();
      const jours = [];
      for (const m of xml.matchAll(/<Name>(\d{4}-\d{2}-\d{2})\.jsonl<\/Name>/g))
        jours.push(m[1]);
      jours.sort();
      context.res = { status: 200, headers: { "Content-Type": "application/json" },
                      body: { jours: jours } };
      return;
    }
    const jour = q.jour || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) {
      context.res = { status: 400, headers: { "Content-Type": "application/json" },
        body: { erreur: "Precisez ?jour=AAAA-MM-JJ (en option &de=HH:MM&a=HH:MM), ou ?liste=1." } };
      return;
    }
    const r = await cli.appel("GET", "/histo/" + jour + ".jsonl", null, null, null, 60000);
    if (r.status === 404) {
      context.res = { status: 404, headers: { "Content-Type": "application/json" },
        body: { erreur: "Aucun historique pour le " + jour + "." } };
      return;
    }
    if (!r.ok) throw new Error("lecture du " + jour + " : " + r.status);
    const texte = await r.text();
    const de = q.de || "00:00";
    const a  = q.a  || "24:00";
    let corps;
    if (de === "00:00" && a === "24:00") corps = texte;
    else {
      const borneDe = jour + "T" + de + (de.length === 5 ? ":00" : "");
      const borneA  = jour + "T" + a  + (a.length === 5 ? ":00" : "");
      const garde = [];
      for (const l of texte.split("\n")) {
        if (!l) continue;
        const i = l.indexOf('"tl":"');
        const tl = i >= 0 ? l.slice(i + 6, i + 25) : "";
        if (tl >= borneDe && tl < borneA) garde.push(l);
      }
      corps = garde.join("\n") + (garde.length ? "\n" : "");
    }
    context.res = { status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" }, body: corps };
  } catch (e) {
    context.res = { status: 500, headers: { "Content-Type": "application/json" },
      body: { erreur: "Lecture impossible : " + (e && e.message ? e.message : e) } };
  }
};
