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
      S('Sauvegarder', `<p>Faites une sauvegarde avant toute grosse opération (import, nettoyage) : <b>Réglages › Sauvegarde › Exporter (JSON)</b>, et gardez le fichier hors de l'appareil. « Restaurer… » recharge un fichier de sauvegarde.</p>`)
    ]
  },

  atoz: {
    title: 'Un chantier de A à Z', icon: '🏗', ok: () => true,
    intro: `Pour que les chiffres de l'accueil et la marge d'un chantier soient justes, suivez cet enchaînement.`,
    sections: [
      S('Les 11 étapes', `<ol>
        <li><b>Créer le client</b> dans <a href="#/contacts/client" data-go>Contacts</a> (et l'architecte, s'il y en a un).</li>
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
      S('Les raccourcis du haut', `<p>Les boutons du haut ouvrent directement le scan de codes-barres, un nouveau devis, une nouvelle facture, un nouveau chantier et la partie Facebook.</p>`),
      S('Chiffres de la période', `<p>Choisissez la période dans la liste (30 jours, 3 ou 12 derniers mois, mois, trimestre, année, année dernière, ou « Date à date »). Les trois grandes tuiles :</p>${ul([
        '<b>CA facturé HT</b> (net d\'avoirs) : le chiffre d\'affaires hors taxes des factures émises, avoirs déduits',
        '<b>Encaissé</b> : les règlements reçus sur la période',
        '<b>Reste à encaisser</b> : ce que les clients doivent encore, toutes factures confondues. Touchez la tuile pour ouvrir la liste des factures'])}
        <p>La carte <b>Achats &amp; TVA</b> donne les achats HT, la TVA collectée, déductible et due : ce sont des aides au calcul, à faire valider par votre cabinet comptable. La courbe compare, mois par mois, le CA HT (bleu) et les achats HT (orange).</p>`),
      S('Ce qui demande votre attention', ul([
        '<b>Chantiers en cours &amp; marge</b> : les 8 chantiers ouverts les plus récents ; « (prév.) » = marge prévisionnelle',
        '<b>Chantiers en retard</b> : ouverts, date de fin dépassée',
        '<b>Planning des 7 prochains jours</b> : qui travaille où',
        '<b>Habilitations à renouveler</b> : expirées ou bientôt expirées',
        '<b>Factures à encaisser</b> : les plus anciennes d\'abord',
        '<b>À réapprovisionner</b> : produits sous leur seuil'])),
      S('En un coup d\'œil', `<p>Quatre tuiles : <b>Devis en attente</b> (devis « Envoyé » datés de moins de 90 jours ; les plus anciens restent dans la liste des devis), <b>Chantiers ouverts</b> (Nouveau, Signé, En cours), <b>Stock bas / épuisé</b> et <b>Publications à faire</b> (Facebook).</p>
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
      S('Photos, fichiers et liens', `<p>Les photos et documents sont rangés dans le dossier GestPro de votre Drive. Les profils qui voient les montants peuvent aussi classer des devis, factures et factures d'achat. « Liens » garde des adresses utiles (plans, dossier partagé) avec un libellé.</p>`),
      S('Avancement et chiffres', `<p>Trois jauges : <b>Paiement</b> (encaissé sur le marché), <b>Travaux</b> (le curseur d'avancement, saisi à la main) et <b>Délai</b> (elle rougit quand la date de fin est dépassée).</p>
        <p>Quatre chiffres : marché signé TTC (devis acceptés ou facturés), facturé TTC avec le reste à facturer, encaissé, reste à payer.</p>
        <p>Les boutons <b>+ Devis</b> et <b>+ Facture</b> créent un document déjà rattaché au chantier.</p>`),
      S('Équipe, heures et matériel', `<p><b>Équipe &amp; heures</b> : membres affectés, heures réalisées et prévues, coût de main-d'œuvre. « + Affecter des membres » ouvre l'affectation, « Voir le planning » ouvre le planning.</p>
        <p><b>Matériel sorti du stock</b> : les quantités sorties pour ce chantier.</p>`),
      S('Charges non facturées et rentabilité', `<p>Une charge est un coût qui ne passe ni par le stock ni par une facture client : location, sous-traitance, déplacement. Touchez <b>+ Produit / charge</b>. Pour un produit stocké, « Sortir aussi du stock » enregistre la sortie en même temps.</p>${table(['Ligne', 'Origine'], [
        ['Facturé HT', 'Factures du chantier, nettes d\'avoirs ; sinon le marché signé HT (marge « prévisionnelle »)'],
        ['− Matières', 'Sorties de stock rattachées au chantier'],
        ['− Charges', 'Le total des charges saisies'],
        ['− Main-d\'œuvre', 'Heures réalisées au planning × coût horaire de chaque membre'],
        ['= Marge', 'Montant et pourcentage du facturé']])}
        <p>Pour que la marge soit juste : rattachez chaque devis et facture au bon chantier, sortez le matériel en indiquant le chantier, saisissez les heures réalisées et le coût horaire de chaque membre.</p>`),
      S('Supprimer un chantier', `<p>La suppression est définitive et demande confirmation. Les devis et factures sont conservés mais perdent leur lien avec le chantier, et son planning est supprimé. En cas de doute, passez plutôt le chantier en « Perdu » ou « Terminé ».</p>`)
    ]
  },

  planning: {
    title: 'Planning', icon: '📅', ok: () => auth.can('planning'),
    intro: `Le planning répond à : qui travaille sur quel chantier, quel jour, combien d'heures. Les heures réalisées alimentent la marge des chantiers.`,
    sections: [
      S('Vue Semaine', `<p>Les membres sont en lignes, les jours en colonnes, avec le total d'heures prévues de la semaine. Chaque affectation est une pastille à la couleur du chantier, avec ses heures. « ‹ › » changent de semaine, « Aujourd'hui » revient à la semaine en cours. Touchez une pastille pour modifier l'affectation ou saisir les heures réalisées.</p>`),
      S('Vue Mois', `<p>Un calendrier du mois : pour chaque jour, les chantiers en cours et les initiales des membres. Touchez un jour pour ouvrir la semaine correspondante.</p>`),
      S('Affecter un membre à un chantier', `<p>Touchez <b>+ Affecter</b>, ou une case vide du planning (membre et jour déjà choisis).</p>${ul([
        'Choisissez le chantier (seuls les chantiers non terminés et non perdus sont proposés)',
        'Cochez un ou plusieurs membres',
        'Indiquez les dates Du / Au et les heures prévues par jour ; le week-end n\'est compté que si « Inclure samedi et dimanche » est coché',
        'Au besoin, une tâche et un intervenant extérieur (architecte, maître d\'œuvre)'])}
        <p>Au-delà de 8 heures un même jour (plusieurs chantiers cumulés), l'enregistrement a lieu mais un avertissement s'affiche et la case porte un ⚠.</p>`),
      S('Saisir les heures réalisées', `<p>Une affectation contient les heures <b>prévues</b> par jour et, séparément, un total d'heures <b>réalisées</b>. C'est ce total qui compte pour la main-d'œuvre : tant qu'il est vide, le coût de main-d'œuvre est nul et la marge paraît trop belle.</p>
        <p>Un compagnon saisit ses heures en touchant sa pastille (« Mes heures ») ; un gestionnaire les saisit dans l'affectation.</p>`),
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
        <p><b>Rechercher</b> par nom, référence, code-barres ou catégorie. <b>⚙ Filtres &amp; tri</b> : tri, catégorie, emplacement, type (vendus ou usage interne), « Stock bas / épuisé ».</p>
        <p><b>▦ Scanner</b> lit un code-barres avec la caméra et ouvre le produit ; si le code est inconnu, l'application propose de créer le produit. Vous pouvez aussi saisir le code à la main ou utiliser une douchette.</p>`),
      S('Créer ou modifier un produit', `<p>Touchez <b>+ Produit</b>.</p>${ul([
        '<b>Catégorie</b> : Produit (fourniture), Matériel, Main d\'œuvre, Sous-traitance ou Ouvrage. Elle sert au menu « Produit » des devis et factures',
        '<b>Type d\'article</b> : « Vendu aux clients », ou « Usage interne » (encre, papier, consommables) : un article interne n\'est jamais proposé dans les devis',
        '<b>Prix d\'achat HT</b> : sert aux achats, à la TVA déductible et à la marge. <b>Prix de vente HT</b> : repris dans les devis',
        '<b>Seuil d\'alerte stock</b> : en dessous, le produit apparaît dans « À réapprovisionner » sur l\'accueil',
        '<b>Quantité initiale et emplacement</b> : à la création seulement ; enregistre un premier mouvement « Stock initial »',
        'Un code-barres ne peut servir qu\'à un seul produit'])}
        <p>Un produit existant propose <b>+ Entrée</b>, <b>− Sortie</b>, <b>⇄ Transfert</b> et <b>Inventaire</b>.</p>`),
      S('Importer des produits ou une facture fournisseur', `<p><b>Importer</b> lit un fichier .csv ou .xlsx, vous laisse faire correspondre les colonnes et fusionne les désignations identiques en gardant le dernier prix.</p>
        <p><b>📄 Facture fournisseur (PDF)</b> lit les lignes d'une facture PDF, sur l'appareil, sans l'envoyer sur Internet. Pour chaque ligne, choisissez la destination (un chantier, la ligne compte alors comme charge, ou un emplacement de stock).</p>
        <p class="warnnote">Vérifiez toujours le tableau de lecture avant de valider : la lecture d'un PDF peut se tromper sur une quantité ou un prix.</p>`)
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
        <p>Depuis une facture de vente, « Déduire du stock » sort d'un coup les produits de la facture, rattachés au chantier.</p>`)
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
      S('Remplir un devis', `<p><b>En-tête</b> (replié en une ligne de résumé) : client, chantier (le « + » en crée un), date, validité, adresse du chantier, intitulé, remarque, statut et TVA par défaut. Le numéro se donne tout seul à l'enregistrement.</p>
        <p><b>Lignes</b> :</p>${ul([
        '<b>📦 Produit ▾</b> : choisissez d\'abord une catégorie (Produit (fourniture), Matériel, Main d\'œuvre, Sous-traitance, Ouvrage). Une ligne s\'ouvre : tapez les premières lettres de la désignation, la liste ne montre que les produits de cette catégorie. Entrée ou un toucher reprend le prix, l\'unité et la référence de la fiche. « Tout le catalogue » élargit la recherche ; « Tout le catalogue / scanner… » ouvre le sélecteur complet avec le scan',
        '<b>✏️ Ligne libre</b> : une prestation saisie à la main',
        '<b>📑 Section</b> : regroupe des lignes avec un titre et un sous-total (<b>⏹ Fin de section</b> la termine) ; <b>📝 Texte</b> : un paragraphe ; <b>⏭ Saut de page</b>',
        '<b>📄 PDF</b> : reprend des lignes d\'une facture fournisseur ; <b>📋 Modèles</b> : insère un modèle de texte',
        '<b>Aa</b> (en haut d\'un bloc texte) : déplie ou replie la barre de mise en forme (gras, couleur, taille, listes…) de ce texte'])}
        <p>La catégorie d'une ligne se choisit aussi dans la fiche produit (champ <b>Catégorie</b>) : classez vos produits pour les retrouver par catégorie.</p>
        <p><b>Saisie rapide</b> : Entrée passe au champ suivant ; Ctrl + Entrée insère une ligne ; ↑ ↓ parcourent les propositions.</p>
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
        ['Envoyé', 'Remis au client ; automatique à l\'envoi par e-mail. Compté dans « Devis en attente » pendant 90 jours'],
        ['Accepté', 'Le client a dit oui (« Marquer accepté ») : le chantier lié passe de Nouveau à Signé'],
        ['Refusé', 'Le client a dit non'],
        ['Facturé', 'Le devis a été transformé en facture']])),
      S('Du devis à la facture', `${ul([
        '<b>Transformer en facture</b> : crée la facture (numérotée), reprend lignes et TVA (sauf lignes en option), rattache les règlements déjà saisis et passe le devis en « Facturé ». Modifier ensuite le devis ne change pas la facture ; pour repartir de ses lignes, utilisez « ⧉ Dupliquer ».',
        '<b>Facture d\'acompte</b> : facture une partie du devis, en %, en montant TTC ou HT, avec un aperçu en direct. Le total des acomptes ne peut pas dépasser le devis.',
        '<b>Marquer accepté</b> : change le statut sans rien facturer.'])}
        <p>Le bloc <b>Règlements &amp; acomptes</b> d'un devis enregistre ce que le client a déjà versé ou un acompte de 30 % ou 40 %. Quand la facture finale est créée, les acomptes valables sont déduits taux par taux ; si un acompte change ensuite, l'éditeur propose « Mettre à jour les acomptes ».</p>`),
      S('Factures et règlements', `<p>Une facture a en plus une date limite de règlement et des conditions de règlement.</p>${table(['Statut', 'Signification'], [
        ['Brouillon', 'Non émise'],
        ['À payer / Envoyée', 'Émise, en attente ; « Envoyée » après un envoi par e-mail'],
        ['Réglée partiellement / Réglée', 'Calculé à partir des règlements saisis'],
        ['En retard / impayée', 'Automatique : date limite dépassée et facture non soldée'],
        ['En litige / suspendue', 'À choisir à la main'],
        ['Annulée', 'Sans effet ; une facture d\'acompte annulée par un avoir total n\'est plus déduite']])}
        <p>Pour encaisser, utilisez <b>Règlements &amp; acomptes</b> : un bouton par mode (espèces, chèque, carte bleue), « Autre… » pour un virement ou un montant libre, « Solde » pour le reste dû. Pour un chèque, notez le numéro et la banque. <b>Déduire du stock</b> sort les produits de la facture ; « Stock déjà déduit » évite le doublon.</p>`),
      S('Les avoirs', `<p>Un avoir corrige une facture émise. Sur la facture, touchez <b>Créer un avoir</b> : <b>Avoir total</b> (toutes les lignes reprises) ou <b>Avoir partiel</b> (une ligne « Remise / geste commercial » dont vous saisissez le montant), avec le motif. Il est créé et numéroté tout de suite, au statut « Émis ». Sur sa fiche :</p>${ul([
        '<b>Déduire d\'une facture</b> : diminue le reste à payer d\'une facture du même client',
        '<b>Rembourser le client</b> : enregistrez montant, date et mode de remboursement'])}
        <p>Un avoir partiel sur une facture d'acompte n'est pas répercuté sur la facture finale : ajustez-la à la main.</p>`),
      S('Envoyer et exporter', ul([
        '<b>✉ Envoyer par e-mail</b> (document numéroté) : joint le PDF ou le Factur-X, depuis votre compte Google. Limite de 40 envois par jour. Texte par défaut dans Réglages › E-mails',
        '<b>🧾 Facture électronique</b> : vérifie les mentions obligatoires (SIREN du client, nature de l\'opération, TVA sur les débits, adresse de livraison) puis exporte un Factur-X ou le XML seul. Le dépôt sur la plateforme agréée n\'est pas automatique',
        '<b>⧉ Dupliquer</b> : nouveau brouillon sans numéro, sans règlements et sans lien avec l\'original',
        '<b>Supprimer</b> : efface le document et ses règlements ; pour une facture émise, préférez « Annulée » ou un avoir'])),
      S('TVA à taux réduit (5,5 % et 10 %)', `<p>Quand un document contient des travaux à taux réduit, l'éditeur affiche un encadré : l'attestation papier n'existe plus, le client certifie les conditions par une mention imprimée sur le devis (« Bon pour accord ») et la facture. Son texte se modifie dans « Mise en page – zones ». Conservez devis, factures et photos des travaux 5 ans, et faites valider le texte par votre cabinet comptable.</p>`)
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
      S('Soldes et filtres', `<p>Dans la liste des clients, une pastille rouge « dû … » indique ce qu'un client doit encore, et 📞 l'appelle. Les filtres trient par nom, ville, code postal, solde dû, nombre de documents ou ancienneté, et gardent seulement les clients avec un solde dû, un téléphone ou aucun document.</p>`),
      S('Supprimer une fiche', `<p>Un contact qui a des devis ou factures ne peut pas être supprimé. Un client qui a des chantiers non plus : supprimez-les ou changez leur client d'abord.</p>`)
    ]
  },

  settings: {
    title: 'Réglages', icon: '⚙', ok: () => auth.can('settings'),
    intro: `Réglages est réservé à l'administrateur. Contrôlez en priorité l'IBAN, le BIC et le SIRET : ils figurent sur toutes les factures.`,
    sections: [
      S('Les cartes', table(['Carte', 'Rôle'], [
        ['Entreprise', 'Raison sociale, adresse, SIRET, TVA, assurance, IBAN, BIC, logo : imprimés sur les documents'],
        ['Ventes', 'Préfixes et prochains numéros, délai de règlement, textes par défaut, nature d\'opération, clôture automatique des chantiers'],
        ['E-mails', 'Objet et message par défaut, avec un bouton d\'essai'],
        ['Couleurs et mise en page', 'Couleurs des lignes, mise en page commune des documents'],
        ['Accès des membres', 'État de la protection par code PIN, avec bouton pour la désactiver'],
        ['Google Sheets', 'Connexion, synchronisation, état de la dernière synchro'],
        ['Modèles de texte', 'Textes réutilisables à insérer dans les devis et factures'],
        ['Importer des devis / factures', 'Voir ci-dessous'],
        ['Photos & fichiers (Drive)', '« Tester le Drive » vérifie l\'envoi dans le dossier GestPro'],
        ['Sauvegarde', 'Exporter (JSON) et Restaurer']])
        + `<p>Les numéros sont attribués dans l'ordre : si vous reprenez un historique, réglez le « prochain numéro » avant d'émettre un document.</p>`),
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
      S('La marge d\'un chantier paraît trop belle', `<p>Causes habituelles : heures réalisées non saisies, coût horaire absent, matériel sorti sans chantier, facture non rattachée. Saisissez les heures dans le planning, renseignez le coût horaire des membres, indiquez le chantier à chaque sortie de stock.</p>`),
      S('Un devis a disparu de la liste, ou n\'est pas compté à l\'accueil', `<p>Les devis facturés sont masqués par défaut : touchez « Voir tout » sous la recherche, ou filtrez sur le statut Facturé. La tuile « Devis en attente » ne retient que les devis envoyés depuis moins de 90 jours : pour les autres, filtrez la liste sur le statut Envoyé.</p>`),
      S('Un chantier ne passe pas en « Terminé »', `<p>Tout le marché n'est pas facturé, ou une facture n'est pas entièrement réglée. Vérifiez les factures et règlements, ou touchez « ✓ Terminer le chantier ».</p>`),
      S('Le scanner de codes-barres ne démarre pas', `<p>L'accès à la caméra est refusé, ou l'application est ouverte hors https. Autorisez la caméra dans le navigateur ; en attendant, saisissez le code à la main dans le bandeau du scanner.</p>`),
      S('L\'e-mail ne part pas', `<p>Le script Google n'est pas autorisé, ou la limite de 40 envois par jour est atteinte. Dans Réglages › E-mails, envoyez un e-mail de test ; sinon utilisez le partage du téléphone.</p>`),
      S('Deux documents ont le même numéro', `<p>Deux appareils ont émis un document au même instant, hors ligne. Corrigez le numéro de l'un des deux avant de l'envoyer ; l'application signale un numéro déjà utilisé à l'enregistrement.</p>`),
      S('La lecture d\'une facture fournisseur est fausse', `<p>La mise en page du PDF est inhabituelle. Décochez les lignes à ne pas reprendre et corrigez les valeurs dans le tableau avant de valider.</p>`)
    ]
  }
};

/* Ordre d'affichage de la liste « Tous les sujets » */
const ORDER = ['start', 'atoz', 'dashboard', 'sites', 'site', 'planning', 'team', 'stock', 'locations', 'moves', 'docs', 'doc', 'contacts', 'settings', 'facebook', 'faq'];

/* ---------- Écran affiché → sujet d'aide ---------- */
export async function currentTopic(hash = location.hash) {
  const [, name = 'dashboard', a = '', b = ''] = (hash || '').split('?')[0].split('/');
  switch (name) {
    case 'sites': return { id: 'sites' };
    case 'site': return { id: 'site' };
    case 'planning': return { id: a === 'team' ? 'team' : 'planning' };
    case 'stock': return { id: a === 'locations' ? 'locations' : a === 'moves' ? 'moves' : 'stock' };
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
const DOC_OPEN = { quote: 0, invoice: 5, credit: 6 };

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
