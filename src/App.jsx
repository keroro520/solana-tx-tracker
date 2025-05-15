import React, { useEffect, useRef } from 'react';
import './App.css';
import { Keypair, Connection } from '@solana/web3.js';
import { useAppContext } from './contexts/AppContext';
import GlobalAlert from './components/GlobalAlert.jsx';
import TransactionInfo from './components/TransactionInfo.jsx';
import ConfigDisplay from './components/ConfigDisplay.jsx';
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
    console.log("Loaded appConfig.js successfully.");
  } catch (e) {
      console.error("Failed to load appConfig.js as well:", e);
      throw new Error("Configuration file appConfig.js is missing or invalid.");
  }
  if (!configModule || !configModule.appConfig) {
    throw new Error(`The configuration file (${loadedConfigPath}) did not export an 'appConfig' object.`);
  }
  return { ...configModule.appConfig, loadedPath: loadedConfigPath };
}

function App() {
  const { state, dispatch } = useAppContext();
  const activeSubscriptions = useRef([]); // To keep track of active WS subscriptions for potential cleanup

  useEffect(() => {
    const loadInitialConfig = async () => {
      try {
        const configData = await loadAppConfiguration();
        dispatch({ type: 'LOAD_CONFIG_SUCCESS', payload: configData });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `CONSOLE.INFO: Config loaded: ${configData.loadedPath}` } });
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

  const handleSendTransaction = async () => {
    if (!state.config || !state.config.privateKey || !state.config.endpoints || state.config.endpoints.length === 0) {
      dispatch({ type: 'SET_GLOBAL_ERROR', payload: { message: 'Configuration is missing, invalid, or has no endpoints. Please check src/config/appConfig.js.', type: 'config' } });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Error: Configuration missing or invalid.' } });
      return;
    }
    dispatch({ type: 'PROCESS_START' });
    dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Processing started.' } });
    console.log("Send Transaction Clicked. Config Loaded From:", state.config.loadedPath);

    // Clear previous subscriptions
    activeSubscriptions.current.forEach(({ connection, subId }) => {
        if (connection && typeof connection.removeSignatureListener === 'function') {
            console.log("Clearing old subscription ID:", subId);
            connection.removeSignatureListener(subId);
        }
    });
    activeSubscriptions.current = [];

    let sourceKeypair;
    let initialConnection; // For creating the transaction
    let transactionSignatureB58;
    let txCreatedAt;
    let serializedTransaction;

    try {
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Parsing private key.' } });
      const secretKeyUint8Array = parsePrivateKey(state.config.privateKey);
      sourceKeypair = Keypair.fromSecretKey(secretKeyUint8Array);
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Creating initial RPC connection to ${state.config.endpoints[0].rpcUrl}.` } });
      initialConnection = new Connection(state.config.endpoints[0].rpcUrl, 'confirmed');
      
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Preparing to create and sign transaction.' } });
      const { transaction, signature, createdAt } = await createSimpleTransferTransaction(initialConnection, sourceKeypair);
      transactionSignatureB58 = signature;
      txCreatedAt = createdAt;
      serializedTransaction = transaction.serialize();
      
      dispatch({ type: 'SET_TX_INFO', payload: { signature: transactionSignatureB58, createdAt: txCreatedAt } });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Transaction created: ${transactionSignatureB58}.` } });
      dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'Transaction created. Sending & Subscribing...' });

      const overallSentAt = Date.now(); // Timestamp for all parallel operations start
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'Sending transaction to RPC endpoints and preparing WebSocket subscriptions.' } });

      const rpcPromises = state.config.endpoints.map(ep => {
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Creating RPC connection for ${ep.name} to ${ep.rpcUrl}.` } });
        const epConnection = new Connection(ep.rpcUrl, 'confirmed');
        dispatch({ 
            type: 'UPDATE_ENDPOINT_RESULT', 
            payload: { name: ep.name, status: 'Sending RPC... ' }
        });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Sending RPC to ${ep.name}...` } });
        return sendTransactionToRpc(epConnection, serializedTransaction, ep.name);
      });

      const rpcResults = await Promise.allSettled(rpcPromises);
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'RPC send process completed for all endpoints.' } });
      
      rpcResults.forEach(result => {
        if (result.status === 'fulfilled') {
          const { endpointName, sentAt, sendDuration, rpcSignatureOrError } = result.value;
          const message = rpcSignatureOrError instanceof Error ? `RPC Send Error for ${endpointName}: ${rpcSignatureOrError.message}` : `Transaction sent via RPC to ${endpointName}. RPC Signature: ${rpcSignatureOrError}. Awaiting WebSocket confirmation.`;
          dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message } });
          dispatch({ 
            type: 'UPDATE_ENDPOINT_RESULT', 
            payload: { 
              name: endpointName, 
              sentAt,
              sendDuration, 
              status: rpcSignatureOrError instanceof Error ? `RPC Error: ${rpcSignatureOrError.message}` : 'RPC Sent, Awaiting WS...',
              error: rpcSignatureOrError instanceof Error ? { message: rpcSignatureOrError.message } : null,
              rpcSignature: typeof rpcSignatureOrError === 'string' ? rpcSignatureOrError : null
            }
          });
        } else {
          // Should not happen often if sendTransactionToRpc catches its own errors
          console.error("Unhandled error in RPC send promise:", result.reason);
          dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Unhandled error in RPC send for an endpoint: ${result.reason}` } });
          // Dispatch an update for this endpoint if its name can be derived or use a general error
        }
      });

      dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'RPC sends complete. Awaiting WebSocket confirmations...' });
      dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: 'All RPC sends complete. Initiating WebSocket subscriptions.' } });

      let confirmedCount = 0;
      const totalEndpoints = state.config.endpoints.length;

      state.config.endpoints.forEach(ep => {
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Creating WebSocket connection for ${ep.name} to ${ep.wsUrl}.` } });
        const epConnection = new Connection(ep.rpcUrl, { wsEndpoint: ep.wsUrl, commitment: 'confirmed' });
        dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Sending WebSocket subscription request for signature ${transactionSignatureB58} to ${ep.name} (WS: ${ep.wsUrl}).` } });
        subscribeToSignatureConfirmation(
          epConnection,
          transactionSignatureB58,
          ep.name,
          overallSentAt,
          (confirmationResult) => {
            dispatch({ type: 'UPDATE_ENDPOINT_RESULT', payload: confirmationResult });
            let logMessage = `WebSocket message received from ${confirmationResult.name}: `;
            if (confirmationResult.error) {
              logMessage += `Error: ${confirmationResult.error.message}. Raw error: ${JSON.stringify(confirmationResult.rawError || confirmationResult.error)}`;
            } else {
              logMessage += `Confirmed. Slot: ${confirmationResult.confirmationContextSlot}. Duration from send: ${confirmationResult.wsDuration} ms. Raw data: ${JSON.stringify(confirmationResult.rawNotification || 'N/A')}`;
            }
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: logMessage } });
            if (!confirmationResult.error) {
              confirmedCount++;
            }
            if (confirmedCount === totalEndpoints || 
                state.results.filter(r => r.status && !r.status.includes("Pending")).length === totalEndpoints) { // Check if all have reported something
              dispatch({ type: 'PROCESS_COMPLETE' });
            }
          }
        )
        .then(subId => {
            activeSubscriptions.current.push({ connection: epConnection, subId });
        })
        .catch(subError => {
            console.error(`Failed to initiate subscription for ${ep.name}:`, subError);
            dispatch({ 
                type: 'UPDATE_ENDPOINT_RESULT', 
                payload: { 
                    name: ep.name, 
                    status: `WS Sub Error: ${subError.message}`,
                    error: { message: subError.message }
                }
            });
            dispatch({ type: 'LOG_EVENT', payload: { timestamp: Date.now(), message: `Failed to subscribe to WebSocket for ${ep.name}: ${subError.message}` } });
        });
      });

      // Note: PROCESS_COMPLETE is now dispatched within the WS callback logic
      // or after a timeout (to be implemented in Phase 6)

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
      
      {/* Pass the loadedPath to ConfigDisplay if available in state.config */}
      <ConfigDisplay 
        configStatus={state.configStatus} 
        configPath={state.config?.loadedPath || state.configPath} 
      />

      <div className="controls-area" style={{ marginBottom: '20px' }}>
        <button onClick={handleSendTransaction} disabled={state.isLoading || !state.config}>
          {state.isLoading ? 'Processing...' : 'Send Transaction'}
        </button>
        {state.isLoading && <span className="spinner"></span>}
      </div>

      <TransactionInfo signature={state.transactionSignature} createdAt={state.createdAt} />
      
      <EventLog events={state.eventLog} />
      
    </div>
  );
}

export default App;
