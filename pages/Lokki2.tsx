import React, { useEffect, useMemo, useState } from "react";
import CategoryFilter from "../components/CategoryFilter";
import DateFilter from "../components/DateFilter";
import EventGrid from "../components/EventGrid";
import { fetchEvents } from "../services/scraper";
import { Event } from "../types/event";

const Lokki2: React.FC = () => {
  const [category, setCategory] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchEvents()
      .then((res) => {
        if (!mounted) return;
        setEvents(res);
        setError(null);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err?.message ?? "Failed to fetch events");
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const categoryMatch = !category || ev.category === category;
      const dateMatch = !date || ev.date === date;
      return categoryMatch && dateMatch;
    });
  }, [events, category, date]);

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

      {loading ? (
        <p className="loading">Loading events…</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : (
        <EventGrid events={filteredEvents} />
      )}
    </main>
  );
};

export default Lokki2;
