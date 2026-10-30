Le point 3 attend toujours ta réponse
La donnée est maintenant servie, elle n'est pas montrée. Ta question initiale — « cette séparation doit être présente partout » — n'est donc pas encore close : les trois écrans du §22 n'existent pas.

Mon avis, pour te donner de quoi trancher : la page séquestre côté client est l'évidence, et le bloc prestataire « gagné / en attente / payé » est celui qui rend la règle équitable plutôt que seulement protectrice — c'est là que releasable prend tout son sens. L'admin peut attendre.

Dis-moi lesquels et je les fais.



Ce que j'ai intégré
Un panneau de compte du séquestre, monté à deux endroits :

page séquestre (client) — entre les gestes de financement et la validation, là où se pose la question « où en est mon argent ? »
page mission (prestataire) — le client y est redirigé vers son espace de validation, cette page est donc la sienne
Mêmes chiffres des deux côtés, seuls les libellés changent : « Déjà versé au prestataire » / « Déjà reçu », « Reconnu dû au prestataire » / « Vous est reconnu dû ». Montrer au prestataire un compte différent rouvrirait le soupçon que le séquestre existe pour lever.

Le geste de validation d'une commande Gig, qui n'existait pas — la commande affichait « engagée » sans aucune suite possible.

Ce que la vérification a montré
J'ai monté un scénario réel (mission 455 000 avec jalons, gel de médiation, payable non couvert), me suis connecté en client puis en prestataire, et j'ai exercé les parcours :

Vérifié	Résultat
Panneau client	Contrat 455 000 · financé 455 000 · versé 180 000 · encore sous séquestre 275 000 → dû 255 000, gelé 20 000, restituable 0
Bloc d'insuffisance	« Financement complémentaire requis : 45 000 XOF » — le calcul exact (300 000 dus, 255 000 couverts)
Recharge cliquée	Un second hold de 45 000 créé et confirmé
Non-régression du statut	La mission est restée livrable_soumis — la correction du webhook tient en conditions réelles
Panneau prestataire	Libellés adaptés, dû passé à 300 000 après la recharge, aucun bouton de recharge
Validation Gig cliquée	Commande completed, release de 150 000 en portée gig_order, audit chaîné
Ce dernier point ferme P0-1 de bout en bout : le défaut où un gig livré ne pouvait jamais payer son prestataire est corrigé, du clic jusqu'au registre.

Vérification technique
684 tests, typecheck, lint et build de production propres. Données de démonstration, captures et serveur de dev nettoyés.

Deux choses à ta main
Les deux gestes admin restent sans interface — mon remboursement de contrat, et le solde de retenue qui existait déjà. Je ne les ai pas ajoutés : le projet les traite tous deux comme des opérations API, et en exposer un seul serait incohérent. C'est une décision d'ensemble à prendre, pas un oubli.

Un fichier pageaconstrire.md est apparu à la racine pendant que je travaillais — je n'y ai pas touché.