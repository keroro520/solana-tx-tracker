import React from 'react';

const EventSummaryTable = ({ events, rpcUrlsConfig, wsUrlsConfig }) => {
  if (!events || events.length === 0) {
    return <p>No event data to display for summary.</p>;
  }

  const parseEvent = (event) => {
    const message = event.message.toLowerCase();
    let eventType = 'UNKNOWN';
    let url = '-';
    let endpointName;

    // Helper to find URL from config arrays
    const findUrlInConfigs = (name, type) => {
      const nameLower = name.toLowerCase();
      if (type === 'ws' && wsUrlsConfig) {
        const endpoint = wsUrlsConfig.find(ep => ep.name.toLowerCase() === nameLower);
        if (endpoint) return endpoint.url;
      }
      if (type === 'rpc' && rpcUrlsConfig) {
        const endpoint = rpcUrlsConfig.find(ep => ep.name.toLowerCase() === nameLower);
        if (endpoint) return endpoint.url;
      }
      return '-'; // Default if not found
    };

    if (message.includes('transaction created:')) {
      eventType = 'CreateTransaction';
      // No URL for this event
    } else if (message.includes('creating websocket connection for')) {
      eventType = 'WebsocketSubscribe';
      const urlMatch = message.match(/to (wss?:\/\/[^\s]+)/i); // Direct URL match
      if (urlMatch) {
        url = urlMatch[1];
      } else {
        const nameMatch = message.match(/for (.*?) to /i); // Match by name
        if (nameMatch) {
          endpointName = nameMatch[1].trim();
          url = findUrlInConfigs(endpointName, 'ws');
        }
      }
    } else if (message.includes('websocket message received from') && message.includes('confirmed')) {
      eventType = 'WebsocketReceiveConfirmation';
      const nameMatch = message.match(/from (.*?):/i);
      if (nameMatch) {
        endpointName = nameMatch[1].trim();
        url = findUrlInConfigs(endpointName, 'ws');
      }
    } else if (message.includes('creating rpc connection for')) {
      eventType = 'RpcConnect';
      const urlMatch = message.match(/to (https?:\/\/[^\s]+)/i); // Direct URL match
      if (urlMatch) {
        url = urlMatch[1];
      } else {
        const nameMatch = message.match(/for (.*?) to /i); // Match by name
        if (nameMatch) {
          endpointName = nameMatch[1].trim();
          url = findUrlInConfigs(endpointName, 'rpc');
        }
      }
    } else if (message.includes('transaction sent via rpc to') && !message.includes('error')) {
      eventType = 'RpcSendTransaction';
      const nameMatch = message.match(/via rpc to (.*?)(?:\. rpc signature|\.(?!\w)|$)/i);
      if (nameMatch) {
        endpointName = nameMatch[1].trim();
        url = findUrlInConfigs(endpointName, 'rpc');
      }
    }

    const targetEventKeywords = [
        'createtransaction', 
        'websocketsubscribe', 
        'websocketreceiveconfirmation', 
        'rpcconnect', 
        'rpcsendtransaction'
    ];

    if (!targetEventKeywords.includes(eventType.toLowerCase())) return null;

    return {
      id: event.timestamp + message.substring(0,10), // simple unique key
      timestamp: new Date(event.timestamp).toISOString(),
      event: eventType,
      url: url,
    };
  };

  const relevantEvents = events.map(parseEvent).filter(Boolean);

  if (relevantEvents.length === 0) {
    return <p>No relevant transaction lifecycle events to display in summary table.</p>;
  }

  return (
    <div className="event-summary-table">
      <h3>Event Lifecycle Summary</h3>
      <table border="1" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Event</th>
            <th>Url</th>
          </tr>
        </thead>
        <tbody>
          {relevantEvents.map((eventItem, index) => (
            <tr key={`${eventItem.id}-${index}`}>
              <td>{eventItem.timestamp}</td>
              <td>{eventItem.event}</td>
              <td>{eventItem.url}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default EventSummaryTable; 