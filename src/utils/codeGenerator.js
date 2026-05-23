/**
 * Utilitaire de génération de codes de salle.
 * Codes courts (4 caractères) faciles à partager oralement.
 * On exclut les caractères ambigus (0/O, 1/I) pour éviter les confusions.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(length = 4) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Génère un code unique parmi un Set de codes déjà utilisés.
 * Retourne null après trop d'échecs (très improbable).
 */
function generateUniqueRoomCode(existingCodes, maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateRoomCode();
    if (!existingCodes.has(code)) return code;
  }
  // Fallback : ajoute un caractère pour augmenter l'espace
  return generateRoomCode(5);
}

module.exports = { generateRoomCode, generateUniqueRoomCode };
