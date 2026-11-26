export function SearchField({ value, onChange, label, placeholder, maxLength, className = "" }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}) {
  return <div className={`search-field ${className}`}>
    <input type="search" value={value} maxLength={maxLength} aria-label={label} placeholder={placeholder ?? label}
      onChange={event => onChange(event.target.value)} />
  </div>;
}
