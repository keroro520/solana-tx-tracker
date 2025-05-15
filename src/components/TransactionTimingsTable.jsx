import React from 'react';

const TransactionTimingsTable = ({
  signature,
  createdAt,
  firstSentAt,
  firstSentToEndpointName,
  firstConfirmedAt,
  firstConfirmedByEndpointName,
}) => {
  const formatOptTimestamp = (ts) => ts ? new Date(ts).toISOString() : 'N/A';
  const calculateDuration = (start, end) => {
    if (start && end) {
      const diff = new Date(end).getTime() - new Date(start).getTime();
      return `${diff} ms`;
    }
    return 'N/A';
  };

  const shortenSignature = (sig) => {
    return `${sig.substring(0, 4)}...${sig.substring(sig.length - 4)}`;
  };

  return (
    <div className="transaction-timings-table" style={{ marginBottom: '20px' }}>
      <h3>Transaction Timings</h3>
      <table border="1" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>TxSig</th>
            <th style={{ textAlign: 'left' }}>TxCreatedAt</th>
            <th style={{ textAlign: 'left' }}>TxFirstSentAt (&lt;rpc endpointName&gt;)</th>
            <th style={{ textAlign: 'left' }}>TxFirstConfirmedAt (&lt;ws endpointName&gt;)</th>
            <th style={{ textAlign: 'left' }}>Confirmation Duration (Create to First WS Confirm)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              {signature ? (
                <a 
                  href={`https://solscan.io/tx/${signature}?cluster=devnet`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  {shortenSignature(signature)}
                </a>
              ) : (
                'N/A'
              )}
            </td>
            <td>{formatOptTimestamp(createdAt)}</td>
            <td>{formatOptTimestamp(firstSentAt)} {firstSentToEndpointName ? `(${firstSentToEndpointName})` : ''}</td>
            <td>{formatOptTimestamp(firstConfirmedAt)} {firstConfirmedByEndpointName ? `(${firstConfirmedByEndpointName})` : ''}</td>
            <td>{calculateDuration(createdAt, firstConfirmedAt)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default TransactionTimingsTable; 