import React from 'react';

const TransactionTimingsTable = ({ createdAt, sentAt, confirmedAt }) => {
  const formatOptTimestamp = (ts) => ts ? new Date(ts).toISOString() : 'N/A';
  const calculateDuration = (start, end) => {
    if (start && end) {
      const diff = new Date(end).getTime() - new Date(start).getTime();
      return `${diff} ms`;
    }
    return 'N/A';
  };

  const data = [
    { key: 'Transaction Created At', val: formatOptTimestamp(createdAt) },
    { key: 'Transaction Sent At (All RPCs)', val: formatOptTimestamp(sentAt) },
    { key: 'Transaction First Confirmed At (WS)', val: formatOptTimestamp(confirmedAt) },
    { key: 'Confirmation Duration (Create to First WS Confirm)', val: calculateDuration(createdAt, confirmedAt) },
  ];

  return (
    <div className="transaction-timings-table" style={{ marginBottom: '20px' }}>
      <h3>Transaction Timings</h3>
      <table border="1" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Key</th>
            <th style={{ textAlign: 'left' }}>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={index}>
              <td>{row.key}</td>
              <td>{row.val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TransactionTimingsTable; 