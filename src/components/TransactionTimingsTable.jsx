import React from 'react';

const TransactionTimingsTable = ({ allTransactionsData, network }) => {
  const formatOptTimestamp = (ts) => {
    if (!ts) return 'N/A';
    const date = new Date(ts);
    // Extracts the time part (HH:mm:ss.sssZ) from the ISO string
    return date.toISOString().split('T')[1];
  };
  const calculateDuration = (start, end) => {
    if (start && end) {
      const diff = new Date(end).getTime() - new Date(start).getTime();
      return `${diff} ms`;
    }
    return 'N/A';
  };

  const shortenSignature = (sig) => {
    if (!sig) return 'N/A';
    return `${sig.substring(0, 4)}...${sig.substring(sig.length - 4)}`;
  };

  // Generate the correct URL based on network
  const getSolscanUrl = (signature) => {
    return network === 'mainnet' 
      ? `https://solscan.io/tx/${signature}`
      : `https://solscan.io/tx/${signature}?cluster=devnet`;
  };

  const formatBlockTimestamp = (unixTimestamp) => {
    if (unixTimestamp === null || typeof unixTimestamp === 'undefined') return 'N/A';
    // Assuming unixTimestamp is in seconds
    return formatOptTimestamp(unixTimestamp * 1000)
  };

  if (!allTransactionsData || allTransactionsData.length === 0) {
    return (
      <div className="transaction-timings-table" style={{ marginBottom: '20px' }}>
        <h3>Transaction Timings</h3>
        <p>No transaction data to display.</p>
      </div>
    );
  }

  return (
    <div className="transaction-timings-table" style={{ marginBottom: '20px' }}>
      <h3>Transaction Timings</h3>
      <table border="1" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>#</th>
            <th style={{ textAlign: 'left' }}>TxSig</th>
            <th style={{ textAlign: 'left' }}>TxCreatedAt</th>
            <th style={{ textAlign: 'left' }}>TxFirstSentAt</th>
            <th style={{ textAlign: 'left' }}>TxFirstConfirmedAt</th>
            <th style={{ textAlign: 'left' }}>BlockTime</th>
            <th style={{ textAlign: 'left' }}>Confirmation Duration (Create to First WS Confirm)</th>
            <th style={{ textAlign: 'left' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {allTransactionsData.map((txData, index) => (
            <tr key={txData.signature || index}>
              <td>{index + 1}</td>
              <td>
                {txData.signature && !txData.error ? (
                  <a 
                    href={getSolscanUrl(txData.signature)} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    {shortenSignature(txData.signature)}
                  </a>
                ) : (
                  shortenSignature(txData.signature) // Show signature even if errored, or N/A if no sig
                )}
              </td>
              <td>{formatOptTimestamp(txData.createdAt)}</td>
              <td>{formatOptTimestamp(txData.sentAt)} <br /> {txData.firstSentToEndpointName ? `(${txData.firstSentToEndpointName})` : ''}</td>
              <td>{formatOptTimestamp(txData.firstWsConfirmedAt)} <br /> {txData.firstConfirmedByEndpointName ? `(${txData.firstConfirmedByEndpointName})` : ''}</td>
              <td>{formatBlockTimestamp(txData.blockTime)}</td>
              <td>{calculateDuration(txData.createdAt, txData.firstWsConfirmedAt)}</td>
              <td>{txData.error ? <span style={{ color: 'red' }}>Error: {txData.error}</span> : <span style={{ color: 'green'}}>Success</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TransactionTimingsTable; 
