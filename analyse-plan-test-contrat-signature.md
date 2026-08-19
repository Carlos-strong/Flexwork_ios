# Analyse du plan de test `Tests-Contrat-Signature-Qr.html` vs implémentation réelle

Date : 2026-08-18

## Résumé

Le plan de test décrit un workflow **« Brouillon PDF → Envoi signature → Signature client → Signature artisan → Définitif + QR »**
avec PDF, watermark, lien magique, dessin de signature sur canvas et page publique `/verify/{id}`.

Le code implémenté dans `c:\laragon\www\Flexwork` couvre le **même besoin métier** (contrat bilatéral
signé par deux parties, verrouillage, intégrité, QR vérifiable) mais avec une **architecture différente** :

- **Contrat** : `POST /api/missions/[id]/contract` → crée `PrestationContract` (`termsSnapshot` immuable + `currentHash` chaîné).
  Pas de PDF, pas de watermark, pas de notion `BROUILLON`/`DÉFINITIF` (statuts mission : `contrat_genere` → `contrat_signe`).
- **Signature** : certificats numériques RSA-2048 (clé privée chiffrée AES-256-GCM), signature RSA-SHA256
  (`src/lib/signature.ts`, `SignatureService`). Routes : `POST /api/signature/certificate`, `POST /api/signature/sign`, `POST /api/signature/verify`.
- **Verrouillage** : à 2 signatures → `lockContract()` recalcule et stocke le hash final, mission passe à `contrat_signe`.
- **QR** : composant `src/components/signature-qrcode.tsx` encode les données réelles de la signature
  (signatureId, fingerprint, signedDataHash) et vérifie via `POST /api/signature/verify` (authentifié, pas de page publique `/verify/{id}`).
- **Intégrité** : `checkIntegrity()` compare le hash recalculé au hash verrouillé ; piste d'audit chaînée `ContractAuditEntry`.

## Correspondance détaillée

| Cas du plan | Attendu (plan) | Implémenté | Verdict |
|---|---|---|---|
| S1-T1 | `generateDraft()` → PDF watermark BROUILLON, version, `brouillonPdfUrl` | `POST /api/missions/[id]/contract` → `termsSnapshot` + `currentHash`, statut `contrat_genere`. Pas de PDF/watermark | ❌ PDF non implémenté — équivalent contractuel présent |
| S1-T2 | Devis sans KYC → 403 KYC_REQUIRED | Aucun contrôle KYC dans la génération de contrat | ❌ Non implémenté |
| S1-T3 | Version incrémentée v1→v2 | Pas de version ; la régénération est bloquée par `contract_already_generated` (409) | ⚠️ Différent |
| S1-T4 | Métadonnées draft en DB | `termsSnapshot`, `currentHash`, statut mission `contrat_genere` | ✅ Équivalent |
| S2-T1 | Envoi emails 2 parties + statut EN_ATTENTE + notifs | Aucun envoi d'email de signature ni statut EN_ATTENTE | ❌ Non implémenté |
| S2-T2 | Lien magique `/sign/:token`, 401 si invalide | Pas de lien magique ; la signature se fait en session authentifiée | ❌ Non implémenté (approche session) |
| S2-T3 | Expiration 7j + relances J+3/J+6 | `acceptanceDeadlineDays=7` existe mais aucun cron de relance | ⚠️ Partiel |
| S3-T1 | Checkbox CGV non cochée → 422 | Checkbox de consentement dans l'UI (`contract/page.tsx`) mais pas de garde serveur | ⚠️ Partiel (UI seulement) |
| S3-T2 | Signature canvas vide → 422 | Pas de canvas ; signature = certificat + passphrase | ❌ Non applicable |
| S3-T3 | Enregistrer signature client 1/2 + notif artisan | `POST /api/signature/sign` → `clientSignedAt`, 1 signature, `isLocked:false` | ✅ Équivalent |
| S3-T4 | Re-signer déjà signé → 409 | `signContract` bloque si 2 signatures ; pas de garde « déjà signé par la même partie » | ⚠️ Partiel |
| S4-T1 | 2/2 → définitif + 2 signatures + IP loggées | `lockContract()` auto, 2 signatures, `signerIp` enregistré, mission `contrat_signe` | ✅ Équivalent |
| S4-T2 | KYC expiré → 403 avant transition finale | Aucun re-check KYC dans `signContract` | ❌ Non implémenté |
| S4-T3 | Ordre inversé autorisé | Signature parallèle : `clientSignedAt`/`providerSignedAt` indépendants | ✅ Implémenté |
| S5-T1 | PDF définitif + QR `{contractId, hash, url}` + version 2 | Pas de PDF ; `currentHash` stocké ; QR encode les données de signature | ⚠️ Partiel (pas de PDF) |
| S5-T2 | `sha256(pdf) === contract.hash` | `checkIntegrity()` + `lockContract()` comparent le hash recalculé au hash stocké | ✅ Équivalent |
| S5-T3 | `/verify/{id}` vert « Authentique » | `POST /api/signature/verify` (authentifié) → `signatureValid:true` | ⚠️ Équivalent (pas de page publique) |
| S5-T4 | Hash falsifié → rouge | `checkIntegrity()` → `TAMPER_DETECTED` si contenu modifié | ✅ Équivalent |
| S5-T5 | Draft sans QR vs définitif avec QR | QR présent après chaque signature (pas de notion draft/définitif PDF) | ⚠️ Différent |
| S5-T6 | Règles de téléchargement | Aucune génération/téléchargement PDF | ❌ Non implémenté |
| R1 | Ordre parallèle | ✅ (voir S4-T3) | ✅ |
| R2 | Expiration 7j + relances | ❌ | ❌ |
| R3 | Devis immutable après brouillon | Bloqué après contrat via `contract_already_generated` ; pas de verrou total du devis | ⚠️ Partiel |
| R4 | 1 octet modifié → hash mismatch | `checkIntegrity()` détecte l'altération | ✅ |

