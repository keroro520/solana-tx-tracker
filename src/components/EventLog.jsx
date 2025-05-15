import React from 'react';
import './EventLog.css';

function EventLog({ events }) {
  if (!events || events.length === 0) {
    return <p>No events to display.</p>;
  }

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString(); // Or any other format you prefer
  };

  return (
    <div className="event-log-container">
      <h3>Event Log:</h3>
      <ul className="event-list">
        {events.map((event, index) => (
          <li key={index} className="event-item">
            <span className="event-timestamp">{formatTimestamp(event.timestamp)}</span>
            <span className="event-message">{event.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default EventLog; 