import React, { createContext, useReducer, useContext } from 'react';

const AppContext = createContext();

const initialState = {
  config: null, // Will store the actual config object { privateKey, endpoints, loadedPath }
  configStatus: 'Loading configuration...', // User-facing status message
  // configPath is effectively replaced by state.config.loadedPath after successful load
  isLoading: false,
  globalStatus: 'Idle', // Overall status of the transaction process
  transactionSignature: null,
  createdAt: null,
  results: [], // Array of { name, sendDuration, confirmationDuration, status, error? }
  globalError: null, // { message: string, type: 'config' | 'critical' }
};

function appReducer(state, action) {
  switch (action.type) {
    case 'LOAD_CONFIG_SUCCESS':
      return { 
        ...state, 
        config: action.payload, // payload includes { ...actualConfig, loadedPath }
        configStatus: `Successfully loaded configuration from: ${action.payload.loadedPath}`,
        globalError: null // Clear any previous config errors
      };
    case 'LOAD_CONFIG_ERROR':
      return { 
        ...state, 
        config: null, // Ensure config is null on error
        configStatus: `Error loading configuration: ${action.payload.message}`,
        globalError: { message: `Config Error: ${action.payload.message}`, type: 'config' } 
      };
    case 'PROCESS_START':
      return { 
        ...state, 
        isLoading: true, 
        globalStatus: 'Initializing... Fetching blockhash... Creating transaction...', 
        transactionSignature: null, 
        createdAt: null, 
        results: [], // Clear previous results for the new process
        globalError: null // Clear previous process errors
      };
    case 'SET_TX_INFO':
      return { ...state, transactionSignature: action.payload.signature, createdAt: action.payload.createdAt, globalStatus: 'Transaction created. Sending to RPCs & Subscribing to WebSockets...' };
    case 'UPDATE_ENDPOINT_RESULT':
      // This is a simplified update; a real one might update or add
      const existingResultIndex = state.results.findIndex(r => r.name === action.payload.name);
      if (existingResultIndex > -1) {
        const updatedResults = [...state.results];
        updatedResults[existingResultIndex] = { ...updatedResults[existingResultIndex], ...action.payload };
        return { ...state, results: updatedResults };
      } else {
        return { ...state, results: [...state.results, action.payload] };
      }
    case 'PROCESS_COMPLETE':
      return { ...state, isLoading: false, globalStatus: 'Process Complete.' };
    case 'PROCESS_ERROR': // For errors during the main process after config load
      return { ...state, isLoading: false, globalStatus: `Error: ${action.payload.message}`, globalError: { message: action.payload.message, type: 'critical' } };
    case 'SET_GLOBAL_ERROR':
      return { ...state, globalError: { message: action.payload.message, type: action.payload.type || 'critical' } };
    case 'CLEAR_GLOBAL_ERROR':
      return { ...state, globalError: null };
    default:
      return state;
  }
}

export const AppProvider = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}; 