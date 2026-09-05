// =====================================================================
//  /api/data — enovaQ (version HISTORISATION, 05/09/2026)
//  POST : un automate depose ses mesures (stockage memoire PAR device_id)
//         -> la reponse contient la config en attente pour ce device.
//  GET  : la supervision (pupitre) lit tous les devices.
//  NOUVEAU : chaque POST est AUSSI ajoute au fichier du jour dans le
//  compte de stockage (variable d'environnement ENOVAQ_STORAGE), sous
//  histo/AAAA-MM-JJ.jsonl (jour civil de Paris, 1 ligne JSON par envoi).
//  SANS AUCUNE dependance (acces REST signe, crypto de Node).
//  BLINDE : si le stockage manque ou echoue, l'automate et le pupitre
//  continuent EXACTEMENT comme avant (try/catch + delai maxi 3 s).
//  A placer dans api/data/index.js — package.json INCHANGE.
// =====================================================================
const crypto = require("crypto");
const store = global._enovaq = global._enovaq || { devices: {}, configs: {} };

// ---- mini client Blob (SharedKey), le seul dont on a besoin ----------
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
    const chrono = setTimeout(() => ac.abort(), delaiMs || 5000);
    try {
      return await fetch(url, { method: methode, headers: h,
        body: corps && corps.length ? corps : undefined, signal: ac.signal });
    } finally { clearTimeout(chrono); }
  }
  return { appel };
}

// ---- heure civile de Paris (ete/hiver automatiques) -------------------
const fmtParis = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});
function parisLocal(d) { return fmtParis.format(d).replace(" ", "T"); }

// ---- cache (reutilise entre les envois de 5 s) ------------------------
const hc = { client: null, cs: "", jour: "", pret: false };

async function historiser(context, body, recuA) {
  const cs = process.env.ENOVAQ_STORAGE;
  if (!cs) return;                                  // pas configure : silence
  if (!hc.client || hc.cs !== cs) {
    hc.client = clientBlob(cs); hc.cs = cs; hc.jour = ""; hc.pret = false;
  }
  const tl = parisLocal(recuA);                     // "2026-09-05T10:23:45"
  const jour = tl.slice(0, 10);
  if (hc.jour !== jour || !hc.pret) {
    let r = await hc.client.appel("PUT", "/histo", { restype: "container" }, null, null, 3000);
    if (r.status !== 201 && r.status !== 409)
      throw new Error("creation du conteneur : " + r.status);
    r = await hc.client.appel("PUT", "/histo/" + jour + ".jsonl", null, null,
      { "x-ms-blob-type": "AppendBlob", "If-None-Match": "*" }, 3000);
    if (r.status !== 201 && r.status !== 409 && r.status !== 412)
      throw new Error("creation du fichier du jour : " + r.status);
    hc.jour = jour; hc.pret = true;
  }
  const ligne = Buffer.from(JSON.stringify(
    Object.assign({ t: recuA.toISOString(), tl: tl }, body)) + "\n", "utf-8");
  const r = await hc.client.appel("PUT", "/histo/" + jour + ".jsonl",
    { comp: "appendblock" }, ligne, null, 3000);
  if (r.status !== 201) throw new Error("ajout refuse : " + r.status);
}

module.exports = async function (context, req) {
  if (req.method === "POST") {
    const body = req.body || {};
    const id = body.device_id || "inconnu";
    const recuA = new Date();
    store.devices[id] = { data: body, receivedAt: recuA.toISOString() };
    try { await historiser(context, body, recuA); }
    catch (e) {
      hc.pret = false;                              // on retentera au prochain
      try { context.log("historisation KO : " + (e && e.message)); } catch (_) {}
    }
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, config: store.configs[id] || null },
    };
  } else {
    const out = {};
    for (const [id, d] of Object.entries(store.devices))
      out[id] = Object.assign({}, d.data, { _received_at: d.receivedAt });
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { devices: out, configs: store.configs },
    };
  }
};
