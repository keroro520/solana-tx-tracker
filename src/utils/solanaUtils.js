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
      console.log(`Cleaning up subscription ${subId} for ${endpointName} (sig: ${transactionSignature.substring(0,6)}...)`);
      connection.removeSignatureListener(subId).catch(err => console.error(`Error removing listener for ${endpointName} (sig: ${transactionSignature.substring(0,6)}...):`, err));
      subId = null;
    }
  };

  return new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      cleanup();
      const error = new Error(`Timeout: No confirmation received from ${endpointName} for ${transactionSignature.substring(0,6)}... within ${timeoutMs / 1000}s.`);
      console.warn(error.message);
      onConfirmation({
        endpointName,
        wsSubscribedAt,
        overallSentAtForDurCalc: overallSentAt, // Pass through for timeout duration calculation
        error,
        status: 'Timeout' // Custom status for timeout
      });
      resolve({ wsConnection: connection, subId: null, wsName: endpointName, error }); 
    }, timeoutMs);

    try {
      subId = connection.onSignature(
        transactionSignature,
        async (notificationResult, context) => { // notificationResult is the SignatureResult, context contains the slot
          cleanup(); 
          const confirmedAt = Date.now();
          const wsDuration = confirmedAt - overallSentAt; // Duration from overall send to WS confirm signal
          
          // Log that WS confirmation signal was received
          console.log(`Tx ${transactionSignature.substring(0,6)}...: WS confirmation signal from ${endpointName}. WS Slot: ${context.slot}. Duration from send to WS signal: ${wsDuration}ms. Error in WS signal: ${JSON.stringify(notificationResult.err)}`);

          if (notificationResult.err) {
            // If the WS subscription itself reports an error for the signature
            onConfirmation({
              endpointName,
              confirmedAt,
              wsDuration,
              wsSubscribedAt,
              overallSentAtForDurCalc: overallSentAt,
              slot: context.slot, // Slot from WS context
              blockTime: null,
              error: new Error(typeof notificationResult.err === 'string' ? notificationResult.err : JSON.stringify(notificationResult.err)),
              rawNotification: notificationResult,
              rawError: notificationResult.err,
              status: 'WS Signature Error'
            });
            return; // Stop further processing
          }

          // If WS signal is successful, proceed to fetch full transaction details for blockTime and authoritative slot
          let fetchedSlot = null;
          let fetchedBlockTime = null;
          let getTransactionError = null;
          const maxRetries = 10;
          const retryDelay = 1000; // 1 second delay between retries

          try {
            console.log(`Tx ${transactionSignature.substring(0,6)}...: WS signal OK from ${endpointName}. Attempting getTransaction for more details.`);
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                const transactionDetails = await connection.getTransaction(transactionSignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
                
                if (transactionDetails && transactionDetails.slot) {
                  fetchedSlot = transactionDetails.slot;
                  fetchedBlockTime = transactionDetails.blockTime || null; // blockTime can be null
                  console.log(`Tx ${transactionSignature.substring(0,6)}...: getTransaction for ${endpointName} successful on attempt ${attempt}. RPC Slot: ${fetchedSlot}, BlockTime: ${fetchedBlockTime}`);
                  getTransactionError = null; // Clear any previous attempt error
                  break; // Exit loop on success
                } else {
                  console.warn(`Tx ${transactionSignature.substring(0,6)}...: getTransaction for ${endpointName} attempt ${attempt} did not return details or slot. Retrying if attempts < ${maxRetries}...`);
                  getTransactionError = new Error(`getTransaction returned null or no slot on attempt ${attempt}.`);
                }
              } catch (err) {
                console.error(`Tx ${transactionSignature.substring(0,6)}...: Error calling getTransaction for ${endpointName} on attempt ${attempt}:`, err);
                getTransactionError = err; // Store the last error
              }

              if (attempt < maxRetries) {
                console.log(`Tx ${transactionSignature.substring(0,6)}...: Waiting ${retryDelay}ms before next getTransaction attempt for ${endpointName}.`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
              } else if (attempt === maxRetries && getTransactionError) {
                 console.error(`Tx ${transactionSignature.substring(0,6)}...: All ${maxRetries} getTransaction attempts failed for ${endpointName}. Last error: ${getTransactionError.message}`);
              }
            }

            // If after retries, we still don't have a fetchedSlot from RPC, but we have a WS slot, use it as fallback.
            if (!fetchedSlot && context.slot) {
                console.warn(`Tx ${transactionSignature.substring(0,6)}...: getTransaction failed after retries for ${endpointName}. Falling back to WS slot ${context.slot}.`);
                fetchedSlot = context.slot;
                // Keep getTransactionError to indicate that RPC fetch ultimately failed, even if we use WS slot.
                if (!getTransactionError) { // If loop completed without success but no explicit error was caught (e.g. null responses)
                    getTransactionError = new Error('getTransaction failed after all retries, using WS slot as fallback.');
                }
            } else if (!fetchedSlot && !context.slot) {
                // This case should be rare if WS confirmed, but good to log
                console.error(`Tx ${transactionSignature.substring(0,6)}...: CRITICAL - getTransaction failed AND no context.slot from WS for ${endpointName}. Slot will be null.`);
            }

          } catch (err) {
            // This outer catch is for any unexpected error in the retry logic itself, though individual attempts are caught inside.
            console.error(`Tx ${transactionSignature.substring(0,6)}...: Critical error in getTransaction retry logic for ${endpointName}:`, err);
            getTransactionError = err;
            if (!fetchedSlot && context.slot) fetchedSlot = context.slot; // Fallback to WS slot on critical error too
          }

          // Final values before calling onConfirmation
          console.log(`Tx ${transactionSignature.substring(0,6)}... FINALIZING for ${endpointName}: 
            Fetched Slot: ${fetchedSlot}, 
            Fetched BlockTime: ${fetchedBlockTime}, 
            WS Context Slot: ${context.slot}, 
            GetTransactionError: ${getTransactionError ? getTransactionError.message : null}, 
            WS Notification Error: ${notificationResult.err ? JSON.stringify(notificationResult.err) : null}`);

          onConfirmation({
            endpointName,
            confirmedAt, // Timestamp of WS confirmation signal
            wsDuration,    // Duration from initial send to WS signal
            wsSubscribedAt,
            overallSentAtForDurCalc: overallSentAt,
            slot: fetchedSlot, // Authoritative slot from getTransaction, or fallback to WS context.slot
            blockTime: fetchedBlockTime, // blockTime from getTransaction
            error: getTransactionError, // Prefer getTransaction error if it occurred
            rawNotification: notificationResult, // Original WS notification
            rawError: getTransactionError || notificationResult.err, // Capture any error
            status: getTransactionError ? 'RPC GetTransaction Error' : 'Confirmed'
          });
        },
        'confirmed' // Subscribe to 'confirmed' commitment level for the signature status
      );
      resolve({ wsConnection: connection, subId, wsName: endpointName }); 
    } catch (error) {
      cleanup();
      console.error(`Error subscribing to signature on ${endpointName} (sig: ${transactionSignature.substring(0,6)}...): ${error.message}`);
      onConfirmation({
        endpointName,
        wsSubscribedAt,
        overallSentAtForDurCalc: overallSentAt,
        error,
        status: 'WS Subscription Setup Error'
      });
      reject(error); 
    }
  });
} 
