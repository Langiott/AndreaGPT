# Collegamento telefono

Avvia-AndreaGPT.bat avvia anche il bridge ADB Windows. Richiede Node.js e gli
Android Platform Tools ufficiali in `runtime/platform-tools` (adb.exe).
Le chiavi di associazione restano nell'ADB dell'utente Windows; Docker invia
richieste al bridge autenticato e riceve anche i file delle foto.

Nel pannello Foto, aprire Collega:

- USB: attivare Debug USB, collegare un cavo dati, autorizzare il PC sul telefono,
  premere «Collega USB / cerca telefoni», poi «Usa questo telefono».
- QR: premere «Associa con QR», quindi sul telefono Debug wireless → Accoppia
  dispositivo con codice QR. Il QR scade dopo due minuti. Dopo l'associazione,
  selezionare il telefono dall'elenco. PC e telefono devono comunicare sulla LAN;
  il rilevamento QR richiede mDNS. Il QR non supera l'isolamento della rete ospiti.
- I campi manuali rimangono disponibili come alternativa.

Il bridge ascolta sulla porta 17839, richiede un token casuale e non abilita CORS.
Il token è nel file locale ignorato da Git `runtime/adb-bridge.json`:
non pubblicarlo. `Ferma-AndreaGPT.bat` arresta il bridge senza terminare
l'ADB eventualmente usato da Android Studio.

Per aggiornare solo il codice mantenendo il runtime AI già installato:

```powershell
# Una sola volta, prima dell'aggiornamento, conserva il runtime funzionante.
docker tag andreagpt-andreagpt:latest andreagpt-runtime:local
npm run build
docker build -f Dockerfile.app-update --build-arg RUNTIME_IMAGE=andreagpt-runtime:local -t andreagpt-andreagpt:latest .
docker compose up -d --no-build --no-deps andreagpt
```

Per nuove installazioni rimane disponibile la build completa con `Dockerfile`.