## Ce que couvre le script de test fourni

Le script `src/lib/contract-signature-workflow.test.ts` teste le **workflow réel implémenté**, de bout en bout :

1. Génération du contrat depuis une proposition acceptée (et rejet du doublon).
2. Génération de certificats RSA-2048 pour les deux parties (et rejet passphrase < 8).
3. Rejet d'une signature avec mauvaise passphrase.
4. Signature client (1/2) → contrat non verrouillé, statut `contrat_genere`.
5. Signature prestataire (2/2) → verrouillage auto, statut `contrat_signe`.
6. Rejet d'une 3ᵉ signature.
7. Vérification cryptographique des 2 signatures.
8. Égalité hash stocké == hash recalculé + intégrité.
9. Piste d'audit chaînée (CLIENT_SIGNED, PROVIDER_SIGNED, LOCKED).
10. Encodage QR depuis les données réelles.
11. Détection d'altération (tamper → intégrité invalide).

## Exécution

```bash
npx vitest run src/lib/contract-signature-workflow.test.ts
```

Résultat vérifié : **14 tests / 14 passent** (nécessite PostgreSQL local démarré).

## Bug découvert et corrigé pendant l'écriture du script

`src/app/api/missions/[id]/contract/route.ts` référençait `proposal.provider.profile` (singulier),
or le modèle `User` expose `profiles Profile[]` (multi-profils, migration 2026-08-06). La route
provoquait une `PrismaClientValidationError` en production. Corrigé :

- `include: { provider: { include: { profiles: { include: { declarations: true } } } } }`
- Accès aux déclarations via `proposal.provider.profiles.flatMap((p) => p.declarations)`.

## Points non couverts par le script (à décider plus tard)

- Génération PDF (draft/définitif), watermark, téléchargement → nécessite `pdf-lib` + nouveau service.
- Envoi d'emails de signature + lien magique `/sign/:token` + relances J+3/J+6.
- Re-check KYC au moment de la signature (S4-T2, S1-T2).
- Page publique `/verify/{id}` avec statut vert/rouge.
