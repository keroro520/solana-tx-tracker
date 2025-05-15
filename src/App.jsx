import React, { useEffect, useRef } from 'react';
import './App.css';
import { Keypair, Connection } from '@solana/web3.js';
import { useAppContext } from './contexts/AppContext';
import GlobalAlert from './components/GlobalAlert.jsx';
import TransactionInfo from './components/TransactionInfo.jsx';
import ConfigDisplay from './components/ConfigDisplay.jsx';
import EventSummaryTable from './components/EventSummaryTable.jsx';
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
  let loadedConfigPath = 'src/config/appConfig.js'; // For display purposes
  try {
    // Attempt to load the user's actual config file
    configModule = await import('../config/appConfig.js');
  } catch (e) {
      console.error("Failed to load appConfig.js: ", e);
      throw new Error("Configuration file appConfig.js is missing or invalid.");
  }
  if (!configModule || !configModule.appConfig) {
    throw new Error(`The configuration file (${loadedConfigPath}) did not export an 'appConfig' object.`);
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
    loadedPath: loadedConfigPath 
  };
}

function App() {
  const { state, dispatch } = useAppContext();
  const activeSubscriptions = useRef([]); // To keep track of active WS subscriptions for potential cleanup
  const firstWsConfirmedRef = useRef(false); // To track if first WS confirmation has been recorded

  useEffect(() => {
    const loadInitialConfig = async () => {
      try {
        const configData = await loadAppConfiguration();
        dispatch({ type: 'LOAD_CONFIG_SUCCESS', payload: configData });
        // dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `CONSOLE.INFO: Config loaded: ${configData.loadedPath}` } });
      } catch (error) {
        dispatch({ type: 'LOAD_CONFIG_ERROR', payload: { message: error.message, path: 'N/A' } });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `CONSOLE.ERROR: Config load error: ${error.message}` } });
      }
    };
    loadInitialConfig();

    // Store original console methods
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleInfo = console.info;

    // Override console methods
    console.log = (...args) => {
      originalConsoleLog.apply(console, args);
      const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `CONSOLE.LOG: ${message}` } });
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
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `CONSOLE.INFO: ${message}` } });
    };

    // Cleanup subscriptions and restore console on component unmount
    return () => {
      activeSubscriptions.current.forEach(({ connection, subId }) => {
        if (connection && typeof connection.removeSignatureListener === 'function') {
          originalConsoleLog("Cleaning up App: Removing subscription ID:", subId); // Use original log for cleanup phase
          connection.removeSignatureListener(subId);
        }
      });
      activeSubscriptions.current = [];

      // Restore original console methods
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;
    };
  }, [dispatch]);

  useEffect(() => {
    // Reset ref when isLoading becomes false (either process completed or was never started and then a config load finishes)
    // This ensures that for the *next* transaction, we are ready to capture the first WS confirmation again.
    if (state.isLoading === false) {
        firstWsConfirmedRef.current = false;
    }
  }, [state.isLoading]);

  const handleSendTransaction = async () => {
    // Updated config validation
    if (!state.config || 
        !state.config.privateKey || 
        !state.config.rpcUrls || state.config.rpcUrls.length === 0 ||
        !state.config.wsUrls || state.config.wsUrls.length === 0
    ) {
      dispatch({ type: 'SET_GLOBAL_ERROR', payload: { message: 'Configuration is missing, invalid, or has no RPC/WS URLs. Please check src/config/appConfig.js.', type: 'config' } });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Error: Configuration missing, invalid, or no RPC/WS URLs.' } });
      return;
    }
    dispatch({ type: 'PROCESS_START' });
    firstWsConfirmedRef.current = false;
    dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Processing started.' } });
    console.log("Send Transaction Clicked. Config Loaded From:", state.config.loadedPath);

    activeSubscriptions.current.forEach(({ connection, subId }) => {
        if (connection && typeof connection.removeSignatureListener === 'function') {
            console.log("Clearing old subscription ID:", subId);
            connection.removeSignatureListener(subId);
        }
    });
    activeSubscriptions.current = [];

    let sourceKeypair;
    let initialRpcConnection; // For creating the transaction
    let transactionSignatureB58;
    let txCreatedAt;
    let serializedTransaction;

    // Determine the RPC URL for transaction creation (e.g., the first one)
    const creationRpcUrl = state.config.rpcUrls[0].url;

    try {
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Parsing private key.' } });
      const secretKeyUint8Array = parsePrivateKey(state.config.privateKey);
      sourceKeypair = Keypair.fromSecretKey(secretKeyUint8Array);
      
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Creating initial RPC connection to ${creationRpcUrl} for transaction creation.` } });
      initialRpcConnection = new Connection(creationRpcUrl, 'confirmed');
      
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Preparing to create and sign transaction.' } });
      const { transaction, signature, createdAt } = await createSimpleTransferTransaction(initialRpcConnection, sourceKeypair);
      transactionSignatureB58 = signature;
      txCreatedAt = createdAt;
      serializedTransaction = transaction.serialize();
      
      dispatch({ type: 'SET_TX_INFO', payload: { signature: transactionSignatureB58, createdAt: txCreatedAt } });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Transaction created: ${transactionSignatureB58}.` } });
      dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'Transaction created. Initiating WebSocket subscriptions...' });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Initiating WebSocket subscriptions.' } });

      // --- Stage 1: Setup WebSocket Subscriptions --- 
      const totalWsEndpoints = state.config.wsUrls.length;
      const wsSubscriptionOverallSentAt = Date.now();

      const wsSubscriptionPromises = state.config.wsUrls.map(wsConfig => {
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Creating WebSocket connection for ${wsConfig.name} to ${wsConfig.url}. RPC proxy: ${creationRpcUrl}` } });
        // Connection needs an RPC URL, but wsEndpoint overrides for actual WS connection. Use first RPC URL as a base.
        const wsConnection = new Connection(creationRpcUrl, { wsEndpoint: wsConfig.url, commitment: 'confirmed' });
        
        // Initialize result placeholder for this WS endpoint
        dispatch({
          type: 'UPDATE_WS_CONFIRMATION_RESULT',
          payload: {
            name: wsConfig.name,
            url: wsConfig.url,
            status: 'Subscribing...',
            overallSentAtForDurCalc: wsSubscriptionOverallSentAt, // For duration calc from this point
          }
        });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Sending WebSocket subscription request for signature ${transactionSignatureB58} to ${wsConfig.name}.` } });
        
        return subscribeToSignatureConfirmation(
          wsConnection,
          transactionSignatureB58,
          wsConfig.name,
          wsSubscriptionOverallSentAt,
          (confirmationResult) => {
            // If process is already complete by another WS, do nothing further
            if (firstWsConfirmedRef.current && state.isComplete) return;

            dispatch({ type: 'UPDATE_WS_CONFIRMATION_RESULT', payload: confirmationResult });
            
            let logMessage = `WebSocket message received from ${confirmationResult.name}: `;
            if (confirmationResult.error) {
              logMessage += `Error: ${confirmationResult.error.message}. Raw error: ${JSON.stringify(confirmationResult.rawError || confirmationResult.error)}`;
            } else {
              logMessage += `Confirmed. Slot: ${confirmationResult.confirmationContextSlot}. Raw data: ${JSON.stringify(confirmationResult.rawNotification || 'N/A')}`;
              if (confirmationResult.wsDurationMs) {
                logMessage += ` Duration from sub attempt: ${confirmationResult.wsDurationMs} ms.`;
              }
            }
            const currentEventTimestamp = confirmationResult.confirmedAt || Date.now();
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: currentEventTimestamp, message: logMessage } });

            if (!confirmationResult.error) {
              // FIRST successful confirmation completes the process
              if (!firstWsConfirmedRef.current) {
                console.log(`First WS confirmation from ${confirmationResult.name}. Completing process.`);
                firstWsConfirmedRef.current = true;
                dispatch({ type: 'SET_FIRST_WS_CONFIRMED_AT', payload: currentEventTimestamp });
                dispatch({ type: 'SET_GLOBAL_STATUS', payload: `Process Complete (First WS Confirmation via ${confirmationResult.name})` });
                dispatch({ type: 'PROCESS_COMPLETE' });

                // Clean up ALL active subscriptions
                console.log("Cleaning up all active WebSocket subscriptions after first confirmation.");
                activeSubscriptions.current.forEach(({ connection: subConn, subId }) => {
                  if (subConn && typeof subConn.removeSignatureListener === 'function') {
                    console.log(`Removing listener for Sub ID: ${subId}`);
                    subConn.removeSignatureListener(subId);
                  }
                });
                activeSubscriptions.current = []; 
                return; // Exit callback once process is complete
              }
            } 
            // If this specific WS errored, but others might still succeed or it was already completed
            // No explicit PROCESS_COMPLETE dispatch here for errors unless it's the very last one (handled after Promise.allSettled)
          }
        )
        .then(subIdObj => { // subIdObj is { wsName, subId, wsConnection } or { wsName, error }
          if (subIdObj && !subIdObj.error && subIdObj.subId !== undefined) {
            // Only add to activeSubscriptions if successfully subscribed
            activeSubscriptions.current.push({ connection: subIdObj.wsConnection, subId: subIdObj.subId, name: subIdObj.wsName });
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `WebSocket subscription request processed for ${subIdObj.wsName}, Sub ID: ${subIdObj.subId}.` } });
            dispatch({
              type: 'UPDATE_WS_CONFIRMATION_RESULT',
              payload: { name: subIdObj.wsName, status: 'Subscribed, Awaiting Confirmation' }
            });
            return subIdObj;
          } else if (subIdObj && subIdObj.error) {
            // Error already handled in .catch of subscribeToSignatureConfirmation wrapper, just return it
            return subIdObj;
          }
          return subIdObj; // Should include wsName
        })
        .catch(subError => {
            // This catch is for errors in subscribeToSignatureConfirmation promise itself or the .then block
            console.error(`Critical error setting up subscription promise for ${wsConfig.name}:`, subError);
            // Ensure a result is still dispatched so the overall completion logic can work
            dispatch({ 
                type: 'UPDATE_WS_CONFIRMATION_RESULT', 
                payload: { 
                    name: wsConfig.name, 
                    url: wsConfig.url,
                    status: `WS Sub Setup Error: ${subError.message}`,
                    error: { message: subError.message },
                    overallSentAtForDurCalc: wsSubscriptionOverallSentAt
                }
            });
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Critical error subscribing to WebSocket for ${wsConfig.name}: ${subError.message}` } });
            return { wsName: wsConfig.name, error: subError }; // Ensure wsName is part of the error object
        });
      });

      // Wait for all WS subscription *setups* to complete (or fail)
      const wsSubscriptionSetupResults = await Promise.allSettled(wsSubscriptionPromises);
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'All WebSocket subscription setup attempts have settled.' } });
      wsSubscriptionSetupResults.forEach(res => {
        if(res.status === 'fulfilled' && res.value && res.value.error && res.value.wsName) {
            console.warn(`Subscription setup for ${res.value.wsName} resulted in an error: ${res.value.error.message}`);
        } else if (res.status === 'rejected'){
            console.error("A WS subscription setup promise was rejected:", res.reason);
            // Potentially find which one if possible, or log generic error
        }
      });
      
      // If, after all WS setup attempts, no single WS has confirmed and completed the process:
      if (!firstWsConfirmedRef.current && state.isLoading) { // state.isLoading check prevents re-dispatch if already completed
        // This means all WS subscriptions have either errored during setup, or their callbacks haven't reported a success yet.
        // We declare the process complete here to unblock UI, results will show individual errors.
        console.log("No WebSocket confirmed successfully after all setup attempts. Completing process with available results.");
        dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'Process Complete (No immediate WS confirmation; check individual statuses).' });
        dispatch({ type: 'PROCESS_COMPLETE' });
        // Clean up any subscriptions that might still be lingering if they didn't error out but also didn't confirm fast enough.
        activeSubscriptions.current.forEach(({ connection: subConn, subId }) => {
          if (subConn && typeof subConn.removeSignatureListener === 'function') {
             subConn.removeSignatureListener(subId);
          }
        });
        activeSubscriptions.current = [];
      }

      // --- Stage 2: Send Transactions via RPC (Fire-and-Forget) --- 
      // Only proceed if the process hasn't been marked complete by a WS confirmation already
      if (!state.isComplete && !firstWsConfirmedRef.current) { 
        dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'Sending transaction to RPCs (concurrently with WS)...' });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Sending transaction to all RPC URLs (fire-and-forget).' } });

        const rpcOverallSentAt = Date.now(); 
        dispatch({ type: 'SET_TRANSACTION_SENT_AT', payload: rpcOverallSentAt });

        state.config.rpcUrls.forEach(rpcConfig => {
          dispatch({
            type: 'UPDATE_RPC_SEND_RESULT',
            payload: {
              name: rpcConfig.name,
              url: rpcConfig.url,
              status: 'Sending...',
              sentAt: rpcOverallSentAt 
            }
          });
          const rpcConnection = new Connection(rpcConfig.url, 'confirmed');
          dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Sending RPC to ${rpcConfig.name}...` } });
          
          // Fire-and-forget: Don't await the promise here
          sendTransactionToRpc(rpcConnection, serializedTransaction, rpcConfig.name)
            .then(rpcResult => {
              // sendTransactionToRpc is expected to dispatch UPDATE_RPC_SEND_RESULT internally.
              // This .then is just for any additional logging if needed, or can be removed if sendTransactionToRpc handles all its state updates.
              const message = rpcResult.rpcSignatureOrError instanceof Error ? `Async RPC Send Error for ${rpcResult.endpointName}: ${rpcResult.rpcSignatureOrError.message}` : `Async Transaction sent via RPC to ${rpcResult.endpointName}. RPC Signature: ${rpcResult.rpcSignatureOrError}.`;
              dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message } });
            })
            .catch(error => {
              // This catch is for unexpected errors from sendTransactionToRpc promise itself.
              // sendTransactionToRpc should ideally always resolve with a result object including errors.
              console.error(`Unhandled error from sendTransactionToRpc promise for ${rpcConfig.name}:`, error);
              dispatch({ 
                type: 'UPDATE_RPC_SEND_RESULT', 
                payload: { 
                  name: rpcConfig.name, 
                  url: rpcConfig.url, 
                  status: `RPC Critical Error: ${error.message}`,
                  error: { message: error.message }, 
                  sentAt: rpcOverallSentAt 
                }
              });
              dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Critical unhandled error in RPC send for ${rpcConfig.name}: ${error.message}` } });
            });
        });
        // No longer awaiting RPC results or setting status based on them here for PROCESS_COMPLETE
      } else if (firstWsConfirmedRef.current) {
        // If WS already confirmed, log that RPC sends are being skipped or managed in background.
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Process completed by WS confirmation. RPC sends are fire-and-forget or were already initiated.' } });
      }

    } catch (error) {
      console.error("Error during transaction processing setup:", error);
      if (!state.isComplete) { // Avoid double PROCESS_ERROR if WS completed it
        dispatch({ type: 'PROCESS_ERROR', payload: { message: error.message } });
      }
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Critical error during transaction processing: ${error.message}` } });
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Solana Transaction Status Tracker</h1>
      </header>
      
      <GlobalAlert error={state.globalError} onDismiss={() => dispatch({ type: 'CLEAR_GLOBAL_ERROR' })} />

      <div className="controls-area" style={{ marginBottom: '20px' }}>
        <button onClick={handleSendTransaction} disabled={state.isLoading || !state.config}>
          {state.isLoading ? 'Processing...' : 'Send Transaction'}
        </button>
        {state.isLoading && <span className="spinner"></span>}
      </div>

      <TransactionInfo signature={state.transactionSignature} createdAt={state.createdAt} />
      
      <EventLog events={state.eventLog} />
      
      {state.isComplete && (
        <div className="reports-section" style={{ marginTop: '20px', borderTop: '1px solid #ccc', paddingTop: '20px' }}>
          <h2 style={{textAlign: 'center'}}>Transaction Reports</h2>
          <TransactionTimingsTable
            createdAt={state.createdAt}
            sentAt={state.transactionSentAt}
            confirmedAt={state.firstWsConfirmedAt}
          />
          <EventSummaryTable
            events={state.eventLog}
            // Pass rpcUrls and wsUrls instead of endpointsConfig
            rpcUrlsConfig={state.config ? state.config.rpcUrls : []}
            wsUrlsConfig={state.config ? state.config.wsUrls : []}
          />
        </div>
      )}
    </div>
  );
}

export default App;
