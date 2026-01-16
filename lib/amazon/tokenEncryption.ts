/**
 * Token Encryption Utilities
 * 
 * Encrypts and decrypts Amazon refresh tokens using AES-GCM.
 * Uses AMAZON_TOKEN_ENCRYPTION_KEY from environment (32-byte key, base64 encoded).
 * 
 * Server-side only - never expose to client.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Get encryption key from environment
 * Expects base64-encoded 32-byte key
 */
function getEncryptionKey(): Buffer {
  const keyBase64 = process.env.AMAZON_TOKEN_ENCRYPTION_KEY;
  
  if (!keyBase64) {
    throw new Error("AMAZON_TOKEN_ENCRYPTION_KEY environment variable is required");
  }

  try {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== KEY_LENGTH) {
      throw new Error(`AMAZON_TOKEN_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (base64 encoded)`);
    }
    return key;
  } catch (error) {
    throw new Error(`Invalid AMAZON_TOKEN_ENCRYPTION_KEY: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Encrypt a refresh token
 * 
 * @param token - Plain text refresh token
 * @returns Base64-encoded ciphertext (IV + encrypted data + auth tag)
 */
export function encryptToken(token: string): string {
  if (!token || token.trim().length === 0) {
    throw new Error("Token cannot be empty");
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from("amazon-refresh-token")); // Additional authenticated data
  
  let encrypted = cipher.update(token, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const tag = cipher.getAuthTag();
  
  // Combine IV + encrypted data + auth tag
  const combined = Buffer.concat([iv, encrypted, tag]);
  
  return combined.toString("base64");
}

/**
 * Decrypt a refresh token
 * 
 * @param ciphertext - Base64-encoded ciphertext (IV + encrypted data + auth tag)
 * @returns Plain text refresh token
 */
export function decryptToken(ciphertext: string): string {
  if (!ciphertext || ciphertext.trim().length === 0) {
    throw new Error("Ciphertext cannot be empty");
  }

  const key = getEncryptionKey();
  
  try {
    const combined = Buffer.from(ciphertext, "base64");
    
    if (combined.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error("Invalid ciphertext format");
    }
    
    // Extract IV, encrypted data, and auth tag
    const iv = combined.subarray(0, IV_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);
    const tag = combined.subarray(combined.length - TAG_LENGTH);
    
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from("amazon-refresh-token"));
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString("utf8");
  } catch (error) {
    throw new Error(`Token decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get last 4 characters of token for display
 */
export function getTokenLast4(token: string): string {
  if (!token || token.length < 4) {
    return "****";
  }
  return token.slice(-4);
}

