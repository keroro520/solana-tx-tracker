import React, { useEffect, useRef } from 'react';
import './App.css';
import { Keypair, Connection } from '@solana/web3.js';
import { useAppContext } from './contexts/AppContext';
import GlobalAlert from './components/GlobalAlert.jsx';
import TransactionInfo from './components/TransactionInfo.jsx';
import ConfigDisplay from './components/ConfigDisplay.jsx';
import TransactionTimingsTable from './components/TransactionTimingsTable.jsx';
import EventLog from './components/EventLog.jsx';
import { 
  parsePrivateKey, 
  createSimpleTransferTransaction, 
  sendTransactionToRpc,
  subscribeToSignatureConfirmation 
} from './utils/solanaUtils.js';

// Updated config loading logic
async function loadAppConfiguration() {
  let configModule;
  let configFileName;
  let loadedConfigPathForImport; // Path for dynamic import
  let network = 'devnet'; // Default network is devnet

  // Parse URL parameters
  const queryParams = new URLSearchParams(window.location.search);
  const networkParam = queryParams.get('network');

  if (networkParam === 'mainnet') {
    configFileName = 'mainnet.appConfig.js';
    network = 'mainnet'; // Set network to mainnet
  } else {
    // Default to devnet if 'network' is not 'mainnet' or not specified
    configFileName = 'devnet.appConfig.js';
    network = 'devnet'; // Explicitly set network to devnet
  }
  // Construct the path relative to the current file (App.jsx is in src/)
  loadedConfigPathForImport = `../config/${configFileName}`;

  try {
    // Attempt to load the configuration file
    // The /* @vite-ignore */ comment tells Vite to not try to resolve this dynamic import at build time.
    configModule = await import(/* @vite-ignore */ loadedConfigPathForImport);
  } catch (e) {
      console.error(`Failed to load ${configFileName}: `, e);
      // Use the import path in the error message for clarity on what was attempted
      throw new Error(`Configuration file ${configFileName} is missing or invalid (tried to load from ${loadedConfigPathForImport}).`);
  }
  if (!configModule || !configModule.appConfig) {
    // Use the import path here as well
    throw new Error(`The configuration file (${loadedConfigPathForImport}) did not export an 'appConfig' object.`);
  }

  const rawConfig = configModule.appConfig;

  // Validate new structure: rpc-urls and ws-urls
  if (!rawConfig['rpc-urls'] || !Array.isArray(rawConfig['rpc-urls'])) {
    throw new Error("Configuration is missing 'rpc-urls' array or it's not an array.");
  }
  if (!rawConfig['ws-urls'] || !Array.isArray(rawConfig['ws-urls'])) {
    throw new Error("Configuration is missing 'ws-urls' array or it's not an array.");
  }

  // Validate each entry in rpc-urls
  rawConfig['rpc-urls'].forEach((item, index) => {
    if (!item || typeof item.name !== 'string' || typeof item.url !== 'string') {
      throw new Error(`Invalid entry in 'rpc-urls' at index ${index}. Each entry must be an object with 'name' and 'url' strings.`);
    }
  });

  // Validate each entry in ws-urls
  rawConfig['ws-urls'].forEach((item, index) => {
    if (!item || typeof item.name !== 'string' || typeof item.url !== 'string') {
      throw new Error(`Invalid entry in 'ws-urls' at index ${index}. Each entry must be an object with 'name' and 'url' strings.`);
    }
  });
  
  // Return the rest of the config along with the validated rpcUrls and wsUrls
  // Rename for convention if desired, e.g., rpcUrls instead of rpc-urls
  const { 'rpc-urls': rpcUrls, 'ws-urls': wsUrls, ...restOfConfig } = rawConfig;

  return { 
    ...restOfConfig, 
    rpcUrls: rpcUrls,
    wsUrls: wsUrls,
    network: network, // Add network to the config
    loadedPath: `config/${configFileName}` // For display purposes, show relative to project root (e.g. config/devnet.appConfig.js)
  };
}

