import React, { useEffect, useState } from 'react';
import { Event } from '../types/event';
import EventGrid from '../components/EventGrid';
import CategoryFilter from '../components/CategoryFilter';
import DateFilter from '../components/DateFilter';

const Lokki2: React.FC = () => {
  const [category, setCategory] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch('/api/v2/events')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        setEvents(data.events || []);
        setError(null);
      })
      .catch((e) => setError(e?.message || 'Failed'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false };
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (category) params.set('category', category);
      if (date) params.set('dateFrom', date);
      const resp = await fetch(`/api/v2/search?${params.toString()}`);
      if (!resp.ok) throw new Error((await resp.json()).error || 'Search failed');
      const data = await resp.json();
      setEvents(data.results || []);
    } catch (err: any) {
      setError(err?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="lokki2-page">
      <header className="lokki2-header">
        <h1>Lokki 2 — Events</h1>
      </header>

      <section className="search-bar">
        <input aria-label="search" placeholder="Search events in Finland..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={handleSearch} disabled={loading}>Search</button>
      </section>

      <section className="filters" aria-label="Event filters">
        <label>
          Category:
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            <option value="MUSIC">Music</option>
            <option value="FOOD">Food</option>
            <option value="ART">Art</option>
            <option value="SPORTS">Sports</option>
            <option value="NIGHTLIFE">Nightlife</option>
            <option value="FAMILY">Family</option>
            <option value="THEATRE">Theatre</option>
            <option value="MARKET">Market</option>
            <option value="OUTDOORS">Outdoors</option>
          </select>
        </label>

        <DateFilter value={date} onChange={setDate} />
      </section>

      {loading ? (
        <p className="loading">Loading events…</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : (
        <EventGrid events={events} />
      )}
    </main>
  );
};

export default Lokki2;
