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
      className={`appear-from-bottom mr-3 flex w-fit cursor-pointer list-none items-center !border-0 text-ink outline-1 outline-offset-1 transition-[width,background,color] duration-200 focus-visible:!outline ${
        isCurrentActiveFilter
          ? 'active bg-accent '
          : 'bg-surface-2 hover:bg-accent '
      }`}
      clickHandler={() => changeActiveFilter(value)}
      label={label}
      iconName={icon}
    />
  );
});

SearchResultsFilter.displayName = 'SearchResultsFilter';
export default SearchResultsFilter;
