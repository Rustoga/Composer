import React from "react";
import { Event } from "../types/event";
import EventCard from "./EventCard";

interface EventGridProps {
  events: Event[];
}

const EventGrid: React.FC<EventGridProps> = ({ events }) => {
  return (
    <section className="event-grid" aria-label="Event grid">
      {events.length === 0 ? (
        <p className="no-events">No events found.</p>
      ) : (
        <div className="grid">
          {events.map((ev) => (
            <EventCard key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </section>
  );
};

export default EventGrid;
