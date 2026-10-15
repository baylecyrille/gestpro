# GestPro – stock, devis, factures & Facebook (PWA)

Application web installable (PWA) pour un artisan / une petite entreprise. Les données sont **enregistrées dans un classeur
Google Sheets** de votre Drive (un onglet par type de données) et synchronisées entre vos appareils ; un cache local
(IndexedDB) permet de continuer à travailler hors ligne.

## Fonctions

- **Devis et factures : ajout par catégorie** : le bouton « 📦 Produit ▾ » propose les catégories Produit (fourniture), Matériel, Main d'œuvre, Sous-traitance et Ouvrage (les mêmes que le champ **Catégorie** de la fiche produit, qui devient une liste). Choisir une catégorie ouvre une ligne dont la désignation cherche, dès les premières lettres (sans tenir compte des accents), dans les produits de cette catégorie ; Entrée, ↑ ↓ ou un toucher reprennent désignation, unité, prix, référence et prix d'achat. Si la catégorie est vide ou si le produit est classé ailleurs, « Tout le catalogue » élargit la recherche ; « Tout le catalogue / scanner… » rouvre le sélecteur complet avec le scan. La ligne mémorise sa catégorie (`cat`). Un produit existant garde son ancienne catégorie (« ancienne catégorie » dans la liste) tant qu'on ne la change pas. Pas de composition des ouvrages pour l'instant.
- **Mise en forme du texte repliable** : l'encart au-dessus des lignes a disparu ; chaque bloc texte a un bouton « Aa » qui déplie ou replie sa barre de mise en forme (une ligne sur ordinateur). Les champs Intitulé et Remarque gardent leur barre. Depuis la v48 le bouton « Aa » existe aussi sur les **lignes produit** : gras, italique, souligné, couleur, surlignage, taille, alignement, listes et saut de ligne (↵ ou Maj + Entrée) agissent sur la désignation et s'impriment. `desig` reste le texte brut (recherche, facture électronique, contrôles) ; la mise en forme est dans `dhtml`, ignoré s'il ne correspond plus au texte. Le collage dans une désignation est en texte brut. Sur une ligne libre, le catalogue est proposé en tapant (liste maison à la place de la liste native du navigateur).
- **Classer les produits existants en lot** : bouton « 🏷 Classer (N) » dans Stock › Produits (N = produits hors des 5 catégories). Fenêtre avec filtre (À classer / Tous / Sans catégorie / chaque catégorie / anciennes catégories issues d'un import), recherche sans accents, « Tout cocher », catégorie à appliquer, changement ligne par ligne, enregistrement immédiat (synchronisé) et « ↩ Annuler » de la dernière opération.
- **Boutons d'ajout compacts** : une seule rangée de petits boutons (emoji + libellé sur ordinateur, emoji seuls sur téléphone, infobulle sur chacun).
- **Aide contextuelle** : le bouton « ? » de l'en-tête ouvre l'aide de l'écran affiché (accueil, liste et fiche chantier, planning et équipe, stock : produits / emplacements / mouvements, listes de ventes, éditeur de devis, facture ou avoir, contacts, réglages, Facebook). Le sujet s'ouvre sur la bonne section (sur une facture : « Factures et règlements » ; sur un avoir : « Les avoirs »). Une liste « Autres sujets » permet de passer à un autre écran, avec « Bien démarrer », « Un chantier de A à Z » et « Dépannage ». Les sujets proposés dépendent du profil d'accès. Textes statiques dans `js/help.js` (aucune donnée de l'entreprise), disponibles hors ligne.
- **Filtre par statut des chantiers** : dans « Filtres & tri », boutons Nouveau / Signé / En cours / Terminé / Perdu (plusieurs possibles) avec le nombre de chantiers de chaque statut ; dès qu'un statut est choisi, tous les chantiers de ce statut sont listés, quel que soit l'onglet (sans statut choisi, l'onglet Ouverts, Terminés, Perdus ou Tous délimite la liste).
- **Chantiers** : fiche centrale (client, architecte / maître d'œuvre, devis, factures, règlements, équipe affectée, jauges d'avancement, plan / itinéraire / Street View, liens, photos et fichiers dans le Drive), achats affectés et **rentabilité** (marge = facturé − matières − achats − main-d'œuvre).
- **Planning & équipe** : affectations par membre (semaine / mois), heures prévues et réalisées, habilitations avec alertes d'expiration, profils d'accès à code PIN.
- **Stock** : produits, **codes-barres**, zones › emplacements, entrées / sorties / transferts / inventaires, réception de colis, sortie chantier, alertes de seuil, import Excel / CSV.
- **Factures fournisseurs (PDF)** : lecture des lignes, affectation à un chantier ou à un emplacement de stock, mise à jour du catalogue, fournisseur créé automatiquement, PDF conservé dans le Drive. Les lignes peuvent aussi être reprises dans un devis ou une facture.
- **Ventes** (devis, factures, avoirs) : lignes produits ou libres, sections, **TVA par ligne** (taux par défaut du document, ventilation par taux dans les totaux, l'impression et la facture électronique), mise en page personnalisable, encaissements et acomptes, devis accepté → facture, avoirs (déduction ou remboursement), pièces jointes, impression / PDF.
- **Éditeur de devis / facture** : **barre de total fixe** en bas de l'écran (HT, TTC, bouton Enregistrer, pastille des points à vérifier) ; **en-tête repliable** (résumé client · chantier · date · statut) ; **aperçu du document à côté de l'éditeur** sur grand écran (≥ 1200 px, désactivable) ; **saisie rapide** (complétion de la désignation depuis le catalogue avec reprise du prix et de l'unité, touche Entrée pour passer au champ suivant puis à la ligne suivante, Ctrl + Entrée pour insérer une ligne, ligne compacte sur une seule rangée quand la place le permet) ; **remise par ligne (%)**, **remise sur le total (% ou €)** répartie au prorata des taux de TVA, **lignes en option** (imprimées sur le devis, non comptées dans le total, non reprises dans la facture) ; **duplication** d'un devis ou d'une facture en nouveau brouillon ; **contrôles avant enregistrement** (client, numéro déjà utilisé, ligne sans prix ou sans quantité, dates incohérentes, remise élevée, TVA à 0 %…) : une anomalie bloquante empêche l'enregistrement, un avertissement se confirme une fois par document.
- **Factures d'acompte** : bouton « Facture d'acompte » sur un devis, en **pourcentage** du devis, en **montant TTC** ou en **montant HT** (aperçu en direct, refus si le total des acomptes dépasse le devis). L'acompte est réparti entre les taux de TVA du devis (une ligne par taux) et suit la **numérotation des factures** ; le devis passe à « Accepté » (case à cocher) et les règlements déjà saisis sur le devis peuvent être rattachés à l'acompte. À la transformation du devis en facture, les acomptes valables sont **déduits taux par taux** : la facture finale imprime l'opération complète, la liste des factures d'acompte (n°, date, HT + TVA) puis le « net à payer ». Si une facture d'acompte est ensuite modifiée, annulée ou supprimée, l'éditeur de la facture finale le signale et propose « Mettre à jour les acomptes ». Une facture d'acompte annulée par un **avoir total** n'est plus déduite. En facture électronique : type 386 pour l'acompte ; pour la facture finale, opération complète, acomptes en « montant payé d'avance » et renvoi aux factures d'acompte. Les chiffres (CA, TVA collectée, chantier, tableau de bord) comptent chaque facture pour son montant propre : acomptes + solde = montant du devis, au centime.
- **Devis facturés** : un devis transformé en facture affiche un **bandeau** (« Ce devis est facturé », avec le numéro de la facture) rappelant que ses modifications ne changent pas la facture (utiliser « Dupliquer » pour repartir de ses lignes). Dans la liste des devis, un réglage **« Masquer les devis facturés »** (actif par défaut, mémorisé sur l'appareil) allège la vue : une ligne « n devis facturés masqués · Voir tout » reste affichée, et la recherche ou le filtre de statut « Facturé » les ré-affichent. Aucun devis n'est supprimé.
- **Import et correction des statuts** (Réglages › Importer des devis / factures) : l'import ajoute sans rien remplacer. Un fichier de **correction des statuts** (`mode: statuts`, uniquement des identifiants de devis et des statuts) est aussi accepté : il affiche le nombre de devis à modifier par statut, puis ne change que les devis importés encore « Facturé » (ou au statut qu'une correction précédente leur avait donné, champ optionnel `previous`) et sans facture créée depuis dans l'appli (un statut modifié à la main, un devis facturé depuis ou créé à la main est conservé). Le même fichier peut aussi corriger des **chantiers** (`chantiers`) : un chantier « Signé » dont tous les documents sont des devis importés restés « Envoyé » (ni facture, ni avoir, rien créé dans l'appli) repasse en « Nouveau ». Rien d'autre n'est touché ; une seconde application ne modifie plus rien.
- **Bouton « Options » de l'éditeur** (en haut, à côté d'Éditeur / Aperçu) : cases à cocher pour choisir ce qui se saisit et s'affiche. *TVA* : taux ligne par ligne (décoché, toutes les lignes suivent le taux de TVA du document, champ de l'en-tête). *Remises* : remise en % sur chaque ligne, remise sur le total. *Lignes* : référence du produit (colonne « Réf. » saisie et **imprimée** dès qu'une référence existe, et reprise en BT-155 dans la facture électronique), case « Option » des devis, sous-total par défaut des nouvelles sections. *Informations internes, jamais imprimées* : **prix d'achat et marge** (P.A. HT repris de la fiche produit, marge par ligne et au total, taux sur prix de vente, coefficient, nombre de lignes prises en compte), **stock disponible** (alerte si la quantité demandée — toutes lignes du même produit cumulées — dépasse le stock) et **photo** du produit. *Affichage* : aperçu à côté (grands écrans). Quand une saisie cachée contient déjà des valeurs comptées dans le total (taux de ligne, remises, lignes en option), une confirmation est demandée avant de les remettre à zéro ; une saisie déjà remplie n'est jamais cachée. Le choix est enregistré dans le document (repris par « Dupliquer » et par la transformation en facture) et sert de réglage par défaut des prochains documents sur l'appareil. Par défaut tout ce qui existait reste affiché ; référence, marge, stock et photo sont décochés.
- **Barre du bas** : les 8 sections s'affichent quand l'écran est assez large (≥ 544 px) ; sinon 5 sections et un menu « Plus ».
- **TVA à taux réduit (5,5 % / 10 %)** : depuis 2025 l'attestation papier (Cerfa 1301-SD / 1300-SD) n'existe plus ; le client certifie les conditions par une **mention imprimée sur le devis et la facture** (texte modifiable, désactivable par document). À conserver 5 ans avec les justificatifs. Texte à faire valider par votre cabinet comptable.
- **Envoi par e-mail** : PDF du document (même mise en page que l'impression) ou Factur-X joint, envoyé depuis votre compte Google via le script Apps Script (réponses vers l'e-mail de l'entreprise), ou via le menu de partage / la messagerie du téléphone. Historique des envois sur le document.
- **Facture électronique** : mentions obligatoires (SIREN client, nature d'opération, TVA sur les débits, adresse de livraison), contrôle avant dépôt et export **Factur-X** (PDF/A-3 + XML EN 16931) à déposer sur une plateforme agréée.
- **Tableau de bord** : chiffre d'affaires, encaissements, achats (stock et chantiers), TVA collectée / déductible / due, marge des chantiers en cours, planning, alertes. La tuile « Devis en attente » ne compte que les devis envoyés depuis moins de 90 jours.
- **Contacts** : clients, fournisseurs, architectes / maîtres d'œuvre, équipe.
- **Facebook** : modèles de publication, calendrier éditorial, statistiques, publication directe optionnelle (API Graph).
- **Google Sheets / Drive** : un onglet par type de données (les enregistrements trop volumineux sont répartis sur plusieurs lignes), synchronisation automatique entre appareils, plus fichiers et photos dans le dossier « GestPro » du Drive.
- **Sauvegarde / restauration** JSON dans Réglages.

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
Pour l'envoi d'e-mails : dans l'éditeur Apps Script, choisissez la fonction `autoriser`, cliquez ▶ **Exécuter** et acceptez les autorisations (classeur, Drive, envoi d'e-mails), puis redéployez une nouvelle version. Test dans l'appli : *Réglages → E-mails → Envoyer un e-mail de test*. Les envois sont limités à 40 par jour (quota Google : 100 pour un compte gratuit).

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
| `js/importer.js` | import additif d'un fichier GestPro et correction des statuts de devis importés |
| `js/stock.js` | produits, emplacements, mouvements, scan, import |
| `js/docs.js` | devis/factures, règlements, conversion, impression |
| `js/vat.js` | calcul des totaux : TVA par ligne, remises (ligne et total), lignes en option, ventilation par taux, acomptes déduits, répartition d'un acompte par taux, marge (prix d'achat par ligne) et colonne « Réf. » |
| `js/doccheck.js` | contrôles d'un document avant enregistrement |
| `js/docpdf.js`, `js/docmail.js` | PDF du document (html2canvas + pdf-lib) et envoi par e-mail |
| `js/efact.js`, `js/facturx-pdf.js` | facture électronique : mentions, contrôle, XML et PDF Factur-X |
| `js/facebook.js` | publication, calendrier, tableau de bord |
| `apps-script/Code.gs` | passerelle Apps Script à coller dans votre projet Google |
| `js/sheets.js` | connexion Google (Apps Script ou OAuth), création du classeur, synchronisation bidirectionnelle |
| `js/db.js`, `js/util.js`, `js/defaults.js` | cache IndexedDB, utilitaires/scanner, réglages par défaut |
| `sw.js`, `manifest.webmanifest` | hors ligne et installation |

## Limites connues / pistes

- Deux appareils qui émettent un document au même instant hors ligne peuvent obtenir le même numéro (le compteur est relu avant chaque numérotation quand le réseau est disponible).
- Acomptes : un avoir **partiel** sur une facture d'acompte n'est pas répercuté sur la facture finale (ajuster à la main) ; le « cadre de facturation » de la réforme (acompte, facture définitive après acompte) n'est pas porté par le profil EN 16931 : à vérifier avec la plateforme agréée et le cabinet comptable.
- Pas encore d'étiquettes code-barres imprimables ni de commandes fournisseurs.
- La publication directe Facebook nécessite une app Meta et un jeton de Page ; sinon utilisez « Partager ».
