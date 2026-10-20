// Aide contextuelle : le bouton « ? » de l'en-tête ouvre l'aide de l'écran affiché.
// Textes statiques (aucune donnée de l'entreprise) ; tout fonctionne hors ligne.
import * as db from './db.js';
import * as auth from './auth.js';
import { e, modal } from './util.js';

const ul = items => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
const table = (head, rows) => `<table class="htab"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const S = (title, html) => ({ title, html });

const canDocs = () => auth.can('quotes') || auth.can('invoices') || auth.can('credits');

/* ---------- Contenus : un sujet par écran ---------- */
export const TOPICS = {
  start: {
    title: 'Bien démarrer', icon: '🧭', ok: () => true,
    intro: `GestPro regroupe vos chantiers, le planning de l'équipe, le stock, les devis et les factures. Cette aide s'adapte à l'écran où vous êtes : touchez « ? » à tout moment.`,
    sections: [
      S('Se déplacer', `<p>La barre du bas donne accès aux sections :</p>${ul([
        '<b>Accueil</b> : chiffres de la période, alertes, planning des 7 jours',
        '<b>Chantiers</b> : fiches chantier, statuts, marge, documents liés',
        '<b>Planning</b> : affectations de l\'équipe, heures, habilitations',
        '<b>Stock</b> : produits, emplacements, mouvements, scan',
        '<b>Ventes</b> : devis, factures, avoirs',
        '<b>Plus</b> : Contacts, Facebook, Réglages'])}
        <p>Sur un écran étroit, cinq sections sont visibles et « Plus » ouvre les autres. Selon votre profil d'accès, certaines sections peuvent être masquées.</p>`),
      S('Hors ligne et synchronisation', `<p>Vos données sont enregistrées d'abord sur l'appareil : l'application continue de fonctionner sans réseau.</p>
        <p>Elles sont synchronisées avec un classeur Google Sheets de votre Drive, pour retrouver les mêmes données sur plusieurs appareils. Pour relier un appareil : <b>Réglages › Google Sheets</b>, collez l'adresse du script et la clé secrète, puis « Connecter et synchroniser ». Sur un second appareil, utilisez la même adresse et la même clé.</p>
        <p>Le bouton ☁ de l'en-tête force un échange immédiat et montre l'état de la synchronisation.</p>`),
      S('Profils d\'accès et code PIN', `<p>La protection est facultative. Elle démarre dès qu'un administrateur possède un code PIN : l'application demande alors un nom et un code à chaque ouverture. Les codes se définissent dans <b>Planning › Équipe</b>, fiche du membre (4 à 6 chiffres).</p>${table(['Profil', 'Accès'], [
        ['Administrateur', 'Tout : réglages, équipe, connexion Google Sheets, chiffres'],
        ['Gestionnaire', 'Devis, factures, avoirs, chantiers, contacts, stock, planning ; pas de tableau de bord ni de réglages'],
        ['Commercial', 'Ses propres devis et les contacts ; chantiers sans montants'],
        ['Compagnon / salarié', 'Son planning et ses chantiers sans montants, saisie de ses heures, stock'],
        ['Intervenant', 'Seulement son planning et les chantiers où il intervient, sans montants']])}
        <p>Il doit toujours rester au moins un administrateur actif avec un code.</p>`),
      S('Sauvegarder', `<p>Faites une sauvegarde avant toute grosse opération (import, nettoyage) : <b>Réglages › Sauvegarde › Exporter (JSON)</b>, et gardez le fichier hors de l'appareil. « Restaurer… » recharge un fichier de sauvegarde.</p>
        <p><b>Sauvegarde automatique</b> : une fois le script Apps Script relié, une copie datée part chaque semaine dans <b>GestPro/Sauvegardes</b> de votre Drive ou OneDrive (les 8 dernières sont gardées). Elle se fait à l'ouverture de l'application, après la synchronisation, seulement sur le compte administrateur ; l'application ne peut pas travailler quand elle est fermée. La copie ne contient ni les photos des produits (elles restent dans le classeur) ni les clés personnelles (jeton Facebook, identifiant Google). Pour la restaurer, téléchargez-la avec le bouton ⬇ puis utilisez « Restaurer… ».</p>`)
    ]
  },

  atoz: {
    title: 'Un chantier de A à Z', icon: '🏗', ok: () => true,
    intro: `Pour que les chiffres de l'accueil et la marge d'un chantier soient justes, suivez cet enchaînement.`,
    sections: [
      S('Les 11 étapes', `<ol>
        <li><b>Créer le client</b> dans <a href="#/contacts/client" data-go>Contacts</a> (et l'architecte, s'il y en a un). Raccourci : le bouton « Nouveau dossier » de l'accueil crée le client, le chantier et ouvre le devis d'un seul geste.</li>
        <li><b>Faire le devis</b> dans <a href="#/docs/quote" data-go>Ventes</a>, avec les produits du catalogue, puis l'enregistrer. Si le chantier n'existe pas, le bouton « + » de la zone Chantier le crée avec le client et l'adresse.</li>
        <li><b>Envoyer le devis par e-mail</b> : un devis en brouillon passe tout seul à « Envoyé ».</li>
        <li><b>Marquer le devis accepté</b> quand le client signe : le chantier passe en « Signé ».</li>
        <li><b>Encaisser l'acompte</b> : facture d'acompte, ou versement saisi dans « Règlements &amp; acomptes » du devis.</li>
        <li><b>Planifier</b> : affectez l'équipe dans le <a href="#/planning/week" data-go>planning</a>, avec dates et heures prévues. Passez le chantier « En cours » au démarrage.</li>
        <li><b>Approvisionner et sortir le matériel</b> : « Réception colis » à l'arrivée des marchandises, puis « Sortie chantier » (avec « Reprendre les besoins du devis »).</li>
        <li><b>Suivre</b> : avancement (curseur), heures réalisées, charges non facturées, photos, dans la <a href="#/sites/open" data-go>fiche du chantier</a>.</li>
        <li><b>Facturer</b> : « Transformer en facture » sur le devis (les acomptes sont déduits automatiquement), puis envoyer la facture.</li>
        <li><b>Encaisser le solde</b>. Quand tout le marché est facturé et réglé, le chantier passe seul en « Terminé ».</li>
        <li><b>Contrôler la rentabilité</b> dans la fiche du chantier : marge, matières, charges, main-d'œuvre.</li>
      </ol>`)
    ]
  },

  dashboard: {
    title: 'Accueil', icon: '🏠', ok: () => auth.can('dashboard'),
    intro: `L'accueil résume l'activité et signale ce qui demande une action.`,
    sections: [
      S('Les raccourcis du haut', `<p>Les boutons du haut ouvrent directement le scan de codes-barres, un <b>nouveau dossier</b>, un nouveau devis, une nouvelle facture, un nouveau chantier et la partie Facebook.</p>`),
      S('Nouveau dossier', `<p>Le bouton <b>+ Nouveau dossier</b> enchaîne en une seule fenêtre ce qu'on fait pour chaque nouvelle affaire :</p>${ul([
        '<b>1 · Client</b> : choisissez un client existant (la recherche filtre la liste), ou saisissez un nouveau client (nom, téléphone, e-mail, adresse). Si une fiche ressemble déjà à ce que vous tapez — même nom écrit autrement, même téléphone, même e-mail —, un bandeau la propose : « Choisir ce client » évite le doublon',
        '<b>2 · Chantier</b> : nom (sinon « Chantier » + nom du client), adresse des travaux (reprise de celle du client), dates prévues. Le chantier est créé au statut « Nouveau »',
        '<b>3 · Devis</b> : si la case est cochée, le devis s\'ouvre aussitôt en brouillon, déjà rattaché au client et au chantier ; sinon vous arrivez sur la fiche du chantier'])}
        <p>Les boutons « + Devis » et « + Chantier » restent disponibles pour les cas où le client ou le chantier existent déjà.</p>`),
      S('À faire aujourd\'hui', `<p>Le panneau placé en haut de l'accueil rassemble en <b>une seule liste</b> ce qui demande une action, du plus urgent au moins urgent :</p>${ul([
        '<b>Facture en retard</b> : échéance dépassée ; le bouton <b>↻ Relancer</b> ouvre le message de relance (voir « Relancer les devis et les factures »)',
        '<b>Habilitation expirée</b>, puis <b>Chantier en retard</b> (date de fin dépassée, chantier encore ouvert)',
        '<b>Chantier à facturer</b> : travaux à 100 % et reste à facturer, ou marché signé sans aucune facture',
        '<b>Devis à relancer</b> : envoyé sans réponse depuis plus de 10 jours',
        '<b>Chantier en dérive</b> : un chantier a dépassé les heures ou les coûts prévus par son devis signé (détail dans « Prévu contre réalisé » de la fiche chantier)',
        '<b>Matériel manquant</b> : le stock ne couvre pas ce que réservent les devis signés des chantiers ouverts (articles et chantiers concernés)',
        '<b>Stock bas</b> : produits sous leur seuil, regroupés en une ligne',
        '<b>Habilitation à renouveler</b> (bientôt expirée), <b>Chantier à terminer</b> (tout est facturé et encaissé) et <b>Chantier à planifier</b> (marché signé sans équipe affectée)'])}
        <p>Les huit premières actions sont visibles, les autres se déplient. Toucher une ligne ouvre le document, le chantier ou le stock concerné. Quand il n'y a rien à faire, le panneau l'indique. Il remplace les anciennes listes « À relancer », « Chantiers en retard », « Habilitations à renouveler » et « À réapprovisionner ».</p>`),
      S('Chiffres de la période', `<p>Choisissez la période dans la liste (30 jours, 3 ou 12 derniers mois, mois, trimestre, année, année dernière, ou « Date à date »). Les trois grandes tuiles :</p>${ul([
        '<b>CA facturé HT</b> (net d\'avoirs) : le chiffre d\'affaires hors taxes des factures émises, avoirs déduits',
        '<b>Encaissé</b> : les règlements reçus sur la période',
        '<b>Reste à encaisser</b> : ce que les clients doivent encore, à ce jour, sur les factures émises pendant la période choisie (comme les autres chiffres). Le total toutes périodes est rappelé à côté de « Factures à encaisser ». Touchez la tuile pour ouvrir la liste des factures'])}
        <p>La carte <b>Achats &amp; TVA</b> donne les achats HT, la TVA collectée, déductible et due : ce sont des aides au calcul, à faire valider par votre cabinet comptable. La courbe compare, mois par mois, le CA HT (bleu) et les achats HT (orange).</p>`),
      S('Ce qui s\'affiche d\'autre', ul([
        '<b>Chantiers en cours &amp; marge</b> : les 8 chantiers ouverts les plus récents ; « (prév.) » = marge prévisionnelle. Tant qu\'aucun coût réel n\'est saisi, la marge est <b>estimée d\'après les prix d\'achat du devis</b> (« prév. devis ») ; sans prix d\'achat nulle part, la ligne indique <b>coûts non saisis</b> au lieu d\'une marge de 100 %. Une pastille orange ou rouge signale une dérive des heures ou des coûts',
        '<b>Planning des 7 prochains jours</b> : qui travaille où (affiché à côté des chantiers sur un grand écran, en dessous sur téléphone)',
        '<b>Factures à encaisser</b> : les plus anciennes d\'abord',
        '<b>Numéro en double</b> : deux documents de même type portent le même numéro (voir plus bas)',
        '<b>Sauvegarde automatique en retard</b> : la dernière copie date de plus de 10 jours ou a échoué'])),
      S('Relancer les devis et les factures', `<p>Les lignes <b>Facture en retard</b> et <b>Devis à relancer</b> du panneau « À faire aujourd'hui » apparaissent quand il y a quelque chose à faire. Rien n'est envoyé tout seul : chaque ligne a un bouton <b>Relancer</b> qui ouvre un e-mail prêt à envoyer (PDF joint), que vous relisez et modifiez avant l'envoi.</p>${ul([
        '<b>Devis envoyé</b> et sans réponse : proposé 10 jours après l\'envoi, puis tous les 7 jours, trois relances au plus (nombre réglable dans Réglages › Seuils et délais)',
        '<b>Facture échue</b> et non soldée : proposée 3 jours après l\'échéance, puis tous les 7 jours. Le message rappelle le reste dû et le retard ; dès la 2<sup>e</sup> relance il ajoute les pénalités et l\'indemnité de 40 €. À partir de la 3<sup>e</sup> relance, l\'écran suggère d\'envisager une mise en demeure',
        'Les factures <b>en litige</b>, brouillons, annulées, réglées ou entièrement couvertes par un avoir ne sont jamais proposées',
        '<b>Relance faite autrement</b> (téléphone, courrier, sur place) : enregistre la relance dans l\'historique du document sans envoyer d\'e-mail'])}
        <p>Les délais et les textes se règlent dans <b>Réglages › Relances</b>. Chaque document garde l'historique de ses relances ; le bouton <b>Relancer</b> existe aussi sur la page d'un devis envoyé ou d'une facture impayée.</p>`),
      S('Export pour le comptable', `<p>Le bouton <b>Export pour le comptable</b> (carte Achats &amp; TVA) prépare, pour une période (mois dernier, trimestre, année ou dates libres), des fichiers <b>CSV</b> qui s'ouvrent directement dans Excel : <b>ventes</b> (factures et avoirs, avec les montants HT et TVA par taux, l'encaissé et le reste dû), <b>règlements</b>, <b>achats</b> (réceptions de stock et achats de chantier, avec la TVA déductible), <b>TVA</b> (collectée et déductible par taux) et <b>heures</b> (absences comprises).</p>
        <p>Vous pouvez télécharger un fichier seul ou tout en un <b>ZIP</b> accompagné d'un petit « LISEZ-MOI ». Les avoirs et les remboursements sont en négatif. Rien n'est envoyé : les fichiers sont créés sur l'appareil.</p>
        <p class="warnnote">Ce sont des aides au calcul : faites valider la base de TVA par votre cabinet comptable.</p>`),
      S('TVA collectée à l\'encaissement', `<p>Pour les prestations de services et les travaux, la TVA est due à l'<b>encaissement</b> : l'accueil compte la part de TVA de chaque règlement reçu (au prorata de la facture), les remboursements d'avoir étant déduits. Les <b>livraisons de biens</b> restent comptées à la date de la facture, ainsi que toutes les factures si vous cochez l'option <b>TVA sur les débits</b> (Réglages › Entreprise / Mentions légales). Le chiffre d'affaires, lui, reste celui des factures émises.</p>`),
      S('Numéro en double', `<p>Si deux appareils émettent chacun un document hors ligne, ils peuvent attribuer le même numéro. L'accueil affiche alors un bandeau nommant les deux documents, et une alerte est donnée une fois après la synchronisation. Ouvrez l'un des deux et corrigez son numéro avant tout envoi : la numérotation doit rester unique et continue.</p>`),
      S('Sauvegarde automatique', `<p>Quand le script Apps Script est relié (Drive ou OneDrive), l'application dépose chaque semaine, à l'ouverture, une copie datée de vos données dans le dossier <b>GestPro/Sauvegardes</b> ; les 8 dernières sont conservées. Si la copie échoue ou n'a pas eu lieu depuis plus de 10 jours, un rappel apparaît ici avec le bouton <b>Sauvegarder maintenant</b>. Détails dans Réglages.</p>`),
      S('En un coup d\'œil', `<p>Quatre tuiles : <b>Devis en attente</b> (devis « Envoyé » datés de moins de 90 jours, durée réglable dans Réglages › Seuils et délais ; les plus anciens restent dans la liste des devis), <b>Chantiers ouverts</b> (Nouveau, Signé, En cours), <b>Stock bas / épuisé</b> et <b>Publications à faire</b> (Facebook).</p>
        <p>Tant que la configuration n'est pas terminée, la carte « Pour démarrer » propose cinq étapes ; « Masquer » la retire.</p>`)
    ]
  },

  sites: {
    title: 'Liste des chantiers', icon: '🏗', ok: () => auth.can('sites'),
    intro: `Un chantier regroupe tout ce qui concerne un client sur un lieu : devis, factures, règlements, équipe, matériel, photos et rentabilité.`,
    sections: [
      S('Les onglets, la recherche et les filtres', `<p>Les onglets délimitent la liste : <b>Ouverts</b> (Nouveau, Signé, En cours), <b>Terminés</b>, <b>Perdus</b>, <b>Tous</b>. La recherche porte sur le nom, le client et l'adresse.</p>
        <p><b>⚙ Filtres &amp; tri</b> : un petit chiffre indique le nombre de filtres actifs, « Effacer » les retire.</p>${ul([
        '<b>Trier par</b> : plus récents, nom, client, date de début, date de fin, montant du marché, reste à payer',
        '<b>Statuts</b> : cochez un ou plusieurs statuts (avec leur nombre). Dès qu\'un statut est coché, tous les chantiers de ce statut s\'affichent, quel que soit l\'onglet',
        '<b>Client</b>, <b>En retard</b> (fin dépassée), <b>Reste à payer</b>'])}
        <p>Les filtres choisis sont mémorisés sur l'appareil.</p>`),
      S('Créer un chantier', `<p>Touchez <b>+ Chantier</b>. Seul le nom est obligatoire.</p>${ul([
        '<b>Créer à partir d\'un devis</b> : rattache ce devis et ses factures au nouveau chantier',
        '<b>Adresse des travaux</b> : sert au plan, à l\'itinéraire et à Street View',
        '<b>Début / Fin prévue</b> : alimentent la jauge de délai et l\'alerte de retard',
        '<b>Couleur</b> : celle du chantier dans le planning'])}
        <p>On peut aussi créer un chantier depuis un devis ou une facture, avec le bouton « + » de la zone Chantier.</p>`),
      S('Les statuts', table(['Statut', 'Quand'], [
        ['Nouveau', 'Chantier créé, rien de signé'],
        ['Signé', 'Marché accepté. Automatique dès qu\'un devis du chantier est accepté ou facturé'],
        ['En cours', 'À choisir à la main quand les travaux démarrent'],
        ['Terminé', 'Bouton « ✓ Terminer le chantier », ou automatique quand tout est facturé et réglé'],
        ['Perdu', 'À choisir à la main (devis non retenu)']])
        + `<p>La clôture automatique se désactive dans Réglages › Ventes.</p>`)
    ]
  },

  site: {
    title: 'Fiche chantier', icon: '📋', ok: () => auth.can('sites'),
    intro: `La fiche rassemble tout le chantier, de haut en bas. Seuls les profils autorisés voient les montants.`,
    sections: [
      S('En-tête et boutons', `<p>Statut (liste déroulante), dates, client avec son téléphone, adresse, architecte, notes. Les boutons <b>🗺 Plan</b>, <b>🧭 Itinéraire</b>, <b>👁 Street View</b> et <b>📤 Envoyer</b> affichent la carte, lancent le guidage ou partagent l'adresse et l'itinéraire.</p>
        <p><b>✓ Terminer le chantier</b> prévient s'il reste une somme à encaisser et renseigne la date de fin du jour si elle était vide. <b>↺ Rouvrir le chantier</b> le remet « En cours » s'il a des factures, « Signé » sinon.</p>`),
      S('Prochaine étape', `<p>Sous l'en-tête, pour les profils qui voient les montants, le bandeau <b>Prochaine étape</b> dit quoi faire ensuite, d'après les devis, factures, règlements et le planning du chantier, avec un bouton pour y aller :</p>${ul([
        '<b>Aucun devis</b> → Créer le devis ; <b>devis en brouillon</b> → Terminer et envoyer ; <b>devis envoyé</b> → attente de la réponse, puis Relancer quand le délai est passé ; <b>devis refusé</b> → l\'adapter ou passer le chantier en « Perdu »',
        '<b>Marché signé, rien facturé</b> → Facturer l\'acompte (ouvre directement la fenêtre d\'acompte du devis)',
        '<b>Facture échue</b> → Relancer (en rouge) ; <b>facture à échoir</b> → à encaisser',
        '<b>Travaux à 100 %</b> avec un reste à facturer → Facturer le solde',
        '<b>Aucune équipe affectée</b> → Planifier ; <b>tout facturé et encaissé</b> → Terminer le chantier (bandeau vert)'])}
        <p>La première étape est la plus utile ; les suivantes sont rappelées en dessous (« Ensuite : … »). Le bandeau disparaît quand le chantier est terminé ou perdu.</p>`),
      S('Photos, fichiers et liens', `<p>Les photos et documents sont rangés dans le dossier GestPro de votre Google Drive ou de votre OneDrive (selon la configuration du script). Les profils qui voient les montants peuvent aussi classer des devis, factures et factures d'achat. « Liens » garde des adresses utiles (plans, dossier partagé) avec un libellé.</p>`),
      S('Avancement et chiffres', `<p>Trois jauges : <b>Paiement</b> (encaissé sur le marché), <b>Travaux</b> (le curseur d'avancement, saisi à la main) et <b>Délai</b> (elle rougit quand la date de fin est dépassée).</p>
        <p>Quatre chiffres : marché signé TTC (devis acceptés ou facturés), facturé TTC avec le reste à facturer, encaissé, reste à payer.</p>
        <p>Les boutons <b>+ Devis</b> et <b>+ Facture</b> créent un document déjà rattaché au chantier.</p>`),
      S('Prévu contre réalisé', `<p>Dès qu\'un devis du chantier est <b>accepté</b> (ou facturé), la carte <b>Prévu contre réalisé</b> compare ce que le devis prévoyait à ce que le chantier consomme :</p>${ul([
        '<b>Heures</b> : les lignes de <b>main d\'œuvre en heures</b> du devis (et les heures des ouvrages composés) donnent le budget d\'heures ; il est comparé aux heures saisies (« 96 h faites sur 112 prévues »)',
        '<b>Coûts</b> : le coût prévu vient du <b>prix d\'achat</b> des lignes du devis (matières, sous-traitance, main d\'œuvre) ; le réel regroupe les sorties de stock, les charges non facturées et les heures saisies × coût horaire',
        'Une ligne de main d\'œuvre en heures sans prix d\'achat est chiffrée au <b>coût horaire moyen de l\'équipe</b> ; les lignes sans prix d\'achat sont comptées et signalées (le coût prévu est alors incomplet)',
        'Des <b>alertes</b> s\'affichent avant la facture finale : heures dépassées, heures presque épuisées alors que les travaux avancent moins vite, coûts supérieurs au prévu, coûts ou heures qui avancent plus vite que l\'avancement saisi, planning qui affecte plus d\'heures que le devis. Les dérives avérées remontent aussi dans « À faire aujourd\'hui »'])}
        <p>Pour que la comparaison serve, renseignez le <b>prix d\'achat</b> des lignes du devis (il se reprend tout seul depuis le produit ou l\'ouvrage) et saisissez l\'avancement des travaux. Sans prix d\'achat sur le devis, la carte l\'indique au lieu de comparer.</p>`),
      S('Équipe, heures et matériel', `<p><b>Équipe &amp; heures</b> : membres affectés, heures réalisées et prévues, coût de main-d'œuvre. « + Affecter des membres » ouvre l'affectation, « Voir le planning » ouvre le planning.</p>
        <p><b>Matériel à prévoir</b> : les produits du stock demandés par le devis accepté, avec ce qui est déjà sorti pour le chantier, le stock actuel et la pastille <b>couvert</b>, <b>sorti</b> ou <b>manque</b> (le stock ne couvre pas tout ce que réservent les devis signés des chantiers ouverts). La main d\'œuvre, la sous-traitance, les ouvrages et les lignes libres n\'en font pas partie.</p>
        <p><b>Matériel sorti du stock</b> : les quantités sorties pour ce chantier.</p>`),
      S('Charges non facturées et rentabilité', `<p>Une charge est un coût qui ne passe ni par le stock ni par une facture client : location, sous-traitance, déplacement. Touchez <b>+ Produit / charge</b>. Pour un produit stocké, « Sortir aussi du stock » enregistre la sortie en même temps.</p>${table(['Ligne', 'Origine'], [
        ['Facturé HT', 'Factures du chantier, nettes d\'avoirs ; sinon le marché signé HT (marge « prévisionnelle »). Tant qu\'aucun coût n\'est saisi, c\'est le marché signé HT qui sert de base'],
        ['− Matières', 'Sorties de stock rattachées au chantier'],
        ['− Charges', 'Le total des charges saisies'],
        ['− Main-d\'œuvre', 'Heures saisies par les salariés × coût horaire de chaque membre'],
        ['= Marge', 'Montant et pourcentage du facturé']])}
        <p><b>Aucun coût saisi</b> : plutôt qu\'afficher une marge de 100 %, la carte estime la marge d\'après le coût prévu du devis (« Marge prévue d\'après le devis »), ou indique <b>coûts non saisis</b> si le devis n\'a pas de prix d\'achat. Dès qu\'une sortie de stock, une charge ou des heures sont saisies, la marge réelle reprend la place.</p>
        <p>Pour que la marge soit juste : rattachez chaque devis et facture au bon chantier, sortez le matériel en indiquant le chantier, saisissez les heures réalisées et le coût horaire de chaque membre.</p>`),
      S('Supprimer un chantier', `<p>La suppression est définitive et demande confirmation. Un chantier qui a déjà des devis, factures ou avoirs, des charges ou achats, du matériel sorti du stock ou des heures saisies ne peut pas être supprimé : terminez-le (« ✓ Terminer le chantier ») ou passez-le en « Perdu ». Seul un chantier vide, avec au plus un planning, se supprime ; son planning est alors supprimé.</p>`)
    ]
  },

  planning: {
    title: 'Planning', icon: '📅', ok: () => auth.can('planning'),
    intro: `Le planning répond à : qui travaille sur quel chantier, quel jour, combien d'heures. Les heures réalisées alimentent la marge des chantiers.`,
    sections: [
      S('Vue Semaine', `<p>Les membres sont en lignes, les jours en colonnes, avec, pour chacun, les heures saisies et les heures prévues de la semaine. Chaque affectation est une pastille à la couleur du chantier, avec ses heures prévues ; sous elle, la pastille verte « ⏱ 7 h » donne les heures réellement faites ce jour-là. « ‹ › » changent de semaine, « Aujourd'hui » revient à la semaine en cours. Touchez une pastille de chantier pour modifier l'affectation, la pastille ⏱ pour saisir ou corriger les heures du jour.</p>
        <p>Un compagnon voit sa semaine sous forme de liste, un jour par ligne : « à saisir » signale un jour passé ou en cours pas encore rempli.</p>`),
      S('Vue Mois', `<p>Un calendrier du mois : pour chaque jour, les chantiers en cours et les initiales des membres. Touchez un jour pour ouvrir la semaine correspondante.</p>`),
      S('Affecter un membre à un chantier', `<p>Touchez <b>+ Affecter</b>, ou une case vide du planning (membre et jour déjà choisis).</p>${ul([
        'Choisissez le chantier (seuls les chantiers non terminés et non perdus sont proposés)',
        'Cochez un ou plusieurs membres',
        'Indiquez les dates Du / Au et les heures prévues par jour ; le week-end n\'est compté que si « Inclure samedi et dimanche » est coché',
        'Au besoin, une tâche et un intervenant extérieur (architecte, maître d\'œuvre)'])}
        <p>Au-delà de 8 heures un même jour (seuil réglable dans Réglages › Seuils et délais ; plusieurs chantiers cumulés), l'enregistrement a lieu mais un avertissement s'affiche et la case porte un ⚠.</p>`),
      S('Saisir les heures réalisées, jour par jour', `<p><b>Chaque salarié saisit lui-même ses heures</b> : sur son téléphone, onglet Planning, bouton « ⏱ Saisir mes heures d'aujourd'hui » ou touche du jour concerné. La fenêtre est préremplie avec le chantier et les heures prévus : il suffit d'enregistrer, ou de corriger.</p>
        <p>Une journée peut avoir plusieurs lignes (« ＋ Ajouter une ligne ») : le chantier prévu, <b>un autre chantier</b> (au choix dans la liste), l'<b>atelier</b>, un <b>déplacement / approvisionnement</b> ou des <b>congés / absence</b>. Les heures d'un chantier comptent pour sa main-d'œuvre (heures × coût horaire du membre) ; l'atelier et le déplacement ne sont imputés à aucun chantier ; l'absence se compte à part.</p>
        <p>Les heures se tapent comme on les dit : <b>7,5</b>, <b>7h30</b>, <b>7:30</b> ou <b>7 h 30</b>, et s'affichent partout en « 7 h 30 ». Pour une absence, choisissez son type : <b>congé payé</b>, <b>maladie</b> ou <b>autre</b> ; « Journée complète » inscrit la journée type du salarié (sa base hebdomadaire ÷ 5 : 7 h pour 35 h) ou complète ce qui manque.</p>
        <p>Le salarié saisit et corrige ses jours, jusqu'à aujourd'hui (pas à l'avance). Le gestionnaire peut saisir ou corriger les heures de tous, avec la pastille ⏱ de la grille. Les saisies sont enregistrées dans l'onglet « Pointages » du classeur Google Sheets. Le total du mois de toute l'équipe se lit dans l'onglet « Heures » (voir plus bas).</p>
        <p>L'ancien champ « Heures réalisées (total) » de l'affectation reste disponible : il compte seulement tant qu'aucune heure n'a été saisie par jour pour ce membre sur ce chantier pendant les dates de l'affectation (jamais de doublon).</p>`),
      S('Poser des congés ou une absence', `<p>Touchez <b>+ Absence</b> (Semaine ou Mois, réservé aux gestionnaires) pour poser des <b>congés payés, une maladie ou une autre absence</b> sur plusieurs jours d'un coup.</p>${ul([
        'Cochez un ou plusieurs membres, choisissez le <b>type</b>, les dates <b>Du / Au (inclus)</b> ; samedi et dimanche ne sont comptés que si la case est cochée',
        '<b>Durée par jour</b> : journée entière (selon l\'horaire de chaque personne : 7 h pour 35 h, 5 h 30 pour 28 h), demi-journée ou durée précise (3 h 30)',
        'Chaque jour devient une ligne « congés / absence » des heures : elle compte dans le compteur hebdomadaire (elle comble la base de la semaine), dans le récapitulatif et le document du comptable'])}
        <p>Dans la semaine, une pastille grise rayée (« Congé payé 7h ») s\'affiche sur chaque jour ; dans le mois, « Abs. » avec les initiales. <b>Touchez la pastille</b> pour modifier la période, le type ou la durée de toute la série, ou la supprimer. Si vous affectez à un chantier une personne en absence, l\'enregistrement a lieu mais un avertissement le signale (⚠ sur la case).</p>
        <p>Les jours où des heures sont déjà saisies, ceux déjà en absence et ceux d\'un mois clôturé ne sont pas modifiés : l\'application les liste après l\'enregistrement. Un jour d\'absence peut recevoir des heures travaillées par la pastille « ⏱ + » (demi-journée).</p>`),
      S('Récapitulatif mensuel des heures (onglet « Heures »)', `<p>Réservé aux gestionnaires et administrateurs. Le bouton <b>📊 Heures du mois</b> (ou l'onglet « Heures ») ouvre le récapitulatif de <b>toute l'équipe</b> pour un mois ; « ‹ › » changent de mois.</p>${ul([
        '<b>Quatre cartes</b> en haut : heures travaillées, congés / absences (avec le détail congé payé, maladie, autre), heures au-delà de la base, jours à compléter',
        '<b>Synthèse par salarié</b> : heures sur chantiers, à l\'atelier, en déplacement / approvisionnement, total travaillé, heures au-delà de la base, congés / absences, et nombre de jours à compléter',
        '<b>Compteur hebdomadaire</b> : une colonne par semaine du mois, avec les heures travaillées et l\'écart avec la base (voir « Compteur de 35 heures et absences »)',
        '<b>Feuille de pointage</b> : un salarié par ligne, un jour par colonne. Les pastilles de couleur disent où les heures ont été faites (couleur du chantier, gris = atelier, violet = déplacement, orange = absence) ; passez sur un jour pour lire le détail. « ? » : jour prévu au planning sans heures saisies',
        '<b>Où les heures ont été faites</b> : par chantier, puis atelier, déplacements et absences, avec le détail par salarié'])}
        <p><b>Corriger des heures</b> : touchez un jour de la feuille (ou une ligne dans le détail d'un salarié, en touchant son nom) : la même fenêtre que pour le salarié s'ouvre, vous changez les heures, le chantier, l'activité, ou vous supprimez une ligne. Le récapitulatif se met à jour aussitôt.</p>
        <p><b>Imprimer pour le comptable</b> : le bouton « 🖨 Imprimer pour le comptable » prépare une feuille A4 : synthèse du mois et total de l'équipe, répartition par chantier et activité, puis une page par salarié, jour par jour, avec les totaux de chaque semaine et du mois, et un cadre de visa. Vous pouvez n'imprimer qu'un salarié, ou retirer le détail ou la répartition. Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF » pour envoyer le document par e-mail. La fenêtre propose d'écrire les heures en « 7 h 30 » (par défaut) ou en décimal (7,5), et de joindre ou non le compteur hebdomadaire.</p>`),
      S('Compteur de 35 heures et absences', `<p>Chaque salarié a une <b>base hebdomadaire</b> : 35 h par défaut, ou l'horaire de son contrat (fiche du membre › « Heures par semaine »). Une semaine va du lundi au dimanche et est comptée dans le mois où elle <b>se termine</b> : la semaine à cheval sur deux mois est dans le second (colonne « → mois suivant » pour le premier).</p>${ul([
        '<b>Au-delà</b> (« +5 h ») : heures travaillées au-dessus de la base sur la semaine. Les congés et absences ne sont pas des heures travaillées : ils ne se cumulent pas avec elles',
        '<b>Il manque</b> : sur une semaine terminée où le salarié a au moins une saisie, base − heures travaillées − absences. Une semaine sans aucune saisie n\'affiche rien (le jour à compléter est signalé à part)',
        '<b>Types d\'absence</b> : congé payé, maladie, autre ; le total de chacun est dans la carte « congés / absences » et dans le document du comptable (et l\'export CSV)'])}
        <p>Seules les heures saisies jour par jour entrent dans le compteur : l'ancien total saisi sur une affectation n'y est pas compté.</p>`),
      S('Clôturer le mois', `<p>Quand le récapitulatif est parti chez le comptable, le bouton <b>🔒 Clôturer le mois</b> (en haut de l'onglet « Heures », réservé aux gestionnaires et administrateurs) verrouille ce mois : personne ne peut plus saisir, corriger ou supprimer d'heures dessus, y compris dans le planning. On peut aussi cocher « Clôturer le mois après l'impression » dans la fenêtre d'impression.</p>
        <p><b>Rouvrir le mois</b> remet la saisie possible ; la clôture et la réouverture sont notées dans l'historique (date et nom). Si des heures arrivent d'un autre appareil après la clôture, un bandeau orange compare le total à celui du jour de la clôture : rouvrez le mois pour vérifier, puis clôturez-le de nouveau.</p>`),
      S('Ce que voit chaque profil', `<p>Un gestionnaire ou un administrateur voit tout le planning. Un compagnon ou un intervenant voit seulement « Mon planning » et les chantiers où il est affecté, sans les montants.</p>`)
    ]
  },

  team: {
    title: 'Équipe', icon: '👷', ok: () => auth.can('planning'),
    intro: `L'onglet Équipe liste les membres. Une fiche peut aussi servir pour vous-même, un apprenti ou un sous-traitant.`,
    sections: [
      S('La fiche d\'un membre', `<p>Touchez <b>+ Membre</b> ou un membre existant.</p>${ul([
        '<b>Prénom affiché</b> : sert au « Bonjour … » de l\'accueil',
        '<b>Fonction, type de contrat</b> : gérant, chef de chantier, ouvrier, apprenti, sous-traitant…',
        '<b>Coût horaire HT</b> : coût réel pour l\'entreprise, utilisé pour la marge des chantiers',
        '<b>Coût facturé HT</b> : prix de vente de l\'heure au client',
        '<b>Heures par semaine (contrat)</b> : base du compteur d\'heures (35 h si vide ; 28 h pour un temps partiel, par exemple)',
        '<b>Statut</b> : un membre inactif n\'apparaît plus dans le planning mais reste dans les historiques',
        '<b>Profil d\'accès et code PIN</b> : facultatif (voir « Bien démarrer »)'])}`),
      S('Habilitations', `<p>Libellé et date d'expiration (SST, travail en hauteur, CACES…). Une pastille passe en orange 60 jours avant l'expiration et en rouge une fois la date dépassée ; les habilitations à renouveler sont aussi rappelées sur l'accueil.</p>`)
    ]
  },

  stock: {
    title: 'Stock : produits', icon: '📦', ok: () => auth.can('stock'),
    intro: `Le stock suit chaque produit, dans chaque emplacement, de l'entrée à la sortie. Il sert à savoir ce qu'il reste, à calculer la matière consommée par chantier et à alimenter le catalogue des devis.`,
    sections: [
      S('La liste', `<p>Chaque produit montre sa vignette, sa référence, son code-barres, sa catégorie, la quantité par emplacement et son prix de vente HT. La pastille de quantité est <b>verte</b> (stock suffisant), <b>orange</b> (au seuil d'alerte ou en dessous), <b>rouge</b> (épuisé ou négatif).</p>
        <p><b>Rechercher</b> par nom, référence, code-barres ou catégorie. <b>⚙ Filtres &amp; tri</b> : tri, catégorie, emplacement, type (vendus ou usage interne), « Stock bas / épuisé » et <b>« Matériel manquant (devis signés) »</b>.</p>
        <p>Les devis <b>acceptés</b> des chantiers ouverts <b>réservent</b> leur matériel : sous la quantité, la ligne indique « réservé par les devis signés : X (chantiers) · disponible Y », et une pastille <b>manque N</b> apparaît quand le stock ne suffit pas. La réservation disparaît au fur et à mesure des sorties pour le chantier, et quand le devis est facturé ou le chantier terminé. La <b>main d\'œuvre</b> et la <b>sous-traitance</b> restent au catalogue pour les devis, mais n\'ont ni stock ni seuil : la ligne porte l\'étiquette « service ».</p>
        <p><b>▦ Scanner</b> lit un code-barres avec la caméra et ouvre le produit ; si le code est inconnu, l'application propose de créer le produit. Vous pouvez aussi saisir le code à la main ou utiliser une douchette.</p>`),
      S('Créer ou modifier un produit', `<p>Touchez <b>+ Produit</b>.</p>${ul([
        '<b>Catégorie</b> : Produit (fourniture), Matériel, Main d\'œuvre, Sous-traitance ou Ouvrage. Elle sert au menu « Produit » des devis et factures (pour classer d\'un coup tous les produits existants, voir « Classer les produits existants »)',
        '<b>Type d\'article</b> : « Vendu aux clients », ou « Usage interne » (encre, papier, consommables) : un article interne n\'est jamais proposé dans les devis',
        '<b>Prix d\'achat HT</b> : sert aux achats, à la TVA déductible et à la marge. Il suit vos achats : à chaque réception, il devient le <b>prix moyen pondéré</b> du stock en place et de la quantité reçue (10 en stock à 10 € + 10 reçus à 12 € → 11 €). <b>Prix de vente HT</b> : repris dans les devis',
        '<b>TVA de vente</b> : reprise sur la ligne du devis quand elle diffère du taux du document (la colonne TVA de l\'éditeur doit être affichée). <b>TVA d\'achat</b> (20 % par défaut) : celle que vous déduisez sur vos achats ; elle sert aux réceptions de stock et aux calculs « Achats &amp; TVA » quand la facture fournisseur n\'indique pas son propre taux',
        '<b>Seuil d\'alerte stock</b> : en dessous, le produit apparaît dans « À réapprovisionner » sur l\'accueil',
        '<b>Quantité initiale et emplacement</b> : à la création seulement ; enregistre un premier mouvement « Stock initial »',
        'Un code-barres ne peut servir qu\'à un seul produit. « ＋ Créer un code interne » en fabrique un pour un produit qui n\'en a pas (voir « Étiquettes code-barres »)'])}
        <p>Un produit existant propose <b>+ Entrée</b>, <b>− Sortie</b>, <b>⇄ Transfert</b> et <b>Inventaire</b>.</p>`),
      S('Étiquettes code-barres', `<p>Le bouton <b>🖨 Étiquettes</b> (liste des produits) imprime des étiquettes autocollantes sur une <b>planche A4</b> : choisissez la planche (21 étiquettes 63,5 × 38,1 mm type Avery L7160 par défaut, ou d'autres formats courants, ou « Personnalisée » avec vos dimensions), le nombre d'étiquettes de chaque produit, puis imprimez. Depuis une fiche produit, « 🖨 Étiquette » ouvre la même fenêtre avec ce produit ; après une réception de colis, la case « Préparer des étiquettes » y mène aussi.</p>${ul([
        '<b>Codes</b> : un code EAN-13, EAN-8 ou UPC valide est dessiné tel quel ; tout autre texte (référence, code maison) est dessiné en Code 128, lisible par tous les lecteurs',
        '<b>Code interne</b> : un produit sans code-barres reçoit un EAN-13 qui commence par 20 (plage réservée aux magasins, jamais utilisée par un fabricant), enregistré sur sa fiche : le scan le retrouve ensuite',
        '<b>Planche entamée</b> : « Commencer à l\'étiquette n° » saute les emplacements déjà utilisés',
        '<b>Essai</b> : cochez « Tracer le contour » et imprimez sur du papier ordinaire pour comparer avec la planche ; en cas de décalage, choisissez « Personnalisée » et ajustez les marges. L\'aperçu et l\'alerte « code trop long » préviennent d\'un code trop serré pour être lu',
        'Les étiquettes sont dessinées sur l\'appareil : rien n\'est envoyé nulle part'])}`),
      S('Classer les produits existants', `<p>Le bouton <b>🏷 Classer (N)</b> (N = produits qui ne sont pas encore dans l'une des 5 catégories) ouvre un outil pour ranger tous vos produits d'un coup, sans ouvrir chaque fiche.</p>${ul([
        '<b>Afficher</b> : « À classer » (par défaut), « Tous », « Sans catégorie », l\'une des 5 catégories, ou une <b>ancienne catégorie</b> reprise d\'un import. Le compteur de chaque choix se met à jour tout seul',
        '<b>Rechercher</b> par nom, référence ou ancienne catégorie (les accents et les majuscules ne comptent pas) : par exemple « vis », puis <b>Tout cocher</b>',
        'Choisissez la catégorie dans <b>Classer dans…</b>, puis touchez <b>Classer</b> : les produits cochés sont rangés et restent affichés en vert',
        'Pour un seul produit, changez directement la catégorie dans la liste à droite de son nom',
        'Tout est <b>enregistré tout de suite</b> (et synchronisé). <b>↩ Annuler</b> remet comme avant la dernière opération',
        'La liste montre les 300 premiers résultats ; « Tout cocher » prend bien tous les résultats, même ceux qui ne sont pas affichés'])}
        <p>La sélection est vidée dès que vous changez la recherche ou le filtre : vous ne classez jamais un produit que vous ne voyez pas.</p>`),
      S('Ouvrages (composition)', `<p>Un <b>ouvrage</b> est un produit de catégorie « Ouvrage » que vous composez : un caisson de cuisine avec tiroir, par exemple. Choisissez la catégorie <b>Ouvrage</b> dans la fiche : le panneau <b>Composition</b> apparaît (le stock, le seuil et le fournisseur disparaissent : un ouvrage n'est pas stocké).</p>${ul([
        '<b>＋ Produit</b> : cherchez dans le catalogue (0,59 m³ de chêne, 2 poignées, 2 charnières, 2 glissières…). Le prix d\'achat du catalogue est utilisé',
        '<b>＋ Main d\'œuvre</b> : un libellé, un <b>membre de l\'équipe</b> et un nombre d\'heures (10 h d\'atelier). Le coût est le <b>coût horaire</b> de la fiche du membre ; sans membre, vous saisissez un taux',
        '<b>＋ Autre coût</b> : sous-traitance, fourniture libre, forfait…',
        'Les quantités sont données <b>pour une unité</b> de l\'ouvrage',
        '<b>Prix de vente</b> : soit <b>prix de revient × coefficient</b> (1,30 par défaut, réglable dans Réglages › Ventes et pour chaque ouvrage), soit un <b>prix fixé à la main</b>. La fiche affiche le prix de revient, la marge en euros et en pourcentage du prix de vente'])}
        <p>Les prix sont <b>recalculés</b> d'après le catalogue et les coûts horaires : si le chêne augmente, le prix de l'ouvrage suit dans la liste et dans les nouveaux devis. Les devis déjà faits gardent leurs prix. Un composant sans prix d'achat (ou un membre sans coût horaire) est signalé par ⚠ : le prix de revient est alors incomplet. Un ouvrage sans composition reste un simple produit à prix fixe.</p>`),
      S('Importer des produits ou une facture fournisseur', `<p><b>Importer</b> lit un fichier .csv ou .xlsx, vous laisse faire correspondre les colonnes et fusionne les désignations identiques en gardant le dernier prix.</p>
        <p><b>📄 Document fournisseur (PDF)</b> lit les lignes d'une facture, d'un bon de livraison, d'un bon de commande ou d'un devis au format PDF, sur l'appareil, sans l'envoyer sur Internet. L'application reconnaît le <b>type de document</b> d'après son titre (vous pouvez le changer). Pour chaque ligne, choisissez la destination (un chantier, la ligne compte alors comme charge, ou un emplacement de stock).</p>
        <p><b>✋ Lire à la main</b> : si les lignes ne sont pas reconnues (ou si la lecture est fausse), le PDF s'affiche et vous entourez vous-même les zones : le <b>tableau des lignes</b>, le <b>fournisseur</b> (nom et adresse), le <b>n° du document</b>, la <b>date</b>. Glissez un rectangle ou touchez un mot, puis vérifiez l'affectation des colonnes (désignation, référence, quantité, prix, montant) et les lignes lues. Cochez « Retenir cette mise en page » : elle est enregistrée <b>par fournisseur et par type de document</b> (la facture, le bon de livraison et le bon de commande d'un même fournisseur ont chacun la leur) et les prochains documents de ce type seront lus automatiquement. Seules les <b>positions</b> des zones sont gardées, jamais le contenu des factures.</p>
        <p><b>Bon de livraison</b> : les lignes sans prix prennent le <b>dernier prix connu</b> du catalogue (pastille « prix du catalogue ») ; pour un article inconnu (pastille « prix à saisir »), tapez le prix à la main ou laissez 0. L'option « Enregistrer l'entrée en stock » est cochée d'office. Comme une réception de colis, l'entrée est comptée dans vos achats : quand la facture arrive, importez-la en mettant le catalogue à jour <b>sans refaire l'entrée en stock</b>.</p>
        <p>Un <b>devis</b>, un <b>bon de commande</b> ou un <b>avoir</b> n'est pas un achat réalisé : l'application vous prévient et ne propose aucun chantier par défaut.</p>
        <p><b>Facture électronique</b> : le bouton accepte aussi le fichier <b>XML</b> d'une facture électronique (Factur-X, UBL) et un PDF Factur-X, dont les données sont lues directement : lignes, unités, taux de TVA et totaux sont exacts, sans lecture « à la main ». Les frais de port ou de livraison sont signalés à part, et le total des lignes est comparé à celui de la facture.</p>
        <p><b>Déjà importé ?</b> L'application retient, sur cet appareil et dans votre classeur, le fournisseur, le type, le numéro, la date et le total des documents importés (jamais leur contenu). Si vous importez à nouveau le même document, elle le signale et demande confirmation avant d'ajouter les lignes une seconde fois.</p>
        <p class="warnnote">Vérifiez toujours le tableau de lecture avant de valider : la lecture d'un PDF peut se tromper sur une quantité ou un prix.</p>`)
    ]
  },

  orders: {
    title: 'Stock : commandes', icon: '🛒', ok: () => auth.can('stock'),
    intro: `L'onglet Commandes prépare vos achats chez les fournisseurs, de la liste « à commander » à la réception en stock.`,
    sections: [
      S('À commander', `<p>La carte du haut propose, par fournisseur, les produits <b>sous leur seuil d'alerte</b> (« stock 4 ≤ seuil 10 ») ou <b>manquants pour les devis signés</b> (« manque 5 pour les devis signés »), moins ce qui est déjà commandé. La quantité proposée couvre le matériel réservé et remonte au seuil d'alerte ; elle se modifie dans la commande. Les services (main d'œuvre, sous-traitance) et les ouvrages ne sont jamais proposés ; un produit sans fournisseur est regroupé à part (choisissez le fournisseur dans la fiche produit pour qu'il soit rangé avec lui).</p>
        <p><b>Créer la commande</b> ouvre un brouillon prérempli (prix d'achat de la fiche) : rien n'est enregistré avant « Enregistrer ». <b>+ Nouvelle commande</b> en crée une à la main : fournisseur, date, livraison souhaitée, chantier à livrer (facultatif), produits (liste ou scan), note pour le fournisseur.</p>`),
      S('Envoyer la commande', `<p>Dans la commande : <b>🖨 Imprimer / PDF</b> prépare un bon de commande A4 (numéro BC-aaaa-001, fournisseur, lignes, total HT, livraison souhaitée) ; <b>✉ E-mail</b> ouvre <b>votre</b> messagerie avec le texte de la commande (rien n'est envoyé par GestPro et rien ne passe par un autre service). Touchez ensuite <b>✔ Marquer comme envoyée</b> : la commande est alors « attendue » et n'est plus proposée dans « À commander ». Une commande dont la livraison souhaitée est dépassée porte la pastille « en retard ».</p>`),
      S('Réceptionner', `<p>Sur une commande envoyée, <b>📦 Réceptionner</b> ouvre la réception de colis préremplie avec ce qui reste à recevoir (quantités et prix de la commande) : corrigez ce qui est réellement arrivé, rangez en stock, validez. Le stock, le prix d'achat moyen et les achats sont mis à jour comme pour une réception ordinaire, et la commande passe à <b>« Reçue en partie »</b> ou <b>« Reçue »</b>. La liste des réceptions (date, bon de livraison, quantités) reste dans la commande. <b>Solder la commande</b> clôt une commande partielle dont le reste ne viendra pas.</p>`),
      S('États et suppression', table(['État', 'Signification'], [
        ['Brouillon', 'En préparation : modifiable, supprimable'],
        ['Envoyée', 'Attendue chez le fournisseur : lignes encore modifiables (confirmation par téléphone, par exemple)'],
        ['Reçue en partie', 'Une partie est arrivée : lignes en lecture seule (commandé / reçu)'],
        ['Reçue', 'Tout est arrivé (ou commande soldée)'],
        ['Annulée', 'Plus attendue ; supprimable']])
        + `<p>Les commandes sont synchronisées avec les autres données (onglet « Commandes_fournisseurs » de votre classeur Google Sheets).</p>`)
    ]
  },

  locations: {
    title: 'Stock : emplacements', icon: '🗄', ok: () => auth.can('stock'),
    intro: `Un emplacement a deux niveaux : une zone (Atelier, Dépôt, Camion) et un lieu précis (Rack A, étagère 3).`,
    sections: [
      S('À savoir', ul([
        'L\'onglet liste les emplacements par zone, avec les produits qu\'ils contiennent',
        'Un emplacement qui contient du stock ne peut pas être supprimé : transférez d\'abord son contenu',
        'L\'emplacement choisi lors d\'une entrée, d\'une sortie ou d\'un transfert détermine où se trouve la quantité'])),
    ]
  },

  moves: {
    title: 'Stock : mouvements', icon: '↔', ok: () => auth.can('stock'),
    intro: `Chaque changement de stock est un mouvement. Les 150 derniers sont affichés.`,
    sections: [
      S('Les types de mouvement', table(['Type', 'Effet'], [
        ['Entrée (réception)', 'Ajoute du stock. C\'est un achat : le prix d\'achat compte dans les achats et la TVA déductible'],
        ['Sortie', 'Retire du stock ; indiquez le chantier concerné pour alimenter sa rentabilité'],
        ['Transfert', 'Déplace du stock d\'un emplacement à un autre, sans effet sur les achats'],
        ['Inventaire', 'Fixe la quantité réelle comptée dans un emplacement']])
        + `<p>L'application refuse une sortie ou un transfert supérieur au stock disponible.</p>`),
      S('Les deux assistants', `<p><b>📦 Réception colis</b> : indiquez le fournisseur ou le bon de livraison et l'emplacement de rangement, ajoutez les produits (scan ou « + Ligne ») avec leur quantité, puis « Valider la réception » crée toutes les entrées d'un coup.</p>
        <p><b>🏗 Sortie chantier</b> : choisissez le chantier, ajoutez produits et quantités ; l'application prélève sur les emplacements les mieux fournis. « Reprendre les besoins du devis » remplit les lignes avec les produits des devis acceptés ou facturés du chantier, moins ce qui est déjà sorti.</p>
        <p>À chaque réception (colis, mouvement d\'entrée ou facture fournisseur importée), le <b>prix d\'achat de la fiche passe au prix moyen</b> ; l\'écart avec le prix précédent s\'affiche avant de valider et une <b>hausse de 5 % ou plus</b> (seuil réglable dans Réglages › Seuils et délais) est signalée (« ⚠ hausse de +8 % »), y compris dans le message qui suit la validation.</p>
        <p>Depuis une facture de vente <b>finale</b>, « Déduire du stock » sort d'un coup les produits de la facture, rattachés au chantier ; si du matériel est déjà sorti pour ce chantier, l\'application propose de ne déduire que le reste. Une <b>facture d\'acompte</b> ne livre rien : le bouton n\'y figure pas. La main d\'œuvre et la sous-traitance ne créent jamais de mouvement.</p>`)
    ]
  },

  docs: {
    title: 'Ventes : listes', icon: '🧾', ok: canDocs,
    intro: `Trois listes : Devis, Factures et Avoirs. Un devis accepté se transforme en facture, un acompte se facture en cours de route, un avoir corrige une facture.`,
    sections: [
      S('Rechercher et filtrer', `<p>Chaque ligne montre le numéro, le client, la date, le chantier, le montant TTC et le statut. Recherchez par numéro, client ou chantier, puis <b>⚙ Filtres &amp; tri</b> :</p>${ul([
        '<b>Statuts</b> : plusieurs possibles. Pour les factures : à encaisser, réglées, réglées partiellement, en retard, en litige, annulées, brouillons',
        '<b>Client</b>, dates <b>Du / Au</b>, et tri (date, numéro, client, montant)'])}`),
      S('Devis facturés masqués', `<p>Par défaut, les devis déjà facturés sont masqués pour alléger la liste. Une ligne rappelle combien sont cachés, avec un lien « Voir tout ». La recherche ou le filtre « Facturé » les réaffiche. Aucun devis n'est supprimé.</p>`),
      S('Créer un document', `<p>Touchez <b>+ Devis</b>, <b>+ Facture</b> ou <b>+ Avoir</b> selon l'onglet. Depuis la fiche d'un chantier, « + Devis » et « + Facture » reprennent déjà le client, le chantier et l'adresse. Un avoir se crée depuis la facture à corriger.</p>`)
    ]
  },

  doc: {
    title: 'Éditeur de devis / facture / avoir', icon: '✍', ok: canDocs,
    intro: `Le devis, la facture et l'avoir se saisissent dans le même éditeur, avec les mêmes lignes.`,
    sections: [
      S('Remplir un devis', `<p><b>En-tête</b> (replié en une ligne de résumé) : client, chantier (le « + » en crée un), date, validité, adresse du chantier, intitulé, remarque, statut et TVA par défaut. Le numéro se donne tout seul à l'enregistrement. La date de validité est remplie à la création (date + délai de validité des Réglages, 30 jours) ; un devis envoyé dont la validité est dépassée porte la pastille « Expiré » dans la liste et est compté dans l'accueil.</p>
        <p><b>Lignes</b> :</p>${ul([
        '<b>📦 Produit ▾</b> : choisissez d\'abord une catégorie (Produit (fourniture), Matériel, Main d\'œuvre, Sous-traitance, Ouvrage). Une ligne s\'ouvre : tapez les premières lettres de la désignation, la liste ne montre que les produits de cette catégorie. Entrée ou un toucher reprend le prix, l\'unité et la référence de la fiche. « Tout le catalogue » élargit la recherche ; « Tout le catalogue / scanner… » ouvre le sélecteur complet avec le scan',
        '<b>✏️ Ligne libre</b> : une prestation saisie à la main',
        '<b>📑 Section</b> : regroupe des lignes avec un titre et un sous-total (<b>⏹ Fin de section</b> la termine) ; <b>📝 Texte</b> : un paragraphe ; <b>⏭ Saut de page</b>',
        '<b>📄 PDF</b> : reprend des lignes d\'un document fournisseur ; <b>📋 Modèles</b> : insère un modèle de texte',
        '<b>Aa</b> (dans l\'en-tête d\'une ligne produit ou d\'un bloc texte) : déplie ou replie, sur une seule ligne, la barre de mise en forme (gras, italique, souligné, couleur, surlignage, taille, alignement, listes…). Sur une <b>ligne produit</b>, elle met en forme la désignation, imprimée telle quelle sur le document ; <b>↵</b> ajoute un saut de ligne'])}
        <p>La catégorie d'une ligne se choisit aussi dans la fiche produit (champ <b>Catégorie</b>) : classez vos produits pour les retrouver par catégorie.</p>
        <p><b>Saisie rapide</b> : Entrée passe au champ suivant ; Ctrl + Entrée insère une ligne ; ↑ ↓ parcourent les propositions. Dans la désignation, <b>Maj + Entrée</b> va à la ligne (dans une liste à puces, Entrée crée l'élément suivant). Sur une <b>ligne libre</b>, les produits du catalogue sont aussi proposés pendant la frappe : ↓ puis Entrée (ou un toucher) en choisit un, sinon Entrée passe simplement à la quantité.</p>
        <p>Le collage dans une désignation se fait en texte brut (sans la mise en page de Word ou d'un site). Choisir un autre produit dans la liste remplace la désignation et sa mise en forme.</p>
        <p>Une barre fixe en bas affiche le total HT, le total TTC, <b>Enregistrer</b> et la pastille « points à vérifier ». Avant d'enregistrer, l'application contrôle le document : une anomalie bloquante empêche l'enregistrement, un avertissement se confirme une fois.</p>`),
      S('Le bouton ⚙ Options', `<p>En haut de l'éditeur, il choisit ce qui se saisit et s'affiche sur les lignes.</p>${table(['Option', 'Effet'], [
        ['TVA par ligne', 'Un taux propre à chaque ligne ; décoché, tout suit la TVA du document'],
        ['Remises', 'Remise en % par ligne ; remise sur le total en % ou en €'],
        ['Référence du produit', 'Colonne « Réf. » imprimée dès qu\'une référence existe'],
        ['Lignes en option', 'Imprimée mais non comptée dans le total ni reprise dans la facture'],
        ['Sous-total des sections', 'Réglage par défaut des nouvelles sections'],
        ['Prix d\'achat et marge', 'Marge par ligne et au total ; information interne, jamais imprimée'],
        ['Stock disponible', 'Alerte si la quantité dépasse le stock ; jamais imprimé'],
        ['Photo du produit', 'Vignette dans l\'éditeur, jamais imprimée'],
        ['Aperçu à côté', 'Sur grand écran, l\'aperçu s\'affiche à droite de l\'éditeur']])}
        <p>Décocher une option dont les champs sont remplis demande confirmation avant de les remettre à zéro.</p>`),
      S('Aperçu, mise en page, impression', `<p><b>✎ Éditeur</b> et <b>👁 Aperçu</b> basculent entre saisie et document imprimé (sur grand écran l'aperçu peut rester à côté, avec un mode « ⤢ Plein écran »). <b>🎨 Mise en page</b> règle zones, textes et couleurs. <b>Imprimer / PDF</b> ouvre l'impression ou l'enregistrement en PDF.</p>`),
      S('Statuts d\'un devis', table(['Statut', 'Signification'], [
        ['Brouillon', 'En préparation'],
        ['Envoyé', 'Remis au client ; automatique à l\'envoi par e-mail. Compté dans « Devis en attente » pendant 90 jours (réglable dans Réglages › Seuils et délais)'],
        ['Accepté', 'Le client a dit oui (« Marquer accepté ») : le chantier lié passe de Nouveau à Signé. Sans chantier, l\'application propose de le créer (client, adresse et devis déjà remplis). Le matériel du devis est alors réservé dans le stock ; un message signale ce qui manque'],
        ['Refusé', 'Le client a dit non'],
        ['Facturé', 'Le devis a été transformé en facture']])),
      S('Du devis à la facture', `${ul([
        '<b>Transformer en facture</b> : crée la facture (numérotée), reprend lignes et TVA (sauf lignes en option), rattache les règlements déjà saisis et passe le devis en « Facturé ». Modifier ensuite le devis ne change pas la facture ; pour repartir de ses lignes, utilisez « ⧉ Dupliquer ».',
        '<b>Facture d\'acompte</b> : facture une partie du devis, en %, en montant TTC ou HT, avec un aperçu en direct. Le total des acomptes ne peut pas dépasser le devis.',
        '<b>Marquer accepté</b> : change le statut sans rien facturer.'])}
        <p>Le bloc <b>Règlements &amp; acomptes</b> d'un devis enregistre ce que le client a déjà versé ou un acompte de 30 % ou 40 %. Quand la facture finale est créée, les acomptes valables sont déduits taux par taux ; si un acompte change ensuite, l'éditeur propose « Mettre à jour les acomptes ». Une fois le devis facturé, ce bloc renvoie vers la facture : les règlements s'enregistrent désormais sur la facture.</p>`),
      S('Factures et règlements', `<p>Une facture a en plus une date limite de règlement et des conditions de règlement.</p>${table(['Statut', 'Signification'], [
        ['Brouillon', 'Non émise'],
        ['À payer / Envoyée', 'Émise, en attente ; « Envoyée » après un envoi par e-mail'],
        ['Réglée partiellement / Réglée', 'Calculé à partir des règlements saisis'],
        ['En retard / impayée', 'Automatique : date limite dépassée et facture non soldée'],
        ['En litige / suspendue', 'À choisir à la main'],
        ['Annulée', 'Sans effet ; une facture d\'acompte annulée par un avoir total n\'est plus déduite']])}
        <p>Pour encaisser, utilisez <b>Règlements &amp; acomptes</b> : un bouton par mode (espèces, chèque, carte bleue), « Autre… » pour un virement ou un montant libre, « Solde » pour le reste dû. Pour un chèque, notez le numéro et la banque. <b>Déduire du stock</b> sort les produits de la facture ; « Stock déjà déduit » évite le doublon.</p>`),
      S('Annuler une facture émise', `<p>Une facture émise (numérotée) ne se supprime plus : la numérotation doit rester continue. Pour l'annuler, touchez <b>Annuler par un avoir</b> sur la facture : un avoir total est créé et numéroté aussitôt, il solde ce qui reste à payer, et le devis d'origine repasse en « Accepté » pour pouvoir être refacturé. Les sommes déjà encaissées restent à rembourser au client (« Rembourser le client » sur l'avoir) ou à déduire de la prochaine facture. Seul un brouillon (sans numéro, ou resté au statut « Brouillon ») se supprime ; une facture passée en « Annulée » à la main reste conservée. Un avoir se supprime seulement s'il est le dernier de sa série, sans remboursement ni envoi par e-mail : son numéro est alors réutilisé.</p>`),
      S('Les avoirs', `<p>Un avoir corrige une facture émise. Sur la facture, touchez <b>Créer un avoir</b> et choisissez :</p>${ul([
        '<b>Avoir total</b> : toutes les lignes reprises (proposé tant que la facture n\'a pas déjà un avoir)',
        '<b>Avoir sur certaines lignes</b> : cochez les lignes et indiquez la quantité à créditer (au plus ce qui n\'a pas déjà été crédité) ; chaque ligne garde son prix, sa TVA et sa remise',
        '<b>Avoir d\'un montant libre</b> : remise ou geste commercial, en TTC ou en HT, réparti entre les taux de TVA de la facture au prorata de leur poids'])}
        <p>Un avoir partiel a une <b>nature</b> : <b>remise accordée</b> (le marché du chantier baisse du montant de l'avoir) ou <b>correction</b> (le travail reste dû, il sera refacturé : le marché ne bouge pas). Le récapitulatif en bas de la fenêtre donne le montant et ce qu'il reste à créditer ; « Déduire aussitôt de cette facture » diminue le reste à payer. L'avoir est créé et numéroté tout de suite, au statut « Émis ». Sur sa fiche :</p>${ul([
        '<b>Déduire d\'une facture</b> : diminue le reste à payer d\'une facture du même client',
        '<b>Rembourser le client</b> : enregistrez montant, date et mode de remboursement'])}
        <p>La facture affiche « crédité X TTC, net Y ». Sur une <b>facture d\'acompte</b>, la facture finale ne déduit plus que l'acompte net des avoirs, taux de TVA par taux.</p>`),
      S('Envoyer et exporter', ul([
        '<b>✉ Envoyer par e-mail</b> (document numéroté) : joint le PDF ou le Factur-X, depuis votre compte Google. Limite de 40 envois par jour. Texte par défaut dans Réglages › E-mails',
        '<b>🧾 Facture électronique</b> : vérifie les mentions obligatoires (SIREN du client, nature de l\'opération, TVA sur les débits, adresse de livraison) puis exporte un Factur-X ou le XML seul. Le dépôt sur la plateforme agréée n\'est pas automatique',
        '<b>⧉ Dupliquer</b> : nouveau brouillon sans numéro, sans règlements et sans lien avec l\'original',
        '<b>Supprimer</b> : efface un devis ou un brouillon et ses règlements ; une facture émise s\'annule par un avoir (voir « Annuler une facture émise »)'])),
      S('TVA à taux réduit (5,5 % et 10 %)', `<p>Quand un document contient des travaux à taux réduit, l'éditeur affiche un encadré : l'attestation papier n'existe plus, le client certifie les conditions par une mention imprimée sur le devis (« Bon pour accord ») et la facture. Son texte se modifie dans « Mise en page – zones ». Conservez devis, factures et photos des travaux 5 ans, et faites valider le texte par votre cabinet comptable.</p>`),
      S('Relancer un devis ou une facture', `<p>Sur un devis envoyé ou une facture impayée, le bouton <b>Relancer</b> ouvre un e-mail de relance prêt à envoyer (texte réglable dans Réglages › Relances). L'historique des relances faites s'affiche sous le bouton ; <b>Relance faite autrement</b> y ajoute un appel téléphonique ou un courrier.</p>`),
      S('Ajouter un ouvrage au devis', `<p>Dans <b>📦 Produit ▾</b>, choisissez la catégorie <b>Ouvrage</b> (ou « Tout le catalogue ») et touchez un ouvrage composé : une fenêtre demande la <b>quantité</b> (3 caissons) et la <b>présentation</b> :</p>${ul([
        '<b>Une seule ligne</b> : le client voit l\'ouvrage et son prix ; la composition reste interne. Le prix de revient est repris comme prix d\'achat de la ligne, donc la marge du devis est exacte',
        '<b>Détaillée</b> : une section avec une ligne par composant (matière, main-d\'œuvre en heures, quincaillerie…). Le prix de vente est réparti au prorata du coût de chaque composant et le <b>total reste exactement celui de l\'ouvrage</b>'])}
        <p>Sur une ligne d\'ouvrage, le bouton <b>⤵ Détailler</b> la remplace plus tard par le détail (le prix modifié à la main, la remise et le taux de TVA de la ligne sont conservés). Vendre un ouvrage ne sort rien du stock.</p>`),
      S('Signature du devis et rétractation', `<p>Dans l'en-tête d'un devis, la zone dépliable <b>Signature du devis</b> garde la <b>date de signature</b> (remplie avec la date du jour quand vous touchez « Marquer accepté » ou « Facture d'acompte » avec acceptation), le <b>lieu</b> et <b>où le devis a été signé</b> : dans vos locaux, chez le client / sur le chantier / hors de vos locaux, ou à distance.</p>
        <p>Pour un <b>particulier</b> (client sans SIRET ni forme de société) qui signe <b>hors de vos locaux</b>, l'application affiche sous le titre du devis :</p>${ul([
        'le <b>droit de rétractation de 14 jours</b> : date limite (prolongée au premier jour ouvrable suivant si elle tombe un samedi, un dimanche ou un jour férié) et jours restants',
        'le délai de <b>7 jours avant tout paiement</b> : la date à partir de laquelle un acompte peut être demandé. Elle est rappelée dans la fenêtre « Facture d\'acompte », et un règlement daté avant ce jour demande une confirmation',
        'pour un devis signé <b>à distance</b> : seulement le délai de rétractation'])}
        <p>Les <b>travaux urgents d\'entretien ou de réparation demandés par le client</b> font exception : choisissez « Oui » dans la zone Signature pour supprimer ces rappels. Rien n'apparaît pour un client professionnel ni pour une signature dans vos locaux.</p>
        <p class="warnnote">C'est une aide à la lecture des délais, à confirmer avec votre conseil. L'application ne joint pas de formulaire de rétractation au devis : si votre activité l'exige, ajoutez-le à vos conditions.</p>`),
      S('Faire signer le devis sur tablette', `<p>Sur un devis, le bouton <b>✍ Faire signer</b> ouvre un cadre où le client signe <b>du doigt ou au stylet</b>. Indiquez le nom du signataire, <b>où le devis est signé</b> (dans vos locaux, chez le client, à distance : cela fixe les délais de rétractation et de paiement ci-dessus) et le lieu, faites cocher la déclaration, puis « Valider la signature » : le devis passe à « Accepté », la date de signature est enregistrée avec l'heure, et la signature s'imprime dans la zone « Bon pour accord » du devis, avec « Signé par … le … à … ».</p>${ul([
        '<b>Confidentialité</b> : la signature est dessinée et gardée dans l\'application avec le devis (et dans votre classeur Google Sheets comme le reste) ; elle n\'est envoyée à aucun service de signature',
        '<b>Empreinte du devis</b> : au moment de la signature, l\'application calcule une empreinte (SHA-256) du devis (numéro, date, client, textes, conditions, lignes, totaux). Si le devis est modifié ensuite, un bandeau le signale : faites-le signer de nouveau ou rétablissez-le',
        '<b>Nouvelle signature</b> remplace la précédente ; <b>Retirer la signature</b> l\'efface sans changer l\'état du devis',
        'Un devis déjà facturé ne se signe plus ; un devis dont la validité est dépassée demande confirmation'])}
        <p class="warnnote">Il s'agit d'une signature électronique « simple » : elle matérialise l'accord du client et l'empreinte permet de voir si le devis a changé, mais ce n'est pas une signature qualifiée (certificat). Pour un marché important ou un litige, faites confirmer sa valeur probante par votre conseil.</p>`)
    ]
  },

  contacts: {
    title: 'Contacts', icon: '👥', ok: () => auth.can('contacts'),
    intro: `Quatre listes : Clients, Fournisseurs, Architectes / MOE et Équipe. Créez les fiches avant de les utiliser.`,
    sections: [
      S('À quoi sert chaque liste', ul([
        '<b>Client</b> : sert aux devis et aux chantiers',
        '<b>Fournisseur</b> : se rattache à un produit',
        '<b>Architecte / MOE</b> : se rattache à un chantier et peut être signalé comme intervenant dans le planning',
        '<b>Équipe</b> : les mêmes fiches que Planning › Équipe'])),
      S('La fiche', `<p>Civilité, nom ou raison sociale, contact, adresse (avec complétion automatique), code postal, ville, téléphone, e-mail, fonction, SIRET et note. Le <b>SIRET</b> d'un client professionnel alimente la facture électronique.</p>
        <p>Une fiche client montre aussi ses chantiers, devis, factures et avoirs, et permet de créer un chantier pour ce client.</p>`),
      S('Encours et filtres', `<p>Dans la liste des clients, chaque ligne montre le <b>dernier devis</b> (numéro, date, montant, état) et les <b>chantiers ouverts</b> (dont ceux en retard). À droite, une pastille « dû … » indique ce que le client doit encore (orange) et « en retard … » la part dont l'échéance est dépassée (rouge) ; 📞 l'appelle.</p>
        <p>Les filtres trient par nom, ville, code postal, solde dû, nombre de documents ou ancienneté, et gardent seulement les clients <b>qui ont un impayé</b>, un téléphone ou aucun document. Avant de proposer un nouveau devis à un client, un coup d'œil à cette ligne évite les mauvaises surprises.</p>`),
      S('Clients en double', `<p>À la création d'une fiche (Contacts, devis, chantier ou « Nouveau dossier »), l'application compare ce que vous tapez aux fiches de même nature : même <b>nom</b> (civilité et ordre ignorés), même <b>téléphone</b>, même <b>e-mail</b> ou même <b>SIRET</b>, ou un nom très proche (faute de frappe). Un bandeau propose alors <b>Ouvrir sa fiche</b> (ou <b>Utiliser cette fiche</b> depuis un devis ou un chantier).</p>
        <p>Si le téléphone, l'e-mail, le SIRET ou le nom est identique et que vous enregistrez quand même, une confirmation est demandée. Un nom seulement proche n'est qu'une information.</p>`),
      S('Supprimer une fiche', `<p>Un contact qui a des devis ou factures ne peut pas être supprimé. Un client qui a des chantiers non plus : supprimez-les ou changez leur client d'abord.</p>`)
    ]
  },

  settings: {
    title: 'Réglages', icon: '⚙', ok: () => auth.can('settings'),
    intro: `Réglages est réservé à l'administrateur. Contrôlez en priorité l'IBAN, le BIC et le SIRET : ils figurent sur toutes les factures.`,
    sections: [
      S('Zones verrouillées : Modifier, Enregistrer', `<p>Pour éviter de changer un réglage par erreur, <b>chaque zone de la page est verrouillée</b> : ses champs sont grisés et ne répondent pas. Pour en modifier une :</p>${ul([
        'touchez <b>✎ Modifier</b> en haut de la zone : elle se déverrouille (cadre bleu) et les boutons <b>Annuler</b> et <b>Enregistrer</b> apparaissent, en haut et en bas de la zone',
        '<b>Enregistrer</b> n\'écrit que les champs de cette zone, puis la reverrouille : les autres zones ne sont pas touchées',
        '<b>Annuler</b> abandonne ce que vous avez saisi (une confirmation est demandée si quelque chose a changé) et reverrouille la zone',
        '<b>Une seule zone à la fois</b> : si vous avez saisi quelque chose dans une zone sans l\'enregistrer, l\'application vous demande de l\'enregistrer ou de l\'annuler avant d\'en déverrouiller une autre',
        'Les zones sont : Entreprise, Mentions légales, Logo et fond d\'écran, Ventes, E-mails, Relances, Couleurs, Listes de choix, Seuils et délais, Sauvegarde automatique. La connexion Google Sheets a son propre verrou (🔒 Modifier). Les boutons d\'action (essai d\'e-mail, exporter, restaurer, importer…) restent utilisables : ils demandent leur propre confirmation'])}
        <p class="muted">Quand une synchronisation apporte de nouvelles données pendant que vous modifiez une zone, la page n'est pas redessinée : votre saisie n'est pas perdue.</p>`),
      S('Les cartes', table(['Carte', 'Rôle'], [
        ['Entreprise', 'Raison sociale, adresse, SIRET, assurance, IBAN, BIC : imprimés sur les documents'],
        ['Logo et fond d\'écran', 'Logo imprimé sur les documents (sans choix, celui de vos factures est utilisé) et affichage du logo en fond d\'écran'],
        ['Mentions légales', 'N° de TVA intracommunautaire, RCS, répertoire des métiers, médiateur de la consommation, délai d\'exécution des devis : imprimés en pied de page (seulement ce qui est renseigné). Un avertissement s\'affiche avant d\'imprimer ou d\'envoyer un document s\'il en manque une'],
        ['Ventes', 'Coefficient des ouvrages (prix de vente = prix de revient × coefficient), préfixes et prochains numéros (avec <code>{AAAA}</code> l\'année se met toute seule et la numérotation repart à 1 chaque 1er janvier), délai de règlement, textes par défaut, nature d\'opération, clôture automatique des chantiers'],
        ['E-mails', 'Objet et message par défaut, avec un bouton d\'essai'],
        ['Relances', 'Délais (devis, factures, entre deux relances) et textes des relances de devis et de factures'],
        ['Couleurs et mise en page', 'Couleurs des lignes, mise en page commune des documents'],
        ['Listes de choix', 'Unités, catégories de produits, modes de règlement, types de contrat, fonctions, types d\'absence et suggestions : ajoutez, renommez, réordonnez, masquez (voir ci-dessous)'],
        ['Seuils et délais', 'Base hebdomadaire des salariés, alerte d\'heures par jour, hausse de prix signalée, nombre de relances, durée des devis « en attente »'],
        ['Accès des membres', 'État de la protection par code PIN, avec bouton pour la désactiver'],
        ['Google Sheets', 'Connexion, synchronisation, état de la dernière synchro'],
        ['Modèles de texte', 'Textes réutilisables à insérer dans les devis et factures'],
        ['Importer des devis / factures', 'Voir ci-dessous'],
        ['Photos & fichiers (Drive ou OneDrive)', '« Tester le stockage » vérifie l\'envoi dans le dossier GestPro et indique où partent les fichiers'],
        ['Sauvegarde', 'Exporter (JSON), Restaurer, et sauvegarde automatique hebdomadaire dans Drive / OneDrive (zone « Sauvegarde automatique » à déverrouiller pour la changer ; liste des copies, téléchargement, « Sauvegarder maintenant »)']])
        + `<p>Les numéros sont attribués dans l'ordre : si vous reprenez un historique, réglez le « prochain numéro » avant d'émettre un document.</p>`),
      S('Listes de choix', `<p>Les listes déroulantes de l'application se gèrent dans la carte <b>Listes de choix</b> (touchez <b>✎ Modifier</b>, puis une liste pour la déplier ; <b>Enregistrer</b> à la fin) : <b>unités</b>, <b>catégories de produits</b>, <b>modes de règlement</b>, <b>types de contrat</b>, <b>fonctions des membres</b>, <b>types d'absence</b>, et trois listes de <b>suggestions</b> (habilitations, civilités et formes juridiques, fonctions d'un maître d'œuvre ; la saisie y reste libre).</p>${ul([
        '<b>Ajouter</b> une valeur, la <b>renommer</b>, la <b>déplacer</b> (↑ ↓) ou la <b>masquer</b> (case « proposée » décochée) : une valeur masquée n\'est plus proposée dans les menus, mais les fiches qui l\'utilisent la gardent',
        '<b>Supprimer</b> : seulement une valeur que rien n\'utilise. Une valeur utilisée (« utilisée 3 fois ») ne se supprime pas ; masquez-la. Un texte enregistré tel quel (unité, catégorie, type de contrat) ne se renomme plus une fois utilisé, pour que les devis et factures déjà émis gardent leur texte ; un mode de règlement, une fonction ou un type d\'absence se renomment librement',
        '<b>Valeurs protégées</b> (cadenassées, utilisées par l\'application) : unités u, h et forfait ; catégories Main d\'œuvre, Sous-traitance et Ouvrage ; type d\'absence « Autre absence »',
        '<b>Catégorie « service »</b> : cochez-la pour une catégorie que vous ajoutez (livraison, étude…) : ses produits n\'ont ni stock ni seuil d\'alerte, comme la main d\'œuvre',
        '<b>↺ Liste d\'origine</b> revient à la liste fournie avec l\'application ; rien ne change tant que vous ne modifiez pas une liste. Les listes sont enregistrées avec les réglages et partagées entre vos appareils'])}
        <p class="warnnote">Une unité que vous ajoutez est envoyée comme « unité générique » (C62) dans la facture électronique ; les unités d'origine gardent leur code précis.</p>`),
      S('Seuils et délais', `<p>La carte <b>Seuils et délais</b> (à déverrouiller par <b>✎ Modifier</b>) règle cinq valeurs de calcul : la <b>base hebdomadaire</b> des salariés (35 h ; chaque fiche de membre peut avoir son horaire), l'<b>alerte d'heures par jour</b> du planning (8 h), la <b>hausse de prix d'achat</b> signalée à la réception (5 %), le <b>nombre de relances</b> d'un devis (3) et la durée pendant laquelle un devis envoyé est « <b>en attente</b> » sur l'accueil (90 jours). « Valeurs d'origine » les remet toutes ; seules les valeurs modifiées sont enregistrées. Les délais légaux (rétractation de 14 jours, 7 jours avant tout paiement) ne se changent pas.</p>`),
      S('Importer des devis et des factures', `<p>La carte ajoute à vos données le contenu d'un fichier d'import GestPro (clients, chantiers, produits, devis, factures, règlements) <b>sans rien remplacer ni modifier</b> : ce qui existe déjà est ignoré. Une confirmation indique d'abord ce qui sera ajouté.</p>
        <p>La même carte accepte un <b>fichier de correction des statuts</b> (devis et chantiers importés) : l'application annonce le nombre de modifications avant d'agir, conserve ce que vous avez changé à la main depuis l'import, et une seconde application ne change plus rien.</p>
        <p class="warnnote">Ces fichiers contiennent des données d'entreprise : gardez-les hors de tout dépôt public.</p>`),
      S('Sauvegarder et restaurer', `<p>Quand Google Sheets est configuré, chaque modification est synchronisée automatiquement. Exportez en plus un fichier « Exporter (JSON) » avant une opération importante et gardez-le hors de l'appareil. « Restaurer… » recharge un fichier de sauvegarde.</p>`)
    ]
  },

  facebook: {
    title: 'Facebook', icon: '📣', ok: () => auth.can('facebook'),
    intro: `Cette section prépare vos publications. Elle est indépendante des chantiers et des ventes.`,
    sections: [
      S('À savoir', ul([
        'Modèles de texte, calendrier éditorial et statistiques',
        'Publication directe si une page Facebook est reliée ; sinon, le bouton « Partager » suffit',
        'La tuile « Publications à faire » de l\'accueil compte les publications programmées dont la date est arrivée']))
    ]
  },

  faq: {
    title: 'Dépannage', icon: '🛟', ok: () => true,
    intro: `Les situations les plus fréquentes. Avant toute manipulation inhabituelle, faites une sauvegarde (Réglages › Exporter).`,
    sections: [
      S('L\'application ne démarre pas ou une mise à jour n\'apparaît pas', `<p>« GestPro n'a pas pu démarrer » : les fichiers de l'application ne sont pas tous à la même version. Déposez de nouveau l'ensemble des fichiers sur GitHub, puis rechargez la page.</p>
        <p>Une mise à jour n'apparaît pas : l'ancienne version est encore ouverte. Fermez complètement l'application (sur téléphone aussi dans les applications récentes), rouvrez-la, au besoin deux fois.</p>`),
      S('Les données diffèrent d\'un appareil à l\'autre', `<p>Les appareils ne sont pas reliés au même classeur, ou la synchronisation est en attente. Dans <b>Réglages › Google Sheets</b>, vérifiez l'état et touchez « Synchroniser maintenant ». Utilisez la même adresse et la même clé partout.</p>`),
      S('Une section de la barre du bas manque', `<p>Votre profil d'accès ne la comprend pas. L'administrateur change le profil dans Planning › Équipe.</p>`),
      S('Code PIN oublié', `<p>Sur l'écran de connexion, « Code oublié ? » puis tapez REINITIALISER : tous les profils et codes sont supprimés, les fiches des membres sont conservées. Recréez ensuite un code administrateur.</p>`),
      S('La marge d\'un chantier paraît trop belle', `<p>Causes habituelles : heures réalisées non saisies, coût horaire absent, matériel sorti sans chantier, facture non rattachée. Faites saisir les heures par les salariés dans le planning, renseignez le coût horaire des membres, indiquez le chantier à chaque sortie de stock.</p>`),
      S('Un devis a disparu de la liste, ou n\'est pas compté à l\'accueil', `<p>Les devis facturés sont masqués par défaut : touchez « Voir tout » sous la recherche, ou filtrez sur le statut Facturé. La tuile « Devis en attente » ne retient que les devis envoyés depuis moins de 90 jours : pour les autres, filtrez la liste sur le statut Envoyé.</p>`),
      S('Un chantier ne passe pas en « Terminé »', `<p>Tout le marché n'est pas facturé, ou une facture n'est pas entièrement réglée. Vérifiez les factures et règlements, ou touchez « ✓ Terminer le chantier ».</p>`),
      S('Le scanner de codes-barres ne démarre pas', `<p>L'accès à la caméra est refusé, ou l'application est ouverte hors https. Autorisez la caméra dans le navigateur ; en attendant, saisissez le code à la main dans le bandeau du scanner.</p>`),
      S('L\'e-mail ne part pas', `<p>Le script Google n'est pas autorisé, ou la limite de 40 envois par jour est atteinte. Dans Réglages › E-mails, envoyez un e-mail de test ; sinon utilisez le partage du téléphone.</p>`),
      S('Deux documents ont le même numéro', `<p>Deux appareils ont émis un document au même instant, hors ligne. Corrigez le numéro de l'un des deux avant de l'envoyer ; l'application signale un numéro déjà utilisé à l'enregistrement.</p>`),
      S('La lecture d\'un document fournisseur est fausse', `<p>La mise en page du PDF est inhabituelle. Cliquez sur <b>✋ Lire à la main</b>, entourez le tableau des lignes et vérifiez les colonnes : la mise en page peut être retenue pour ce fournisseur (et oubliée depuis le même écran). Sinon, décochez les lignes à ne pas reprendre et corrigez les valeurs dans le tableau avant de valider.</p>`)
    ]
  }
};

