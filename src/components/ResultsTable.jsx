import React from 'react';

const ResultsTable = ({ results }) => {
  if (!results || results.length === 0) {
    return <p>No results yet. Click "Send Transaction" to gather data.</p>;
  }

  return (
    <div className="results-section">
      <h3>Results:</h3>
      <table border="1" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>RPC Send Latency (ms)</th>
            <th>Conf. Duration (from send, ms)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => (
            <tr key={result.name || index}>
              <td>{result.name}</td>
              <td>{result.sendDuration ?? 'N/A'}</td>
              <td>{result.confirmationDuration ?? 'N/A'}</td>
              <td style={{ color: result.error ? 'red' : 'green' }}>
                {result.error ? `Error: ${result.error.message}` : (result.status || 'Confirmed')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ResultsTable; 