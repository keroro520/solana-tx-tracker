import React, { createContext, useReducer, useContext } from 'react';

const AppContext = createContext();

const initialState = {
  config: null, // Will store { privateKey, rpcUrls, wsUrls, loadedPath, ...otherConfig }
  configStatus: 'Loading configuration...', // User-facing status message
  // configPath is effectively replaced by state.config.loadedPath after successful load
  isLoading: false,
  isComplete: false, // New: To track if the entire transaction process is complete for UI conditional rendering
  globalStatus: 'Idle', // Overall status of the transaction process
  transactionSignature: null,
  createdAt: null,
  transactionSentAt: null, // New: Timestamp when all RPCs are about to be sent
  firstWsConfirmedAt: null, // New: Timestamp of the first WS confirmation
  firstSentToEndpointName: null, // New: Name of the RPC endpoint that first sent the transaction
  firstConfirmedByEndpointName: null, // New: Name of the WS endpoint that first confirmed it
  rpcSendResults: [], // New: Array of { name, url, status, sendDuration, rpcSignatureOrError, sentAt }
  wsConfirmationResults: [], // New: Array of { name, url, status, confirmationContextSlot, wsDurationMs, error, overallSentAtForDurCalc, confirmedAt }
  globalError: null, // { message: string, type: 'config' | 'critical' }
  eventLog: [], // To store timestamped event messages
};

function appReducer(state, action) {
  switch (action.type) {
    case 'LOAD_CONFIG_SUCCESS':
      return { 
        ...state, 
        config: action.payload, 
        configStatus: `Successfully loaded configuration from: ${action.payload.loadedPath}`,
        globalError: null
      };
    case 'LOAD_CONFIG_ERROR':
      return { 
        ...state, 
        config: null,
        configStatus: `Error loading configuration: ${action.payload.message}`,
        globalError: { message: `Config Error: ${action.payload.message}`, type: 'config' } 
      };
    case 'PROCESS_START':
      return { 
        ...state, 
        isLoading: true, 
        isComplete: false,
        globalStatus: 'Initializing... Fetching blockhash... Creating transaction...', 
        transactionSignature: null, 
        createdAt: null, 
        transactionSentAt: null,
        firstWsConfirmedAt: null,
        firstSentToEndpointName: null, 
        firstConfirmedByEndpointName: null,
        rpcSendResults: [], // Clear previous RPC results
        wsConfirmationResults: [], // Clear previous WS results
        globalError: null
      };
    case 'SET_TX_INFO':
      return { ...state, transactionSignature: action.payload.signature, createdAt: action.payload.createdAt, globalStatus: 'Transaction created. Sending to RPCs & Subscribing to WebSockets...' };
    case 'SET_GLOBAL_STATUS':
      return { ...state, globalStatus: action.payload };
    
    case 'UPDATE_RPC_SEND_RESULT': {
      const { name } = action.payload; // name is the unique identifier for an RPC endpoint config
      const existingIndex = state.rpcSendResults.findIndex(r => r.name === name);
      let newRpcSendResults;
      if (existingIndex > -1) {
        newRpcSendResults = [...state.rpcSendResults];
        newRpcSendResults[existingIndex] = { ...newRpcSendResults[existingIndex], ...action.payload };
      } else {
        newRpcSendResults = [...state.rpcSendResults, action.payload];
      }
      return { ...state, rpcSendResults: newRpcSendResults };
    }

    case 'UPDATE_WS_CONFIRMATION_RESULT': {
      const { name } = action.payload; // name is the unique identifier for a WS endpoint config
      const existingIndex = state.wsConfirmationResults.findIndex(r => r.name === name);
      let newWsConfirmationResults;
      if (existingIndex > -1) {
        newWsConfirmationResults = [...state.wsConfirmationResults];
        newWsConfirmationResults[existingIndex] = { ...newWsConfirmationResults[existingIndex], ...action.payload };
      } else {
        newWsConfirmationResults = [...state.wsConfirmationResults, action.payload];
      }
      return { ...state, wsConfirmationResults: newWsConfirmationResults };
    }

    case 'PROCESS_COMPLETE':
      return { ...state, isLoading: false, globalStatus: 'Process Complete.', isComplete: true };
    case 'PROCESS_ERROR': // For errors during the main process after config load
      return { ...state, isLoading: false, globalStatus: `Error: ${action.payload.message}`, globalError: { message: action.payload.message, type: 'critical' }, isComplete: true }; // Also set isComplete true on error to show reports
    case 'SET_GLOBAL_ERROR':
      return { ...state, globalError: { message: action.payload.message, type: action.payload.type || 'critical' } };
    case 'CLEAR_GLOBAL_ERROR':
      return { ...state, globalError: null };
    case 'LOG_EVENT':
      return {
        ...state,
        eventLog: [...state.eventLog, { timestamp: action.payload.timestamp, message: action.payload.message }],
      };
    case 'SET_TRANSACTION_SENT_AT':
      return {
        ...state,
        transactionSentAt: action.payload.timestamp !== undefined ? action.payload.timestamp : action.payload,
        firstSentToEndpointName: action.payload.endpointName !== undefined ? action.payload.endpointName : state.firstSentToEndpointName,
      };
    case 'SET_FIRST_WS_CONFIRMED_AT':
      return {
        ...state,
        firstWsConfirmedAt: action.payload.timestamp,
        firstConfirmedByEndpointName: action.payload.endpointName,
      };
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