/* Ordre d'affichage de la liste « Tous les sujets » */
const ORDER = ['start', 'atoz', 'dashboard', 'sites', 'site', 'planning', 'team', 'stock', 'orders', 'locations', 'moves', 'docs', 'doc', 'contacts', 'settings', 'facebook', 'faq'];

/* ---------- Écran affiché → sujet d'aide ---------- */
export async function currentTopic(hash = location.hash) {
  const [, name = 'dashboard', a = '', b = ''] = (hash || '').split('?')[0].split('/');
  switch (name) {
    case 'sites': return { id: 'sites' };
    case 'site': return { id: 'site' };
    case 'planning': return { id: a === 'team' ? 'team' : 'planning' };
    case 'stock': return { id: a === 'locations' ? 'locations' : a === 'moves' ? 'moves' : a === 'orders' ? 'orders' : 'stock' };
    case 'docs': return { id: 'docs' };
    case 'doc': {
      let type = '';
      if (a === 'new') type = b.startsWith('copy:') ? await docType(b.slice(5)) : b.split('-')[0];
      else type = await docType(a);
      return { id: 'doc', type };
    }
    case 'contacts': return { id: 'contacts' };
    case 'facebook': return { id: 'facebook' };
    case 'settings': return { id: 'settings' };
    default: return { id: 'dashboard' };
  }
}
async function docType(id) { try { return (await db.get('documents', id))?.type || ''; } catch { return ''; } }

