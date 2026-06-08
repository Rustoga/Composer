import React from "react";

interface DateFilterProps {
  value: string;
  onChange: (value: string) => void;
}

const DateFilter: React.FC<DateFilterProps> = ({ value, onChange }) => {
  return (
    <div className="date-filter">
      <label htmlFor="date-input" className="sr-only">Filter by date</label>
      <input
        id="date-input"
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="date-input"
      />
    </div>
  );
};

export default DateFilter;
