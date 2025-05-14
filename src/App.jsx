import React, { useEffect, useRef } from 'react';
import './App.css';
import { Keypair, Connection } from '@solana/web3.js';
import { useAppContext } from './contexts/AppContext';
import GlobalAlert from './components/GlobalAlert.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import TransactionInfo from './components/TransactionInfo.jsx';
import ConfigDisplay from './components/ConfigDisplay.jsx';
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
      } catch (error) {
        dispatch({ type: 'LOAD_CONFIG_ERROR', payload: { message: error.message, path: 'N/A' } });
      }
    };
    loadInitialConfig();

    // Cleanup subscriptions on component unmount
    return () => {
      activeSubscriptions.current.forEach(({ connection, subId }) => {
        if (connection && typeof connection.removeSignatureListener === 'function') {
          console.log("Cleaning up App: Removing subscription ID:", subId);
          connection.removeSignatureListener(subId);
        }
      });
      activeSubscriptions.current = [];
    };
  }, [dispatch]);

  const handleSendTransaction = async () => {
    if (!state.config || !state.config.privateKey || !state.config.endpoints || state.config.endpoints.length === 0) {
      dispatch({ type: 'SET_GLOBAL_ERROR', payload: { message: 'Configuration is missing, invalid, or has no endpoints. Please check src/config/appConfig.js.', type: 'config' } });
      return;
    }
    dispatch({ type: 'PROCESS_START' });
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
      const secretKeyUint8Array = parsePrivateKey(state.config.privateKey);
      sourceKeypair = Keypair.fromSecretKey(secretKeyUint8Array);
      initialConnection = new Connection(state.config.endpoints[0].rpcUrl, 'confirmed');

      const { transaction, signature, createdAt } = await createSimpleTransferTransaction(initialConnection, sourceKeypair);
      transactionSignatureB58 = signature;
      txCreatedAt = createdAt;
      serializedTransaction = transaction.serialize();
      
      dispatch({ type: 'SET_TX_INFO', payload: { signature: transactionSignatureB58, createdAt: txCreatedAt } });
      dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'Transaction created. Sending & Subscribing...' });

      const overallSentAt = Date.now(); // Timestamp for all parallel operations start

      const rpcPromises = state.config.endpoints.map(ep => {
        const epConnection = new Connection(ep.rpcUrl, 'confirmed');
        dispatch({ 
            type: 'UPDATE_ENDPOINT_RESULT', 
            payload: { name: ep.name, status: 'Sending RPC... ' }
        });
        return sendTransactionToRpc(epConnection, serializedTransaction, ep.name);
      });

      const rpcResults = await Promise.allSettled(rpcPromises);
      
      rpcResults.forEach(result => {
        if (result.status === 'fulfilled') {
          const { endpointName, sentAt, sendDuration, rpcSignatureOrError } = result.value;
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
          // Dispatch an update for this endpoint if its name can be derived or use a general error
        }
      });

      dispatch({ type: 'SET_GLOBAL_STATUS', payload: 'RPC sends complete. Awaiting WebSocket confirmations...' });

      let confirmedCount = 0;
      const totalEndpoints = state.config.endpoints.length;

      state.config.endpoints.forEach(ep => {
        const epConnection = new Connection(ep.rpcUrl, { wsEndpoint: ep.wsUrl, commitment: 'confirmed' });
        subscribeToSignatureConfirmation(
          epConnection,
          transactionSignatureB58,
          ep.name,
          overallSentAt,
          (confirmationResult) => {
            dispatch({ type: 'UPDATE_ENDPOINT_RESULT', payload: confirmationResult });
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
        });
      });

      // Note: PROCESS_COMPLETE is now dispatched within the WS callback logic
      // or after a timeout (to be implemented in Phase 6)

    } catch (error) {
      console.error("Error during transaction processing:", error);
      dispatch({ type: 'PROCESS_ERROR', payload: { message: error.message } });
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
        <p style={{ marginTop: '5px' }} className="status-text">
            <strong>Status:</strong> {state.globalStatus}
        </p>
      </div>

      <TransactionInfo signature={state.transactionSignature} createdAt={state.createdAt} />
      
      <ResultsTable results={state.results} />
      
    </div>
  );
}

export default App;
