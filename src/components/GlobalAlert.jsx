import React from 'react';

const GlobalAlert = ({ error, onDismiss }) => {
  if (!error || !error.message) {
    return null;
  }

  return (
    <div className="global-alert" style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '10px', marginBottom: '15px', border: '1px solid #f5c6cb', borderRadius: '4px' }}>
      <span>{error.message}</span>
      {typeof onDismiss === 'function' && (
        <button 
          onClick={onDismiss} 
          style={{ marginLeft: '15px', padding: '3px 8px', cursor: 'pointer' }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
};

export default GlobalAlert; 