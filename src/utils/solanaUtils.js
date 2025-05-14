import { Keypair, Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Parses a private key string (either Base58 encoded or a JSON stringified byte array)
 * into a Uint8Array.
 * @param {string | number[]} privateKeyInput - The private key input.
 * @returns {Uint8Array} The secret key as a Uint8Array.
 * @throws {Error} If the private key format is invalid.
 */
export function parsePrivateKey(privateKeyInput) {
  if (typeof privateKeyInput === 'string') {
    try {
      // Try decoding as Base58 first
      return bs58.decode(privateKeyInput);
    } catch (e) {
      // If Base58 decoding fails, try parsing as a JSON stringified array
      try {
        const byteArray = JSON.parse(privateKeyInput);
        if (Array.isArray(byteArray) && byteArray.every(val => typeof val === 'number')) {
          return Uint8Array.from(byteArray);
        }
        throw new Error('Private key string is not a valid JSON byte array.');
      } catch (jsonError) {
        throw new Error('Invalid private key string format. Not Base58 or valid JSON byte array.');
      }
    }
  } else if (Array.isArray(privateKeyInput) && privateKeyInput.every(val => typeof val === 'number')) {
    // Directly use if it's already a number array (like from JSON parsing before stringification)
    return Uint8Array.from(privateKeyInput);
  }
  throw new Error('Invalid private key type. Expected string or array of numbers.');
}

/**
 * Creates and signs a simple Solana transfer transaction.
 * @param {Connection} connection - Solana Connection object.
 * @param {Keypair} sourceKeypair - The keypair of the source/feePayer account.
 * @returns {Promise<{transaction: Transaction, signature: string, createdAt: number}>}
 * @throws {Error} If any step in transaction creation or signing fails.
 */
export async function createSimpleTransferTransaction(connection, sourceKeypair) {
  if (!connection || !sourceKeypair) {
    throw new Error('Connection and sourceKeypair must be provided.');
  }

  const lamportsToSend = 100;
  const createdAt = Date.now();

  try {
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sourceKeypair.publicKey,
        toPubkey: sourceKeypair.publicKey, // Sending to self
        lamports: lamportsToSend,
      })
    );

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sourceKeypair.publicKey;

    // Sign the transaction
    transaction.sign(sourceKeypair);
    
    // The first signature is usually the fee payer's signature, which is what we need.
    // Note: `sendTransaction` with a raw transaction needs it to be fully signed.
    // `transaction.signature` property is populated by web3.js after the first signature, 
    // but it refers to the first signature in the `signatures` array.
    // For `sendRawTransaction`, you need the Buffer of the serialized tx.
    // For `sendTransaction` (which takes a Transaction object), it will serialize and sign internally if needed,
    // but it's best practice to sign it fully before passing if you have all signers.
    // Here, we only have one signer.

    const signature = bs58.encode(transaction.signature); // Get the first signature (which is ours)
    if (!signature) {
        throw new Error("Failed to sign transaction or transaction has no signature.")
    }


    console.log(`Transaction created. Signature: ${signature}, Created At: ${new Date(createdAt).toISOString()}`);

    return {
      transaction, // The fully signed Transaction object
      signature,     // The base58 encoded signature string
      createdAt      // Timestamp of creation
    };
  } catch (error) {
    console.error("Error creating transfer transaction:", error);
    throw new Error(`Failed to create transaction: ${error.message}`);
  }
} 