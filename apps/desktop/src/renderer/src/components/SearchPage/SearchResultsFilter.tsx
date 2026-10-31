import { memo } from 'react';
import Button from '../Button';

export interface SearchResultFilter {
  label: string;
  icon: string;
  value: SearchFilters;
}
interface SearchResultsFilterProp extends SearchResultFilter {
  isCurrentActiveFilter: boolean;
  changeActiveFilter: (_filterType: SearchFilters) => void;
}

const SearchResultsFilter = memo((props: SearchResultsFilterProp) => {
  const { label, value, icon, isCurrentActiveFilter, changeActiveFilter } = props;

  return (
    <Button
      className={`!mr-0 ${isCurrentActiveFilter ? 'active !bg-accent-soft !text-echo' : ''}`}
      isActive={isCurrentActiveFilter}
      clickHandler={() => changeActiveFilter(value)}
      label={label}
      iconName={icon}
    />
  );
});

SearchResultsFilter.displayName = 'SearchResultsFilter';
export default SearchResultsFilter;
