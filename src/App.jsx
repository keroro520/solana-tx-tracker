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
      let wsConfirmedCount = 0;
      const totalWsEndpoints = state.config.wsUrls.length;
      const wsSubscriptionOverallSentAt = Date.now(); // Timestamp for all WS subscription initiations

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
          wsConfig.name, // Pass the name of the WS endpoint
          wsSubscriptionOverallSentAt, // Pass the overall sent time for this batch of WS subscriptions
          (confirmationResult) => { // confirmationResult is { name, confirmedAt, confirmationContextSlot, wsDurationMs, error?, rawError?, rawNotification? }
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
            const currentEventTimestamp = confirmationResult.confirmedAt || Date.now(); // Use confirmedAt if available
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: currentEventTimestamp, message: logMessage } });

            if (!confirmationResult.error) {
              wsConfirmedCount++;
              if (!firstWsConfirmedRef.current) {
                dispatch({ type: 'SET_FIRST_WS_CONFIRMED_AT', payload: currentEventTimestamp });
                firstWsConfirmedRef.current = true;
              }
            }
            // Check if all WS endpoints have reported (either confirmed or error)
            // Need to check against state.wsConfirmationResults as it's updated by the dispatch
            const currentWsResults = state.wsConfirmationResults; // Might need to getState() if reducer is slow, but usually fine
            const allWsResultsIn = currentWsResults.filter(r => r.status && r.status !== 'Subscribing...').length === totalWsEndpoints;
            
            if (allWsResultsIn) { // If all WS responded or errored
                 // Check if RPCs also done before PROCESS_COMPLETE, or if WS is enough
                 // For now, assuming all WS results trigger completion of this phase of monitoring
                 // If RPCs are still pending, global status should reflect that.
                 // If all RPCs are also done (or errored out), then call PROCESS_COMPLETE
                const allRpcResultsIn = state.rpcSendResults.filter(r => r.status && r.status !== 'Sending...').length === state.config.rpcUrls.length;
                if (allRpcResultsIn) {
                    dispatch({ type: 'PROCESS_COMPLETE' });
                } else {
                    dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'WebSocket confirmations received. Awaiting remaining RPC send completions...' });
                }
            }
          }
        )
        .then(subId => {
            activeSubscriptions.current.push({ connection: wsConnection, subId });
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `WebSocket subscription successful for ${wsConfig.name}, Sub ID: ${subId}.` } });
            // Update status to 'Subscribed, Awaiting Confirmation'
            dispatch({
              type: 'UPDATE_WS_CONFIRMATION_RESULT',
              payload: { name: wsConfig.name, status: 'Subscribed, Awaiting Confirmation' }
            });
            return { wsName: wsConfig.name, subId, wsConnection };
        })
        .catch(subError => {
            console.error(`Failed to initiate subscription for ${wsConfig.name}:`, subError);
            dispatch({ 
                type: 'UPDATE_WS_CONFIRMATION_RESULT', 
                payload: { 
                    name: wsConfig.name,
                    url: wsConfig.url,
                    status: `WS Sub Error: ${subError.message}`,
                    error: { message: subError.message },
                    overallSentAtForDurCalc: wsSubscriptionOverallSentAt
                }
            });
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Failed to subscribe to WebSocket for ${wsConfig.name}: ${subError.message}` } });
            return { wsName: wsConfig.name, error: subError };
        });
      });

      const wsSubscriptionSetupResults = await Promise.allSettled(wsSubscriptionPromises);
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'WebSocket subscription setup process completed for all WS URLs.' } });
      wsSubscriptionSetupResults.forEach(res => {
        if(res.status === 'fulfilled' && res.value && res.value.error) {
            console.warn(`Subscription setup for ${res.value.wsName} had an error: ${res.value.error.message}`);
        }
      });

      // --- Stage 2: Send Transactions via RPC --- 
      dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'WebSocket subscriptions initiated. Sending transaction to RPCs...' });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'All WebSocket subscriptions initiated. Now sending transaction to RPC URLs.' } });

      const rpcOverallSentAt = Date.now(); // Timestamp for all parallel RPC operations start
      dispatch({ type: 'SET_TRANSACTION_SENT_AT', payload: rpcOverallSentAt }); // Marks when RPC sending starts

      const rpcPromises = state.config.rpcUrls.map(rpcConfig => {
        // Initialize result placeholder for this RPC endpoint
        dispatch({
          type: 'UPDATE_RPC_SEND_RESULT',
          payload: {
            name: rpcConfig.name,
            url: rpcConfig.url,
            status: 'Sending...',
            sentAt: rpcOverallSentAt // Tentative, will be updated by sendTransactionToRpc more accurately
          }
        });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Creating RPC connection for ${rpcConfig.name} to ${rpcConfig.url}.` } });
        const rpcConnection = new Connection(rpcConfig.url, 'confirmed');
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Sending RPC to ${rpcConfig.name}...` } });
        
        return sendTransactionToRpc(rpcConnection, serializedTransaction, rpcConfig.name /*, rpcOverallSentAt - if util needs it */);
      });

      const rpcSendResultsRaw = await Promise.allSettled(rpcPromises);
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'RPC send process completed for all RPC URLs.' } });
      
      rpcSendResultsRaw.forEach(result => {
        if (result.status === 'fulfilled') {
          // result.value should be { endpointName, sentAt, sendDuration, rpcSignatureOrError }
          const { endpointName, ...rpcResultData } = result.value; 
          dispatch({ 
            type: 'UPDATE_RPC_SEND_RESULT', 
            payload: { 
              name: endpointName, // This is the name from rpcConfig.name passed to sendTransactionToRpc
              ...rpcResultData, // contains sentAt, sendDuration, rpcSignatureOrError
              status: result.value.rpcSignatureOrError instanceof Error ? `RPC Error: ${result.value.rpcSignatureOrError.message}` : 'RPC Sent',
              // error field is implicitly set if rpcSignatureOrError is an Error
            }
          });
          const message = result.value.rpcSignatureOrError instanceof Error ? `RPC Send Error for ${endpointName}: ${result.value.rpcSignatureOrError.message}` : `Transaction sent via RPC to ${endpointName}. RPC Signature: ${result.value.rpcSignatureOrError}.`;
          dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message } });

        } else { // Promise was rejected
          // This case should ideally be handled inside sendTransactionToRpc returning an error object
          // For robustness, if it's not, log it.
          console.error("Unhandled error in RPC send promise:", result.reason);
          // We need a name to update the status. This scenario is tricky if sendTransactionToRpc itself throws before returning a name.
          // Assuming sendTransactionToRpc always resolves, even with errors.
           dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Critical unhandled error in RPC send for an endpoint: ${result.reason}` } });
        }
      });
      
      // After all RPCs sent, check if WS confirmations are also all in
      const allWsResultsIn = state.wsConfirmationResults.filter(r => r.status && r.status !== 'Subscribing...' && r.status !== 'Subscribed, Awaiting Confirmation').length === totalWsEndpoints;
      if (allWsResultsIn) {
        dispatch({ type: 'PROCESS_COMPLETE' });
      } else {
        dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'RPC sends complete. Awaiting remaining WebSocket confirmations...' });
      }

    } catch (error) {
      console.error("Error during transaction processing:", error);
      dispatch({ type: 'PROCESS_ERROR', payload: { message: error.message } });
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
