import React from 'react';

const TransactionInfo = ({ signature, createdAt }) => {
  return (
    <div className="transaction-info" style={{ marginBottom: '15px' }}>
      {signature && (
        <p><strong>Transaction Signature:</strong> {signature}</p>
      )}
      {createdAt && (
        <p><strong>Created At:</strong> {new Date(createdAt).toISOString()}</p>
      )}
    </div>
  );
};

export default TransactionInfo; 
