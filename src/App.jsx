import React, { useEffect } from 'react';
import './App.css';
import { Keypair, Connection } from '@solana/web3.js';
import { useAppContext } from './contexts/AppContext';
import GlobalAlert from './components/GlobalAlert.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import TransactionInfo from './components/TransactionInfo.jsx';
import ConfigDisplay from './components/ConfigDisplay.jsx';
import { parsePrivateKey, createSimpleTransferTransaction } from './utils/solanaUtils.js';

// Updated config loading logic
async function loadAppConfiguration() {
  let configModule;
  let loadedConfigPath = 'src/config/appConfig.js'; // For display purposes
  try {
    // Attempt to load the user's actual config file
    configModule = await import('../config/appConfig.js');
    console.log("Loaded appConfig.js successfully.");
  } catch (e) {
    console.warn("appConfig.js not found or failed to load, falling back to appConfig.example.js. Error:", e.message);
    try {
      // Fallback to the example configuration if the actual one isn't found
      configModule = await import('../config/appConfig.example.js');
      loadedConfigPath = 'src/config/appConfig.example.js';
      console.log("Loaded appConfig.example.js as fallback.");
    } catch (exampleError) {
      console.error("Failed to load appConfig.example.js as well:", exampleError);
      throw new Error("Configuration files (appConfig.js and appConfig.example.js) are missing or invalid.");
    }
  }
  if (!configModule || !configModule.appConfig) {
    throw new Error(`The configuration file (${loadedConfigPath}) did not export an 'appConfig' object.`);
  }
  return { ...configModule.appConfig, loadedPath: loadedConfigPath };
}

function App() {
  const { state, dispatch } = useAppContext();

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
  }, [dispatch]);

  const handleSendTransaction = async () => {
    if (!state.config || !state.config.privateKey || !state.config.endpoints || state.config.endpoints.length === 0) {
      dispatch({ type: 'SET_GLOBAL_ERROR', payload: { message: 'Configuration is missing, invalid, or has no endpoints. Please check src/config/appConfig.js.', type: 'config' } });
      return;
    }
    dispatch({ type: 'PROCESS_START' });
    console.log("Send Transaction Clicked. Config Loaded From:", state.config.loadedPath);

    try {
      const secretKeyUint8Array = parsePrivateKey(state.config.privateKey);
      const sourceKeypair = Keypair.fromSecretKey(secretKeyUint8Array);
      
      // Use the first RPC endpoint for connection to create the transaction initially
      const connection = new Connection(state.config.endpoints[0].rpcUrl, 'confirmed');

      const { transaction, signature, createdAt } = await createSimpleTransferTransaction(connection, sourceKeypair);
      
      dispatch({ type: 'SET_TX_INFO', payload: { signature, createdAt } });
      console.log('Signed transaction:', transaction);
      console.log('Transaction signature:', signature);

      // TODO: Implement Phase 4 - Serialize transaction and send to ALL RPCs, Subscribe to ALL WebSockets
      // For now, continue with simulation for UI display
      if (state.config && state.config.endpoints) {
        state.config.endpoints.forEach(ep => {
          dispatch({ 
            type: 'UPDATE_ENDPOINT_RESULT', 
            payload: { 
              name: ep.name, 
              // Simulate some placeholder values, actual values will come from RPC/WS responses
              sendDuration: 'Pending...', 
              confirmationDuration: 'Pending...',
              status: 'Sending...',
              error: null
            }
          });
        });
      }
      // Simulate a delay for network operations before showing "completion"
      setTimeout(() => {
        // This part will be replaced by actual WebSocket confirmation logic
        if (state.config && state.config.endpoints) {
            state.config.endpoints.forEach(ep => {
              dispatch({ 
                type: 'UPDATE_ENDPOINT_RESULT', 
                payload: { 
                  name: ep.name, 
                  sendDuration: Math.floor(Math.random() * 100) + 20, //ms
                  confirmationDuration: Math.floor(Math.random() * 1500) + 500, //ms
                  status: 'Confirmed (Simulated)'
                }
              });
            });
        }
        dispatch({ type: 'PROCESS_COMPLETE' });
      }, 3000); // Increased delay to simulate async ops

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
        {state.isLoading && <span className="spinner" style={{ marginLeft: '10px' }}>⏳</span>}
        <p style={{ marginTop: '5px' }}><strong>Status:</strong> {state.globalStatus}</p>
      </div>

      <TransactionInfo signature={state.transactionSignature} createdAt={state.createdAt} />
      
      <ResultsTable results={state.results} />
      
    </div>
  );
}

export default App;
