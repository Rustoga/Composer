import React from "react";

interface CategoryFilterProps {
  value: string;
  onChange: (value: string) => void;
}

const CATEGORIES = ["Music", "Theatre", "Free Sauna", "Exhibition", "Family"];

const CategoryFilter: React.FC<CategoryFilterProps> = ({ value, onChange }) => {
  return (
    <div className="category-filter">
      <label htmlFor="category-select" className="sr-only">
        Filter by category
      </label>
      <select
        id="category-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="category-select"
      >
        <option value="">All Categories</option>
        {CATEGORIES.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>
    </div>
  );
};

export default CategoryFilter;
