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
    // Initial Validations and Setup (dispatch PROCESS_START, clear old subs, parse key)
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

    // Clear previous subscriptions (important if user clicks again before full cleanup)
    activeSubscriptions.current.forEach(({ connection, subId }) => {
        if (connection && typeof connection.removeSignatureListener === 'function') {
            console.log("(Re-run) Clearing old subscription ID:", subId);
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
      dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'Transaction created. Initiating communications...' });

      const overallStartTime = Date.now();
      dispatch({ type: 'SET_TRANSACTION_SENT_AT', payload: overallStartTime }); // General start for activities

      // --- Initiate ALL WebSocket Subscriptions Concurrently ---
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Initiating all WebSocket subscriptions concurrently.' } });
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
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Sending WebSocket subscription request for signature ${transactionSignatureB58} to ${wsConfig.name}.` } });
        
        return subscribeToSignatureConfirmation(
          wsConnection,
          transactionSignatureB58,
          wsConfig.name,
          overallStartTime, 
          (confirmationResult) => {
            if (firstWsConfirmedRef.current && state.isComplete) {
                console.log(`WS Conf from ${confirmationResult.name} received, but process already marked complete. Ignoring.`);
                return;
            }

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
              if (!firstWsConfirmedRef.current) {
                console.log(`First WS confirmation from ${confirmationResult.name}. Completing process.`);
                firstWsConfirmedRef.current = true;
                dispatch({ type: 'SET_FIRST_WS_CONFIRMED_AT', payload: currentEventTimestamp });
                dispatch({ type: 'SET_GLOBAL_STATUS', payload: `Process Complete (First WS Confirmation via ${confirmationResult.name})` });
                dispatch({ type: 'PROCESS_COMPLETE' });

                console.log("Cleaning up all active WebSocket subscriptions after first confirmation.");
                activeSubscriptions.current.forEach(({ connection: subConn, subId, name: subName }) => {
                  if (subConn && typeof subConn.removeSignatureListener === 'function') {
                    console.log(`Removing listener for ${subName}, Sub ID: ${subId}`);
                    subConn.removeSignatureListener(subId);
                  }
                });
                activeSubscriptions.current = []; 
                return;
              }
            } 
          }
        )
        .then(subIdObj => {
          if (subIdObj && !subIdObj.error && subIdObj.subId !== undefined) {
            activeSubscriptions.current.push({ connection: subIdObj.wsConnection, subId: subIdObj.subId, name: subIdObj.wsName });
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `WebSocket subscription request processed for ${subIdObj.wsName}, Sub ID: ${subIdObj.subId}.` } });
            // Update status only if not already completed by another faster WS
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
            console.error(`Critical error setting up subscription promise for ${wsConfig.name}:`, subError);
            if (!firstWsConfirmedRef.current || !state.isComplete) { // Avoid updating if already completed
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
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Critical error subscribing to WebSocket for ${wsConfig.name}: ${subError.message}` } });
            return { wsName: wsConfig.name, error: subError };
        });
      });

      // --- Initiate ALL RPC Sends Concurrently (Fire-and-Forget style for each) ---
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Initiating all RPC sends concurrently.' } });
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
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Sending RPC to ${rpcConfig.name}...` } });
        
        sendTransactionToRpc(rpcConnection, serializedTransaction, rpcConfig.name)
          .then(rpcResult => {
            // sendTransactionToRpc should dispatch its own UPDATE_RPC_SEND_RESULT upon completion.
            // This .then is for any additional logging or actions if necessary.
            const message = rpcResult.rpcSignatureOrError instanceof Error ? `Async RPC Send for ${rpcResult.endpointName} completed with error: ${rpcResult.rpcSignatureOrError.message}` : `Async RPC Send to ${rpcResult.endpointName} completed. Signature: ${rpcResult.rpcSignatureOrError}.`;
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message } });
          })
          .catch(error => {
            console.error(`Unhandled error from sendTransactionToRpc promise for ${rpcConfig.name}:`, error);
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
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Critical unhandled error in RPC send for ${rpcConfig.name}: ${error.message}` } });
          });
      });

      dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'All RPC sends and WebSocket subscriptions initiated. Awaiting first WS confirmation...' });

      // --- Fallback Completion Logic: After all WS Setups Attempted ---
      Promise.allSettled(wsPromises).then(() => {
        // Check if state.isLoading is true to prevent this from running if already completed by a fast WS confirm.
        // Also check firstWsConfirmedRef again, as it might have just been set by a WS callback.
        if (state.isLoading && !firstWsConfirmedRef.current) { 
          console.log("All WS subscription attempts settled. No single WS confirmed first during setup phase. Completing process.");
          dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'Process Complete (No immediate WS confirmation; check individual statuses).' });
          dispatch({ type: 'PROCESS_COMPLETE' });
          
          console.log("Cleaning up any remaining WebSocket subscriptions (fallback).");
          activeSubscriptions.current.forEach(({ connection: subConn, subId, name: subName }) => {
            if (subConn && typeof subConn.removeSignatureListener === 'function') {
              console.log(`(Fallback Cleanup) Removing listener for ${subName}, Sub ID: ${subId}`);
              subConn.removeSignatureListener(subId);
            }
          });
          activeSubscriptions.current = [];
        }
      });

    } catch (error) {
      console.error("Error during transaction processing setup:", error);
      // Avoid double PROCESS_ERROR if already completed by a WS or fallback.
      if (state.isLoading && !state.isComplete) { 
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
