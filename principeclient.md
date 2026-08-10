 Workflow — Client

```
A. Publier une mission
   - Titre, description, budget, compétences requises
   - Route : /dashboard/client/missions/creation
        │
        ▼
D. Propositions reçues (dashboard d'attente)
   - Compare les propositions soumises par les prestataires
   - Sélectionne UNE proposition
   - Route : /dashboard/client/candidatures
        │
        ▼
Messagerie + appels audio/vidéo (chat/meet/call)
   - Discussion, entretien (chat/audio/vidéo) avec le prestataire retenu
   - Négociation informelle avant l'offre formelle
   - Route : /dashboard/client/messages (+ bulle flottante globale)
        │
        ▼
Création de l'offre formelle
   - Le client fixe : jalons, montants, délais
   - Envoi de l'offre au prestataire
   - Route : /dashboard/client/offres
        │
   ┌────┴─────────────────┐
   │                       │
Refusée/contre-proposée   Acceptée
   │                       │
   ▼                       ▼
Retour à la messagerie Financement de l'escrow
(négociation)          - Le client dépose le montant total
                       - Précondition à la signature
                            │
                            ▼
                       Double signature
                       - Le client signe (le prestataire signe aussi)
                            │
                            ▼
                       Contrat scellé et actif
                       - Route : /dashboard/pilotage/[contractId]
                            │
                            ▼
                       Hub de pilotage (vue client)
                       - Progression globale, montant en séquestre
                       - Route : /dashboard/pilotage/[contractId]
                            │
                            ▼
                       Jalons — vue client (client-detail.tsx)
                       - Bouton "Vérifier" / "Révision(N)" sur chaque jalon soumis
                       - Visualise les preuves, valide ou rejette (motif obligatoire)
                            │
                       ┌────┴─────────────────────────┐
                       │                               │
              Tous les jalons validés          Seuil de rejets dépassé
                       │                       sur un jalon
                       │                               │
                       │                               ▼
                       │                   Litige — Purge
                       │                   - Doit trancher tout jalon en attente
                       │                               │
                       │                               ▼
                       │                   Litige — Calcul du prorata
                       │                   (automatique, rien à faire ici)
                       │                               │
                       │                               ▼
                       │                   Litige — Fenêtre d'appel 48h
                       │                   - Le client peut faire appel si en désaccord
                       │                     avec un jalon validé tacitement
                       │                               │
                       │                     ┌─────────┴─────────┐
                       │                     │                   │
                       │              Pas d'appel           Appel du client
                       │                     │                   │
                       │                     │                   ▼
                       │                     │      Litige — Médiation interne
                       │                     │      - Présente ses preuves si convoqué
                       │                     │                   │
                       │                     │      (→ arbitrage externe disponible ;
                       │                     │         ⚠️ pas de vérification de seuil
                       │                     │         d'enjeu dans l'implémentation actuelle)
                       │                     │                   │
                       └─────────────────────┴───────────────────┘
                                             │
                                             ▼
                       Clôture — Route : /dashboard/pilotage/[contractId]
                       - Voit le montant final versé et sa justification
                            │
                            ▼
                       Évaluation du prestataire
                       - Note qualité, communication, délai
                       - Route : /dashboard/client/avis (⚠️ non implémenté — page vide)
```