function App() {
  const { state, dispatch } = useAppContext();
  const activeSubscriptions = useRef([]); // To keep track of active WS subscriptions for potential cleanup
  const firstWsConfirmedRef = useRef(false); // To track if first WS confirmation has been recorded for the CURRENT transaction
  const localNumberOfTransactionsRef = useRef(state.numberOfTransactions); // For the input field

  useEffect(() => {
    localNumberOfTransactionsRef.current = state.numberOfTransactions;
  }, [state.numberOfTransactions]);

  useEffect(() => {
    const loadInitialConfig = async () => {
      try {
        const configData = await loadAppConfiguration();
        dispatch({ type: 'LOAD_CONFIG_SUCCESS', payload: configData });
      } catch (error) {
        dispatch({ type: 'LOAD_CONFIG_ERROR', payload: { message: error.message, path: 'N/A' } });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `CONSOLE.ERROR: Config load error: ${error.message}` } });
      }
    };
    loadInitialConfig();

    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleInfo = console.info;

    console.log = (...args) => {
      originalConsoleLog.apply(console, args);
      const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `${message}` } });
    };
    console.error = (...args) => {
      originalConsoleError.apply(console, args);
      const message = args.map(arg => typeof arg === 'string' ? arg : (arg instanceof Error ? arg.message : JSON.stringify(arg))).join(' ');
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `CONSOLE.ERROR: ${message}` } });
    };
    console.warn = (...args) => {
      originalConsoleWarn.apply(console, args);
      const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `CONSOLE.WARN: ${message}` } });
    };
    console.info = (...args) => {
      originalConsoleInfo.apply(console, args);
      const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `${message}` } });
    };

    return () => {
      activeSubscriptions.current.forEach(({ connection, subId }) => {
        if (connection && typeof connection.removeSignatureListener === 'function') {
          originalConsoleLog("Cleaning up App: Removing subscription ID:", subId);
          connection.removeSignatureListener(subId);
        }
      });
      activeSubscriptions.current = [];
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;
    };
  }, [dispatch]);

  const executeSingleTransaction = async (txIndex, totalTx) => {
    dispatch({ type: 'PROCESS_START_SINGLE_TX' });
    firstWsConfirmedRef.current = false; // Reset for this specific transaction execution

    activeSubscriptions.current.forEach(({ connection, subId }) => {
        if (connection && typeof connection.removeSignatureListener === 'function') {
            console.log(`(Tx ${txIndex + 1}) Clearing old subscription ID:`, subId);
            connection.removeSignatureListener(subId);
        }
    });
    activeSubscriptions.current = [];

    let sourceKeypair;
    let initialRpcConnection;
    let transactionSignatureB58;
    let txCreatedAt;
    let serializedTransaction;

    const creationRpcUrl = state.config.rpcUrls[0].url;

    try {
      const secretKeyUint8Array = parsePrivateKey(state.config.privateKey);
      sourceKeypair = Keypair.fromSecretKey(secretKeyUint8Array);
      
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Creating initial RPC connection to ${creationRpcUrl} for transaction creation.` } });
      initialRpcConnection = new Connection(creationRpcUrl, 'confirmed');
      
      const { transaction, signature, createdAt } = await createSimpleTransferTransaction(initialRpcConnection, sourceKeypair);
      transactionSignatureB58 = signature;
      txCreatedAt = createdAt;
      serializedTransaction = transaction.serialize();
      
      dispatch({ type: 'SET_TX_INFO', payload: { signature: transactionSignatureB58, createdAt: txCreatedAt } });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Transaction created: ${transactionSignatureB58}.` } });
      dispatch({ type: 'SET_GLOBAL_STATUS', payload: `Tx ${txIndex + 1}/${totalTx}: Created. Initiating communications...` });

      const overallStartTime = Date.now();
      dispatch({ type: 'SET_TRANSACTION_SENT_AT', payload: overallStartTime });

      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Initiating all WebSocket subscriptions concurrently.` } });
      const wsPromises = state.config.wsUrls.map(wsConfig => {
        dispatch({
          type: 'UPDATE_WS_CONFIRMATION_RESULT',
          payload: {
            name: wsConfig.name,
            url: wsConfig.url,
            status: 'Subscribing...',
            overallSentAtForDurCalc: overallStartTime,
          }
        });
        const wsConnection = new Connection(creationRpcUrl, { wsEndpoint: wsConfig.url, commitment: 'confirmed' });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Sending WebSocket subscription request to ${wsConfig.name}.` } });
        
        return subscribeToSignatureConfirmation(
          wsConnection,
          transactionSignatureB58,
          wsConfig.name,
          overallStartTime, 
          (confirmationResult) => {
            // Check if a WS confirmation for THIS transaction has already been processed.
            // state.isComplete refers to the current transaction's completion status.
            // firstWsConfirmedRef.current ensures only the first one through this block processes.
            if (firstWsConfirmedRef.current && state.isComplete) {
                console.log(`Tx ${txIndex + 1}/${totalTx}: WS Conf from ${confirmationResult.endpointName} (sig: ${transactionSignatureB58.substring(0,6)}...) received, but first confirmation already processed or tx marked complete. Ignoring.`);
                return;
            }

            dispatch({ type: 'UPDATE_WS_CONFIRMATION_RESULT', payload: confirmationResult });
            
            let logMessage = `Tx ${txIndex + 1}/${totalTx} - WebSocket message received from ${confirmationResult.endpointName} (sig: ${transactionSignatureB58.substring(0,6)}...): `;
            if (confirmationResult.error) {
              logMessage += `Error: ${confirmationResult.error.message}. Raw error: ${JSON.stringify(confirmationResult.rawError || confirmationResult.error)}`;
            } else {
              logMessage += `Confirmed. Slot: ${confirmationResult.slot}. BlockTime: ${confirmationResult.blockTime ? confirmationResult.blockTime : 'N/A'}. Raw data: ${JSON.stringify(confirmationResult.rawNotification || 'N/A')}`;
              if (confirmationResult.wsDurationMs) {
                logMessage += ` Duration from sub attempt: ${confirmationResult.wsDurationMs} ms.`;
              }
            }
            const currentEventTimestamp = confirmationResult.confirmedAt || Date.now();
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: currentEventTimestamp, message: logMessage } });

            if (!confirmationResult.error) {
              // This inner check is critical: only the very first confirmation should proceed.
              if (!firstWsConfirmedRef.current) {
                console.log(`Tx ${txIndex + 1}/${totalTx}: First WS confirmation from ${confirmationResult.endpointName} (sig: ${transactionSignatureB58.substring(0,6)}...). Completing this transaction.`);
                firstWsConfirmedRef.current = true; // Guard set: This is the one!
                dispatch({ 
                  type: 'SET_FIRST_WS_CONFIRMED_AT', 
                  payload: { 
                    timestamp: currentEventTimestamp, 
                    endpointName: confirmationResult.endpointName,
                    slot: confirmationResult.slot,
                    blockTime: confirmationResult.blockTime
                  }
                });
                dispatch({ type: 'SET_GLOBAL_STATUS', payload: `Tx ${txIndex + 1}/${totalTx}: Complete (First WS Confirmation via ${confirmationResult.endpointName})` });
                dispatch({ type: 'PROCESS_SINGLE_TX_COMPLETE' });

                console.log(`Tx ${txIndex + 1}/${totalTx}: Cleaning up all active WebSocket subscriptions after first confirmation (sig: ${transactionSignatureB58.substring(0,6)}...).`);
                activeSubscriptions.current.forEach(({ connection: subConn, subId, name: subName }) => {
                  if (subConn && typeof subConn.removeSignatureListener === 'function') {
                    console.log(`Tx ${txIndex + 1}/${totalTx}: Removing listener for ${subName}, Sub ID: ${subId}`);
                    subConn.removeSignatureListener(subId);
                  }
                });
                activeSubscriptions.current = []; 
                return; // IMPORTANT: Exit callback after processing the first confirmation.
              }
            } 
          }
        )
        .then(subIdObj => {
          if (subIdObj && !subIdObj.error && subIdObj.subId !== undefined) {
            activeSubscriptions.current.push({ connection: subIdObj.wsConnection, subId: subIdObj.subId, name: subIdObj.wsName });
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: WebSocket subscription request processed for ${subIdObj.wsName}, Sub ID: ${subIdObj.subId}.` } });
            if (!firstWsConfirmedRef.current) {
                dispatch({
                  type: 'UPDATE_WS_CONFIRMATION_RESULT',
                  payload: { name: subIdObj.wsName, status: 'Subscribed, Awaiting Confirmation' }
                });
            }
            return subIdObj;
          } 
          return subIdObj; 
        })
        .catch(subError => {
            console.error(`Tx ${txIndex + 1}/${totalTx}: Critical error setting up subscription promise for ${wsConfig.name}:`, subError);
            if (!firstWsConfirmedRef.current && !state.isComplete) { 
                dispatch({ 
                    type: 'UPDATE_WS_CONFIRMATION_RESULT', 
                    payload: { 
                        name: wsConfig.name, 
                        url: wsConfig.url,
                        status: `WS Sub Setup Error: ${subError.message}`,
                        error: { message: subError.message },
                        overallSentAtForDurCalc: overallStartTime
                    }
                });
            }
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Critical error subscribing to WebSocket for ${wsConfig.name}: ${subError.message}` } });
            return { wsName: wsConfig.name, error: subError };
        });
      });

      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Initiating all RPC sends concurrently.` } });
      state.config.rpcUrls.forEach(rpcConfig => {
        dispatch({
          type: 'UPDATE_RPC_SEND_RESULT',
          payload: {
            name: rpcConfig.name,
            url: rpcConfig.url,
            status: 'Sending...',
            sentAt: overallStartTime 
          }
        });
        const rpcConnection = new Connection(rpcConfig.url, 'confirmed');
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Sending RPC to ${rpcConfig.name}...` } });
        
        if (state.config.rpcUrls.indexOf(rpcConfig) === 0) {
            dispatch({ type: 'SET_TRANSACTION_SENT_AT', payload: { timestamp: overallStartTime, endpointName: rpcConfig.name } });
        }

        sendTransactionToRpc(rpcConnection, serializedTransaction, rpcConfig.name)
          .then(rpcResult => {
            // Handled by reducer
          })
          .catch(error => {
            console.error(`Tx ${txIndex + 1}/${totalTx}: Unhandled error from sendTransactionToRpc promise for ${rpcConfig.name}:`, error);
            if (!state.isComplete) { 
                dispatch({ 
                  type: 'UPDATE_RPC_SEND_RESULT', 
                  payload: { 
                    name: rpcConfig.name, 
                    url: rpcConfig.url, 
                    status: `RPC Critical Error: ${error.message}`,
                    error: { message: error.message }, 
                    sentAt: overallStartTime 
                  }
                });
            }
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Critical unhandled error in RPC send for ${rpcConfig.name}: ${error.message}` } });
          });
      });

      dispatch({ type: 'SET_GLOBAL_STATUS', payload: `Tx ${txIndex + 1}/${totalTx}: All RPC sends and WebSocket subscriptions initiated. Awaiting first WS confirmation...` });

      await Promise.allSettled(wsPromises).then((results) => {
        if (state.isLoading && !firstWsConfirmedRef.current && !state.isComplete) { 
          console.log(`Tx ${txIndex + 1}/${totalTx}: All WS subscription attempts settled. No single WS confirmed first. Completing this transaction (fallback) (sig: ${transactionSignatureB58.substring(0,6)}...).`);
          dispatch({ type: 'SET_GLOBAL_STATUS', payload: `Tx ${txIndex + 1}/${totalTx}: Complete (No immediate WS confirmation; check individual statuses).` });
          dispatch({ type: 'PROCESS_SINGLE_TX_COMPLETE' }); 
          
          console.log(`Tx ${txIndex + 1}/${totalTx}: Cleaning up any remaining WebSocket subscriptions (fallback) (sig: ${transactionSignatureB58.substring(0,6)}...).`);
          activeSubscriptions.current.forEach(({ connection: subConn, subId, name: subName }) => {
            if (subConn && typeof subConn.removeSignatureListener === 'function') {
              console.log(`Tx ${txIndex + 1}/${totalTx}: (Fallback Cleanup) Removing listener for ${subName}, Sub ID: ${subId}`);
              subConn.removeSignatureListener(subId);
            }
          });
          activeSubscriptions.current = [];
        }
      });

    } catch (error) {
      console.error(`Tx ${txIndex + 1}/${totalTx}: Error during transaction processing setup:`, error);
      if (state.isLoading && !state.isComplete) { 
        dispatch({ type: 'PROCESS_ERROR', payload: { message: error.message } });
      }
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Tx ${txIndex + 1}/${totalTx}: Critical error during transaction processing: ${error.message}` } });
      throw error;
    }
  };

  const handleSendTransaction = async () => {
    if (!state.config || 
        !state.config.privateKey || 
        !state.config.rpcUrls || state.config.rpcUrls.length === 0 ||
        !state.config.wsUrls || state.config.wsUrls.length === 0
    ) {
      dispatch({ type: 'SET_GLOBAL_ERROR', payload: { message: 'Configuration is missing, invalid, or has no RPC/WS URLs. Please check src/config/appConfig.js.', type: 'config' } });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Error: Configuration missing, invalid, or no RPC/WS URLs.' } });
      return;
    }

    const numTransactionsToRun = localNumberOfTransactionsRef.current;
    dispatch({ type: 'SET_NUMBER_OF_TRANSACTIONS', payload: numTransactionsToRun });
    dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Preparing to process ${numTransactionsToRun} transaction(s).` } });
    dispatch({ type: 'PROCESS_START_ALL' });

    let transactionsProcessed = 0; // Local transaction counter

    while (transactionsProcessed < numTransactionsToRun) {
      // Ensure we're using the right transaction index for UI purposes
      const currentTxIndex = transactionsProcessed;
      
      dispatch({ type: 'LOG_EVENT', payload: { 
        timestamp: Date.now(), 
        message: `Starting transaction ${currentTxIndex + 1}/${numTransactionsToRun} (local counter: ${transactionsProcessed + 1})` 
      }});
      
      try {
        // Wait for this transaction to complete, regardless of state updates
        await executeSingleTransaction(currentTxIndex, numTransactionsToRun);
        
        // Log completion of this specific transaction
        dispatch({ type: 'LOG_EVENT', payload: { 
          timestamp: Date.now(), 
          message: `Completed transaction ${currentTxIndex + 1}/${numTransactionsToRun}` 
        }});
        
        // Increment our local counter
        transactionsProcessed++;
        
        // Check if we've actually processed all transactions
        if (transactionsProcessed >= numTransactionsToRun) {
          console.log(`All ${numTransactionsToRun} transactions processed successfully.`);
          break;
        }
      } catch (error) {
        console.error(`Transaction ${currentTxIndex + 1}/${numTransactionsToRun}: Critical error: ${error.message}`);
        dispatch({ type: 'LOG_EVENT', payload: { 
          timestamp: Date.now(), 
          message: `Transaction ${currentTxIndex + 1}/${numTransactionsToRun} failed with error: ${error.message}` 
        }});
        
        // Instead of immediately stopping, ask if we should continue
        const shouldContinue = window.confirm(`Transaction ${currentTxIndex + 1} failed. Continue with remaining transactions?`);
        if (!shouldContinue) {
          dispatch({ type: 'LOG_EVENT', payload: { 
            timestamp: Date.now(), 
            message: `User chose to cancel remaining transactions after failure of transaction ${currentTxIndex + 1}/${numTransactionsToRun}` 
          }});
          break;
        }
        
        // If continuing, increment our counter to move to next transaction
        transactionsProcessed++;
      }

      // Only sleep between transactions if we have more to process
      if (transactionsProcessed < numTransactionsToRun) {
        dispatch({ type: 'LOG_EVENT', payload: { 
          timestamp: Date.now(), 
          message: `Waiting 2 seconds before processing next transaction...` 
        }});
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // If we've reached here, all requested transactions have been attempted
    if (!state.allProcessesComplete) {
      dispatch({ type: 'PROCESS_ALL_COMPLETE' });
    }
  };

  const handleNumberOfTransactionsChange = (e) => {
    const value = parseInt(e.target.value, 10);
    localNumberOfTransactionsRef.current = isNaN(value) ? 1 : Math.max(1, value); 
  };

  return (
    <div className="app-container">
      <header>
        <h1>Solana Transaction Status Tracker</h1>
      </header>
      
      <GlobalAlert error={state.globalError} onDismiss={() => dispatch({ type: 'CLEAR_GLOBAL_ERROR' })} />

      <div className="controls-area" style={{ marginBottom: '20px' }}>
        <label htmlFor="numTransactions" style={{ marginRight: '10px' }}>Number of Transactions:</label>
        <input 
          type="number" 
          id="numTransactions" 
          // Use defaultValue for uncontrolled component behavior if not dispatching onChange, 
          // or ensure value is updated from state if it becomes controlled.
          // For now, local ref drives it, committed on send.
          defaultValue={localNumberOfTransactionsRef.current} 
          onChange={handleNumberOfTransactionsChange} 
          min="1"
          disabled={state.isLoading} 
          style={{ marginRight: '20px', width: '60px' }}
        />
        <button onClick={handleSendTransaction} disabled={state.isLoading || !state.config}>
          {state.isLoading ? `Processing Tx ${state.currentTransactionIndex + 1} of ${state.numberOfTransactions}...` : 'Send Transaction(s)'}
        </button>
        {state.isLoading && <span className="spinner"></span>}
      </div>

      {state.allProcessesComplete && state.allTransactionResults.length > 0 && (
        <div className="reports-section" style={{ marginTop: '20px', borderTop: '1px solid #ccc', paddingTop: '20px' }}>
          <h2 style={{textAlign: 'center'}}>Transaction Reports ({state.allTransactionResults.length} Processed)</h2>
          <TransactionTimingsTable
            allTransactionsData={state.allTransactionResults} 
            network={state.config ? state.config.network : 'devnet'} // Pass network to component
          />
        </div>
      )}

      {/* {(state.isLoading || state.allProcessesComplete && state.allTransactionResults.length > 0) && (
        <TransactionInfo 
          signature={state.transactionSignature || (state.allTransactionResults.length > 0 ? state.allTransactionResults[state.allTransactionResults.length -1].signature : null) }
          createdAt={state.createdAt || (state.allTransactionResults.length > 0 ? state.allTransactionResults[state.allTransactionResults.length -1].createdAt : null)}
        />
      )} */}
      
      <EventLog events={state.eventLog} />
      
    </div>
  );
}

export default App;