/* Section ouverte au départ selon le type de document */
const DOC_OPEN = { quote: 0, invoice: 5, credit: 7 };

/* ---------- Fenêtre d'aide ---------- */
export function helpModal(id = 'start', o = {}) {
  const T = TOPICS[id] || TOPICS.start; if (!TOPICS[id]) id = 'start';
  const open = id === 'doc' ? (DOC_OPEN[o.type] ?? 0) : 0;
  const topics = ORDER.filter(k => k !== id && TOPICS[k].ok());
  const body = `<div class="help"><p class="hintro">${T.intro}</p>
    ${T.sections.map((s, i) => `<details${i === open ? ' open' : ''}><summary>${s.title}</summary><div>${s.html}</div></details>`).join('')}
    <h4 class="hmore">Autres sujets</h4>
    <div class="hchips">${topics.map(k => `<button type="button" class="hchip" data-topic="${k}">${TOPICS[k].icon} ${e(TOPICS[k].title)}</button>`).join('')}</div></div>`;
  return modal(`${T.icon} ${T.title}`, body, null, {
    wide: true,
    onOpen: f => {
      f.addEventListener('click', ev => {
        const t = ev.target.closest('[data-topic]');
        if (t) { ev.preventDefault(); helpModal(t.dataset.topic); return; }
        if (ev.target.closest('a[data-go]')) document.querySelector('#modal').close(); // le lien change d'écran
      });
    }
  });
}

export async function openHelp() {
  const t = await currentTopic();
  return helpModal(TOPICS[t.id]?.ok() === false ? 'start' : t.id, t);
}
