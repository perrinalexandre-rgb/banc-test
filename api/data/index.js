// API minimale : POST = l'ESP32 depose son JSON, GET = le dashboard le lit.
// La donnee vit en memoire (volatile) : suffisant pour tester la chaine.
// UPGRADE plus tard : ecrire dans Azure Table Storage pour garder l'historique.
let latestData = { message: "En attente ESP32..." };
let receivedAt = null;

module.exports = async function (context, req) {
  if (req.method === "POST") {
    latestData = req.body || {};
    receivedAt = new Date().toISOString();
    context.res = { status: 200, body: { success: true } };
  } else {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ...latestData, _received_at: receivedAt }
    };
  }
};
