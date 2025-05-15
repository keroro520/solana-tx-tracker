import React from 'react';

const EventSummaryTable = ({ events, endpointsConfig }) => {
  if (!events || events.length === 0) {
    return <p>No event data to display for summary.</p>;
  }

  const parseEvent = (event) => {
    const message = event.message.toLowerCase();
    let eventType = 'UNKNOWN';
    let url = '-';
    let endpointName;

    if (message.includes('transaction created:')) {
      eventType = 'CreateTransaction';
      // No URL for this event
    } else if (message.includes('creating websocket connection for')) {
      eventType = 'WebsocketSubscribe';
      const urlMatch = message.match(/to (wss?:\/\/[^\s]+)/i);
      if (urlMatch) {
        url = urlMatch[1];
      } else {
        const nameMatch = message.match(/for (.*?) to /i);
        if (nameMatch && endpointsConfig) {
          endpointName = nameMatch[1].trim();
          const endpoint = endpointsConfig.find(ep => ep.name.toLowerCase() === endpointName.toLowerCase());
          if (endpoint) url = endpoint.wsUrl;
        }
      }
    } else if (message.includes('websocket message received from') && message.includes('confirmed')) {
      eventType = 'WebsocketReceiveConfirmation';
      const nameMatch = message.match(/from (.*?):/i);
      if (nameMatch && endpointsConfig) {
        endpointName = nameMatch[1].trim();
        const endpoint = endpointsConfig.find(ep => ep.name.toLowerCase() === endpointName.toLowerCase());
        if (endpoint) url = endpoint.wsUrl; // Assuming confirmation relates to the endpoint's WS URL
      }
    } else if (message.includes('creating rpc connection for')) {
      eventType = 'RpcConnect';
      const urlMatch = message.match(/to (https?:\/\/[^\s]+)/i);
      if (urlMatch) {
        url = urlMatch[1];
      } else {
        const nameMatch = message.match(/for (.*?) to /i);
        if (nameMatch && endpointsConfig) {
          endpointName = nameMatch[1].trim();
          const endpoint = endpointsConfig.find(ep => ep.name.toLowerCase() === endpointName.toLowerCase());
          if (endpoint) url = endpoint.rpcUrl;
        }
      }
    } else if (message.includes('transaction sent via rpc to') && !message.includes('error')) {
      eventType = 'RpcSendTransaction';
      // Matches "transaction sent via rpc to ENDPOINT_NAME. RPC Signature..." or "transaction sent via rpc to ENDPOINT_NAME."
      const nameMatch = message.match(/via rpc to (.*?)(?:\. rpc signature|\.(?!\w)|$)/i);
      if (nameMatch && endpointsConfig) {
        endpointName = nameMatch[1].trim();
        const endpoint = endpointsConfig.find(ep => ep.name.toLowerCase() === endpointName.toLowerCase());
        if (endpoint) url = endpoint.rpcUrl;
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