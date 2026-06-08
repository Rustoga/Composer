import React, { useMemo, useState } from "react";
import CategoryFilter from "../components/CategoryFilter";
import DateFilter from "../components/DateFilter";
import EventGrid from "../components/EventGrid";
import { mockEvents } from "../mock/events";

const Lokki2: React.FC = () => {
  const [category, setCategory] = useState<string>("");
  const [date, setDate] = useState<string>("");

  const filteredEvents = useMemo(() => {
    return mockEvents.filter((ev) => {
      const categoryMatch = !category || ev.category === category;
      const dateMatch = !date || ev.date === date;
      return categoryMatch && dateMatch;
    });
  }, [category, date]);

  return (
    <main className="lokki2-page">
      <header className="lokki2-header">
        <h1>Lokki 2 — Events</h1>
        <p>Client-side filtered event explorer (mock data)</p>
      </header>

      <section className="filters" aria-label="Event filters">
        <CategoryFilter value={category} onChange={setCategory} />
        <DateFilter value={date} onChange={setDate} />
      </section>

      <EventGrid events={filteredEvents} />
    </main>
  );
};

export default Lokki2;
