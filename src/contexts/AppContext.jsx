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

  // --- New state for multiple transactions ---
  numberOfTransactions: 1,
  currentTransactionIndex: 0,
  allTransactionResults: [], // Stores results for each transaction: { signature, createdAt, sentAt, firstWsConfirmedAt, rpcResults, wsResults, eventLogSliceStart, eventLogSliceEnd }
  allProcessesComplete: false, // True when all 'n' transactions are done
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
    case 'SET_NUMBER_OF_TRANSACTIONS':
      return {
        ...state,
        numberOfTransactions: Math.max(1, parseInt(action.payload, 10) || 1), // Ensure it's at least 1
      };
    case 'PROCESS_START_ALL': // Renamed from PROCESS_START to signify start of all N transactions
      return { 
        ...state, 
        isLoading: true, 
        isComplete: false, // Individual transaction complete
        allProcessesComplete: false, // All N transactions complete
        currentTransactionIndex: 0,
        allTransactionResults: [],
        // Reset states for the first transaction
        globalStatus: `Starting Transaction 1 of ${state.numberOfTransactions}... Initializing...`, 
        transactionSignature: null, 
        createdAt: null, 
        transactionSentAt: null,
        firstWsConfirmedAt: null,
        firstSentToEndpointName: null, 
        firstConfirmedByEndpointName: null,
        rpcSendResults: [], 
        wsConfirmationResults: [], 
        globalError: null,
        // eventLog: [], // Optionally clear global event log or manage slices per transaction
      };
    case 'PROCESS_START_SINGLE_TX': // New action to reset state for each new transaction in the loop
      return {
        ...state,
        isLoading: true, // Still loading overall
        isComplete: false, // This specific transaction is not complete
        globalStatus: `Starting Transaction ${state.currentTransactionIndex + 1} of ${state.numberOfTransactions}... Initializing...`,
        transactionSignature: null,
        createdAt: null,
        transactionSentAt: null,
        firstWsConfirmedAt: null,
        firstSentToEndpointName: null,
        firstConfirmedByEndpointName: null,
        rpcSendResults: [],
        wsConfirmationResults: [],
        globalError: null, // Clear errors from previous transaction in the series
      };
    case 'SET_TX_INFO':
      return { ...state, transactionSignature: action.payload.signature, createdAt: action.payload.createdAt, globalStatus: `Tx ${state.currentTransactionIndex + 1}/${state.numberOfTransactions}: Created. Sending/Subscribing...` };
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

    case 'PROCESS_SINGLE_TX_COMPLETE': { // Renamed from PROCESS_COMPLETE
      const newResult = {
        signature: state.transactionSignature,
        createdAt: state.createdAt,
        sentAt: state.transactionSentAt,
        firstSentToEndpointName: state.firstSentToEndpointName,
        firstWsConfirmedAt: state.firstWsConfirmedAt,
        firstConfirmedByEndpointName: state.firstConfirmedByEndpointName,
        rpcSendResults: [...state.rpcSendResults],
        wsConfirmationResults: [...state.wsConfirmationResults],
        error: null, // Explicitly set error to null for successful completion
      };
      const updatedAllTransactionResults = [...state.allTransactionResults, newResult];

      if (state.currentTransactionIndex < state.numberOfTransactions - 1) {
        return {
          ...state,
          // isLoading: true, // Stays true as we move to the next
          isComplete: true, // Current transaction is complete
          allTransactionResults: updatedAllTransactionResults,
          currentTransactionIndex: state.currentTransactionIndex + 1,
          globalStatus: `Tx ${state.currentTransactionIndex + 1}/${state.numberOfTransactions} complete. Preparing next...`,
          // State for next transaction will be reset by 'PROCESS_START_SINGLE_TX'
        };
      } else {
        // All transactions are complete
        return {
          ...state,
          isLoading: false,
          isComplete: true, // Marks the current (last) tx as complete
          allProcessesComplete: true, // Marks all N tx as complete
          allTransactionResults: updatedAllTransactionResults,
          globalStatus: `All ${state.numberOfTransactions} transactions complete.`,
        };
      }
    }
    case 'PROCESS_ERROR': // For errors during the main process after config load
      const sigToFind = state.transactionSignature;
      const existingTxIndex = sigToFind ? state.allTransactionResults.findIndex(tx => tx.signature === sigToFind) : -1;

      let updatedErrorResults;
      if (existingTxIndex > -1) {
        updatedErrorResults = [...state.allTransactionResults];
        updatedErrorResults[existingTxIndex] = {
          ...updatedErrorResults[existingTxIndex],
          error: action.payload.message, // Add/update error message
        };
      } else {
        // No existing entry, or no signature to find by, create a new error entry
        const errorResultEntry = {
          signature: sigToFind || 'N/A',
          error: action.payload.message,
          createdAt: state.createdAt, 
          sentAt: state.transactionSentAt,
          firstSentToEndpointName: state.firstSentToEndpointName,
          firstWsConfirmedAt: state.firstWsConfirmedAt,
          firstConfirmedByEndpointName: state.firstConfirmedByEndpointName,
          rpcSendResults: [...state.rpcSendResults],
          wsConfirmationResults: [...state.wsConfirmationResults],
        };
        updatedErrorResults = [...state.allTransactionResults, errorResultEntry];
      }

      return { 
        ...state, 
        isLoading: false, 
        globalStatus: `Error on Tx ${state.currentTransactionIndex + 1}/${state.numberOfTransactions}: ${action.payload.message}. Halting further transactions.`, 
        globalError: { message: action.payload.message, type: 'critical' }, 
        isComplete: true, // Marks the current tx attempt as 'complete' (due to error)
        allProcessesComplete: true, // No more transactions will be processed
        allTransactionResults: updatedErrorResults, 
      };
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