import React, { useEffect } from 'react';
import './App.css';
import { useAppContext } from './contexts/AppContext';
import GlobalAlert from './components/GlobalAlert.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import TransactionInfo from './components/TransactionInfo.jsx';
import ConfigDisplay from './components/ConfigDisplay.jsx';

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

  const handleSendTransaction = () => {
    if (!state.config || !state.config.privateKey || !state.config.endpoints) {
      dispatch({ type: 'SET_GLOBAL_ERROR', payload: { message: 'Configuration is missing or invalid. Please check src/config/appConfig.js.', type: 'config' } });
      return;
    }
    dispatch({ type: 'PROCESS_START' });
    console.log("Send Transaction Clicked. Config Loaded From:", state.config.loadedPath, "Config Data:", state.config);
    // Placeholder for actual transaction sending logic - to be built in later phases
    setTimeout(() => {
      dispatch({ type: 'SET_TX_INFO', payload: { signature: `SIM_TxSig_${Date.now()}`.slice(0,44) + '...', createdAt: Date.now() } });
      // Simulate some results based on loaded config
      if (state.config && state.config.endpoints) {
        state.config.endpoints.forEach(ep => {
          dispatch({ 
            type: 'UPDATE_ENDPOINT_RESULT', 
            payload: { 
              name: ep.name, 
              sendDuration: Math.floor(Math.random() * 100) + 20, //ms
              confirmationDuration: Math.floor(Math.random() * 1500) + 500, //ms
              status: 'Confirmed (Simulated)',
              error: null
            }
          });
        });
      } else {
         // Simulate one error if no endpoints
         dispatch({ 
            type: 'UPDATE_ENDPOINT_RESULT', 
            payload: { 
              name: "No Endpoints Configured", 
              error: { message: "No endpoints found in configuration."}
            }
          });
      }
      dispatch({ type: 'PROCESS_COMPLETE' });
    }, 2000);
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
