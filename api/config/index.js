// /api/config : POST = deposer une config pour un device (protege par cle),
//               GET  = lire la config en attente (?device_id=xxx).
// La config sera livree au device dans la reponse de son prochain POST /api/data.
const store = global._enovaq = global._enovaq || { devices: {}, configs: {} };

const API_KEY = "enovaq-test-2026";   // <- cle de TEST, a changer + passer en
                                      //    variable d'environnement plus tard

module.exports = async function (context, req) {
  if (req.method === "POST") {
    if ((req.headers["x-api-key"] || "") !== API_KEY) {
      context.res = { status: 401, body: { error: "cle API invalide" } };
      return;
    }
    const body = req.body || {};
    const id = body.device_id;
    const config = body.config;
    if (!id || !config || !config.cfg_version) {
      context.res = { status: 400, body: { error: "device_id et config.cfg_version requis" } };
      return;
    }
    store.configs[id] = config;
    context.res = { status: 200, body: { success: true, stored: config } };
  } else {
    const id = (req.query && req.query.device_id) || null;
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: id ? (store.configs[id] || {}) : store.configs
    };
  }
};
