import React from 'react';

const ConfigDisplay = ({ configStatus, configPath }) => {
  return (
    <div className="config-display" style={{ marginBottom: '10px', padding: '8px', backgroundColor: '#f0f0f0' }}>
      <p>
        <strong>Config Status:</strong> {configStatus || 'Loading...'}
        {configPath && ` (Source: ${configPath})`}
      </p>
    </div>
  );
};

export default ConfigDisplay; 