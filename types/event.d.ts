export interface Event {
  id: string; // Unique identifier
  title: string; // Name of the Event
  description: string; // Detailed Description
  category: string; // e.g., 'Music', 'Theatre'
  date: string; // ISO 8601 e.g., '2026-06-12'
  image: string; // Image URL
  location: string; // Location of the event
  source: string; // External URL or source for event details
}