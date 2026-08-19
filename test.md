Voici la redéfinition complète **publication → exécution** avec tout ce qu'on a construit (mode devis + signature draft/définitif QR + escrow).

### Process Complet - Publication → Exécution BTP

**10 phases avec swimlanes Client / Artisan / Système :**

**PHASE 0 - Publication (Client)**
- Création mission : titre, description, `mode_devis=true`, `max_revision_rounds` (1-10), `date_expiration`, localisation Bénin, plans joints
- Check **KYC v3 obligatoire** avant publier
- Statut `OFFRE_OUVERTE` → diffusion aux artisans matchant "Plomberie sanitaire"

**PHASE 1 - Candidature avec Devis (Artisan)**
- Soumission devis structuré : postes, quantités, PU, délais, jalons (pas forfait fixe)
- **Règle d'exclusivité** : `checkExclusivite(candidatId)` → 1 seule candidature active globale (`en_negociation`, `devis_valide`, `contrat_signe`, `escrow_bloque`, `en_realisation`) sinon bloqué
- Statut `en_negociation` `round_actuel=0`

**PHASE 2 - Étude & Présélection**
- Client compare devis, chat, peut rejeter → `annulee_definitive` scoped paire (offre,candidat)

**PHASE 3 - Négociation**
- Chaque révision `round_actuel++`
- Notif si `round = max-1` (dernier round)
- Si `round == max` sans accord → `annulee_definitive` terminale, artisan **libéré**, offre reste ouverte jusqu'à `date_expiration`
- Si accord bilatéral → 2x clic "Accepter version finale"

**PHASE 4 - Validation + Contrat Draft**
- `devis_valide`
- Génération auto **BROUILLON** : PDF avec watermark diagonal `BROUILLON - NON CONTRACTUEL`, sans signatures, sans QR, avec `genere_depuis_devis_id`, version 1

**PHASE 5 - Signature Bilatérale**
- `EN_ATTENTE_SIGNATURE` → emails
- Signature parallèle autorisée, pad + checkbox CGV + IP + timestamp + re-check KYC
- 1/2 → `PARTIELLEMENT_SIGNE` + notif
- 2/2 → trigger définitif

**PHASE 6 - Contrat Définitif + QR**
- Watermark supprimé, 2 signatures ajoutées, **QR Code** généré :
`{contractId, hash: SHA256(pdf), verifyUrl: flexwork.bj/verify/{id}}`
- Statut `SIGNE_DEFINITIF` + `contrat_signe`
- Vérif QR : vert "Authentique" / rouge "Altéré"

**PHASE 7 - Escrow FedaPay**
- Fonds bloqués **uniquement après 2/2 signatures** → nouveau statut Kanban **#10 `ESCROW_BLOQUE`** entre contrat signé et démarrage
- Artisan notifié "Fonds sécurisés"

**PHASE 8 - Exécution `en_realisation`**
- GPS check-in chantier, photos horodatées, suivi temps, validation jalons → déblocage partiel escrow

**PHASE 9 - Livraison & Clôture**
- Livraison + preuves finales → validation client → déblocage final → avis + archivage définitif avec QR vérifiable
