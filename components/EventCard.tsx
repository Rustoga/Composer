import React from "react";
import { Event } from "../types/event";

interface EventCardProps {
  event: Event;
}

const EventCard: React.FC<EventCardProps> = ({ event }) => {
  const formattedDate = new Date(event.date).toLocaleDateString();

  return (
    <article className="event-card" aria-labelledby={`event-title-${event.id}`}>
      <div className="event-image-wrapper">
        <img className="event-image" src={event.image} alt={event.title} />
      </div>
      <div className="event-content">
        <h3 id={`event-title-${event.id}`} className="event-title">
          {event.title}
        </h3>
        <p className="event-meta">
          <span className="event-category">{event.category}</span>
          <span className="event-date">{formattedDate}</span>
        </p>
        <p className="event-location">{event.location}</p>
      </div>
    </article>
  );
};

export default EventCard;
