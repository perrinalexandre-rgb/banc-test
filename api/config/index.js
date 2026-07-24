// /api/config : POST = la page Reglages depose une config pour un device.
//               GET  = lecture de la/les config(s) en attente (debug/supervision).
// La config est ecrite dans le meme store global que /api/data, donc /api/data
// la renverra a l'ESP dans la reponse de son prochain POST (champ "config").
//
// Securite : le POST exige l'en-tete x-api-key, compare a la variable
// d'application CONFIG_API_KEY (definie dans le portail Azure). Si CONFIG_API_KEY
// n'est pas definie, le depot est refuse (fail-safe) plutot qu'ouvert a tous.

const store = global._enovaq = global._enovaq || { devices: {}, configs: {} };

module.exports = async function (context, req) {
  // --- GET : lecture des configs en attente (pratique pour verifier) ---
  if (req.method === "GET") {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { configs: store.configs }
    };
    return;
  }

  // --- POST : depot d'une nouvelle config ---
  const expected = process.env.CONFIG_API_KEY;
  const provided = req.headers["x-api-key"];

  if (!expected) {
    context.res = { status: 500, body: { error: "CONFIG_API_KEY non definie cote serveur" } };
    return;
  }
  if (provided !== expected) {
    context.res = { status: 401, body: { error: "cle invalide" } };
    return;
  }

  const cfg = req.body || {};
  const id = cfg.device_id || "chaufferie-01";

  // cfg_version doit etre un nombre et strictement superieur a la version deja
  // stockee, sinon on ignore (evite les rejeux et les envois en boucle).
  const incoming = Number(cfg.cfg_version);
  if (!Number.isFinite(incoming)) {
    context.res = { status: 400, body: { error: "cfg_version manquante ou invalide" } };
    return;
  }
  const current = store.configs[id] ? Number(store.configs[id].cfg_version) || 0 : 0;
  if (incoming <= current) {
    context.res = {
      status: 409,
      body: { error: "cfg_version doit etre superieure a " + current, current }
    };
    return;
  }

  // On stocke la config telle quelle : l'ESP piochera les champs qu'il connait.
  store.configs[id] = cfg;

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { success: true, device_id: id, cfg_version: incoming }
  };
};
