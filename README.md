# GestPro – stock, devis, factures & Facebook (PWA)

Application web installable (PWA) pour un artisan / une petite entreprise. Les données sont **enregistrées dans un classeur
Google Sheets** de votre Drive (un onglet par type de données) et synchronisées entre vos appareils ; un cache local
(IndexedDB) permet de continuer à travailler hors ligne.

## Fonctions

- **Stock** : produits, lecture des **codes-barres** à la caméra (ou douchette USB/Bluetooth), **zones › emplacements**
  (ex. Atelier › Rack A), entrées / sorties / transferts / inventaires, alertes de seuil, historique des mouvements.
- **Import Excel / CSV** des produits (liste de factures, catalogue…) avec correspondance de colonnes et fusion des doublons.
- **Clients & fournisseurs** : fiches, restes dus par client.
- **Devis & factures** : lignes issues de la base produits ou libres, TVA, conditions de règlement (30 / 30 / 40 par défaut),
  **encaissements et acomptes**, **devis accepté → facture** (acomptes reportés), déduction du stock, **impression / PDF** au format des factures exemples.
- **Facebook** : modèles de publication, insertion de produits, photo, partage vers l'appli Facebook, calendrier éditorial,
  tableau de bord (relevés d'abonnés/portée, courbe, accès rapides Meta Business Suite), publication directe optionnelle via l'API Graph.
- **Google Sheets** : classeur « GestPro – Données » créé dans votre Drive (onglets Produits, Emplacements, Contacts, Devis_Factures,
  Reglements, Mouvements_stock, Facebook_publications, Facebook_stats, Reglages). Synchro automatique (après chaque modification,
  au retour du réseau, à l'ouverture) ; en cas de modification simultanée, la plus récente l'emporte, enregistrement par enregistrement.
- **Sauvegarde / restauration** JSON dans Réglages (en plus de Google Sheets).

## Mise en ligne (GitHub Pages)

```bash
cd gestpro
git remote add origin https://github.com/<votre-compte>/gestpro.git
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Source : GitHub Actions**. L'adresse sera `https://<votre-compte>.github.io/gestpro/`.
Ouvrez-la sur le téléphone → *Ajouter à l'écran d'accueil* / *Installer l'application*.
La caméra exige HTTPS (fourni par GitHub Pages).

> Le dépôt contient les valeurs par défaut de l'en-tête (identité de l'entreprise) mais **pas** l'IBAN, ni les jetons Facebook,
> ni vos données : tout cela reste dans l'appareil. Si vous préférez ne pas publier le nom/SIRET, créez un dépôt privé
> (Pages sur dépôt privé nécessite un plan GitHub payant) ou modifiez `js/defaults.js`.

## Configurer Google Sheets – méthode Apps Script (recommandée)

1. Créez un classeur Google Sheets (ex. « GestPro – Données ») et notez son identifiant : `https://docs.google.com/spreadsheets/d/<ID>/edit`.
2. Dans <https://script.google.com>, projet « GestPro » : collez `apps-script/Code.gs`, remplacez `SHEET_ID` (l'ID ci-dessus) et `SECRET` (une longue phrase de passe).
3. **Déployer → Nouveau déploiement → Application Web** : *Exécuter en tant que : Moi* ; *Qui a accès : Tout le monde*. Autorisez l'accès à votre feuille quand Google le demande.
4. Copiez l'URL qui se termine par `/exec`.
5. Dans l'appli : *Réglages → Google Sheets* : collez l'URL et la clé secrète, **Connecter et synchroniser**. Les onglets sont créés automatiquement.
6. Autre appareil : même URL + même clé.

Sécurité : l'URL de déploiement est publique mais toute requête sans la clé secrète est refusée ; ne partagez ni l'URL ni la clé.
Après toute modification de `Code.gs` : *Déployer → Gérer les déploiements → Modifier → Nouvelle version*.

## Autre méthode : OAuth Google (sans Apps Script, avancé – nécessite un projet Google Cloud)

1. <https://console.cloud.google.com> → nouveau projet « GestPro ».
2. *API et services → Bibliothèque* : activer **Google Sheets API**.
3. *Écran de consentement OAuth* : type Externe, ajouter votre adresse Gmail comme **utilisateur test**.
4. *Identifiants → ID client OAuth → Application Web*, « Origines JavaScript autorisées » : `https://<votre-compte>.github.io`
   (et `http://localhost:8080` pour les essais). Copier l'**ID client**.
5. Dans l'appli : *Réglages → Google Sheets* : coller l'ID client, enregistrer, puis **Créer le classeur Google Sheets**.
6. Autre appareil : même ID client, *Utiliser un classeur existant*, coller l'adresse du classeur.

L'appli n'a accès qu'aux fichiers qu'elle crée (permission `drive.file`). Le jeton Google est conservé sur l'appareil ~1 h puis
renouvelé silencieusement ; si le bouton « ☁ reconnecter » apparaît en haut, touchez-le.
Ne sont **jamais** envoyés dans le classeur : jeton Facebook, logo, photos des publications.
Les colonnes lisibles du classeur sont un reflet des données : modifiez via l'appli ; les colonnes `id`, `maj`, `supprime`, `json` ne doivent pas être touchées.

## Test local

```bash
python3 -m http.server 8080   # puis http://localhost:8080
```

## Structure

| Fichier | Rôle |
|---|---|
| `index.html`, `css/style.css` | coque de l'appli, styles, mise en page d'impression |
| `app.js` | routeur, accueil, contacts, réglages, sauvegarde |
| `js/stock.js` | produits, emplacements, mouvements, scan, import |
| `js/docs.js` | devis/factures, règlements, conversion, impression |
| `js/facebook.js` | publication, calendrier, tableau de bord |
| `apps-script/Code.gs` | passerelle Apps Script à coller dans votre projet Google |
| `js/sheets.js` | connexion Google (Apps Script ou OAuth), création du classeur, synchronisation bidirectionnelle |
| `js/db.js`, `js/util.js`, `js/defaults.js` | cache IndexedDB, utilitaires/scanner, réglages par défaut |
| `sw.js`, `manifest.webmanifest` | hors ligne et installation |

## Limites connues / pistes

- Deux appareils qui émettent un document au même instant hors ligne peuvent obtenir le même numéro (le compteur est relu avant chaque numérotation quand le réseau est disponible).
- Pas encore d'étiquettes code-barres imprimables ni de commandes fournisseurs.
- La publication directe Facebook nécessite une app Meta et un jeton de Page ; sinon utilisez « Partager ».
