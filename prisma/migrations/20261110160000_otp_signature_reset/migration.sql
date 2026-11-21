-- Réinitialisation de la passphrase de signature (nouveau certificat) protégée par code OTP.
ALTER TYPE "OtpPurpose" ADD VALUE 'signature_reset';
