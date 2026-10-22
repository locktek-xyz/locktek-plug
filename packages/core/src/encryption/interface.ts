/** Pluggable encryption provider for securing private keys and mnemonics. */
export interface IEncryptionProvider {
  /** Encrypt plaintext and return a Base64-encoded ciphertext string. */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypt a Base64-encoded ciphertext string back to plaintext. */
  decrypt(ciphertext: string): Promise<string>;
}
