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

/**
 * Sends a serialized transaction to a given RPC endpoint.
 * @param {Connection} connection - Solana Connection object for the specific endpoint.
 * @param {Buffer} serializedTransaction - The serialized transaction.
 * @param {string} endpointName - Name of the endpoint for logging/reporting.
 * @returns {Promise<{sentAt: number, sendDuration: number, rpcSignatureOrError: string | Error}>}
 */
export async function sendTransactionToRpc(connection, serializedTransaction, endpointName) {
  const sentAt = Date.now();
  let sendDuration;
  let rpcSignatureOrError;

  try {
    const signature = await connection.sendRawTransaction(
      serializedTransaction,
      {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
        maxRetries: 0,
      }
    );
    sendDuration = Date.now() - sentAt;
    rpcSignatureOrError = signature;
    console.log(`Successfully sent to ${endpointName}. Duration: ${sendDuration}ms`);
  } catch (error) {
    sendDuration = Date.now() - sentAt;
    rpcSignatureOrError = error;
    console.error(`Error sending to ${endpointName}: ${error.message}, Duration: ${sendDuration}ms`);
  }
  return { endpointName, sentAt, sendDuration, rpcSignatureOrError };
}

/**
 * Subscribes to a transaction signature for confirmation on a given WebSocket endpoint.
 * @param {Connection} connection - Solana Connection object for the specific endpoint.
 * @param {string} transactionSignature - The base58 encoded transaction signature to subscribe to.
 * @param {string} endpointName - Name of the endpoint for logging/reporting.
 * @param {number} overallSentAt - Timestamp when the transaction was initially sent (for duration calculation).
 * @param {function} onConfirmation - Callback function when confirmation is received or error occurs.
 *                                    Called with ({ endpointName, confirmedAt, wsDuration, error? }).
 * @param {number} timeoutMs - Optional timeout in milliseconds for the subscription (default 30 seconds).
 * @returns {Promise<number>} A promise that resolves with the subscription ID, or rejects on immediate error.
 */
export async function subscribeToSignatureConfirmation(
  connection, 
  transactionSignature, 
  endpointName, 
  overallSentAt, 
  onConfirmation,
  timeoutMs = 100000 // Default timeout 30 seconds
) {
  const wsSubscribedAt = Date.now();
  // console.log(`Subscribing to signature ${transactionSignature} on ${endpointName}}`);
  
  let timeoutId = null;
  let subId = null; // To store the subscription ID for cleanup

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (subId && connection && typeof connection.removeSignatureListener === 'function') {
      console.log(`Cleaning up subscription ${subId} for ${endpointName}`);
      connection.removeSignatureListener(subId).catch(err => console.error(`Error removing listener for ${endpointName}:`, err));
      subId = null;
    }
  };

  return new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      cleanup();
      const error = new Error(`Timeout: No confirmation received from ${endpointName} for ${transactionSignature} within ${timeoutMs / 1000}s.`);
      console.warn(error.message);
      onConfirmation({
        endpointName,
        wsSubscribedAt,
        error,
        status: 'Timeout' // Custom status for timeout
      });
      // Resolve rather than reject, as the Promise is for subscription setup, not the confirmation itself.
      // The onConfirmation callback handles the outcome.
      resolve(null); // Indicate timeout to the caller if needed, or simply rely on onConfirmation.
    }, timeoutMs);

    try {
      subId = connection.onSignature(
        transactionSignature,
        (notification, context) => {
          cleanup(); // Clear timeout and remove listener once notification (success or error) is received
          const confirmedAt = Date.now();
          const wsDuration = confirmedAt - overallSentAt;
          console.log(`Confirmation event from ${endpointName}. Slot: ${context.slot}, Duration from send: ${wsDuration}ms`, notification);
          onConfirmation({
            endpointName,
            confirmedAt,
            wsDuration,
            wsSubscribedAt,
            confirmationContextSlot: context.slot,
            error: notification.err ? new Error(JSON.stringify(notification.err)) : null,
            status: notification.err ? 'WS Error' : 'Confirmed'
          });
        },
        'confirmed'
      );
      // Store the subId for potential cleanup by the caller if the promise itself is part of a race or early exit
      resolve(subId); 
    } catch (error) {
      cleanup();
      console.error(`Error subscribing to signature on ${endpointName}: ${error.message}`);
      onConfirmation({
        endpointName,
        wsSubscribedAt,
        error,
        status: 'WS Subscription Error'
      });
      reject(error); // Reject on immediate subscription setup error
    }
  });
} 
