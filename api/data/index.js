// /api/data : POST = un device depose ses mesures (stockage PAR device_id),
//             la REPONSE contient la config en attente pour ce device.
//             GET  = la supervision lit tous les devices.
// Stockage en memoire (volatile) via global pour partager avec /api/config.
const store = global._enovaq = global._enovaq || { devices: {}, configs: {} };

module.exports = async function (context, req) {
  if (req.method === "POST") {
    const body = req.body || {};
    const id = body.device_id || "inconnu";
    store.devices[id] = { data: body, receivedAt: new Date().toISOString() };
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, config: store.configs[id] || null }
    };
  } else {
    // GET : { devices: { id: { ...mesures, _received_at } } }
    const out = {};
    for (const [id, d] of Object.entries(store.devices))
      out[id] = { ...d.data, _received_at: d.receivedAt };
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { devices: out, configs: store.configs }
    };
  }
};
