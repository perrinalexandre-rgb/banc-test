# Banc de test - chaine ESP32 -> Azure -> Dashboard

Kit minimal pour valider la chaine complete :
ESP32 (JSON via WiFi) -> API `/api/data` -> supervision `index.html`.

- `index.html` : supervision distante (lit /api/data toutes les 5 s)
- `api/data/` : fonction Azure (POST = depot ESP32, GET = lecture dashboard)
- `.github/workflows/` : deploiement automatique a chaque commit

Le sketch ESP32 correspondant : `test_azure_minimal.ino`.
