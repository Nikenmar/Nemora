import { useState } from 'react';

import Button from '../Button';
import Checkbox from '../Checkbox';
import Dropdown from '../Dropdown';
import TitleContainer from '../TitleContainer';
import EmptyState from './EmptyState';
import Icon from './Icon';
import Segmented from './Segmented';
import { SkeletonRows } from './Skeleton';
import Toggle from './Toggle';
import { fieldClass } from './classes';

const noop = () => undefined;

/**
 * Every primitive of the redesign with its states, in one prompt. Opened by the screenshot stand
 * (`S.prompt('showcase')`, shot 00-primitives); not reachable from the app's own interface.
 */
const Showcase = () => {
  const [mode, setMode] = useState<'track' | 'both'>('track');
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [sort, setSort] = useState('newest');
  return (
    <div className="flex w-[64rem] max-w-full flex-col gap-6 text-ink">
      <TitleContainer
        title="Summer 2026"
        otherItems={[<span key="meta" className="text-small text-ink-dim">42 ranked, 36 in pool</span>]}
        buttons={[
          { label: 'Play', iconName: 'play_arrow', variant: 'primary', clickHandler: noop },
          { label: 'Shuffle', iconName: 'shuffle', clickHandler: noop },
          { iconName: 'add', tooltipLabel: 'Add tier', clickHandler: noop },
          { iconName: 'tune', tooltipLabel: 'Edit sources', clickHandler: noop },
          { iconName: 'ios_share', tooltipLabel: 'Export image', clickHandler: noop },
          { label: 'Delete tierlist', iconName: 'delete', variant: 'danger', inOverflowMenu: true, clickHandler: noop }
        ]}
        dropdowns={[
          {
            name: 'sortDropdown',
            type: 'Sort by',
            value: sort,
            options: [
              { label: 'Newest', value: 'newest' },
              { label: 'A to Z', value: 'aToZ' }
            ],
            onChange: (e) => setSort(e.currentTarget.value)
          }
        ]}
      />
      <section className="flex flex-wrap items-center gap-2">
        <Button label="Play" iconName="play_arrow" variant="primary" clickHandler={noop} className="!mr-0" />
        <Button label="Shuffle" iconName="shuffle" clickHandler={noop} className="!mr-0" />
        <Button label="Export image" variant="outline" clickHandler={noop} className="!mr-0" />
        <Button label="Cancel" variant="ghost" clickHandler={noop} className="!mr-0" />
        <Button label="Delete" iconName="delete" variant="danger" clickHandler={noop} className="!mr-0" />
        <Button label="Saving" iconName="save" isDisabled pendingAnimationOnDisabled clickHandler={noop} className="!mr-0" />
        <Button iconName="favorite" tooltipLabel="Like" isActive clickHandler={noop} className="!mr-0" />
        <Button iconName="repeat" tooltipLabel="Repeat" clickHandler={noop} className="!mr-0" />
        <Button label="Disabled" isDisabled clickHandler={noop} className="!mr-0" />
      </section>
      <section className="flex flex-wrap items-center gap-4">
        <Segmented
          label="Labels"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'track', label: 'Track' },
            { value: 'both', label: 'Artist + track' }
          ]}
        />
        <Toggle id="showcase-toggle" label="Cover light" isChecked={on} onChange={setOn} />
        <Checkbox id="showcase-check" isChecked={checked} checkedStateUpdateFunction={setChecked} labelContent="Show missing songs" className="!m-0" />
        <Dropdown
          name="filterDropdown"
          type="Filter"
          value="all"
          options={[{ label: 'All songs', value: 'all' }]}
          onChange={noop}
          className="!ml-0"
        />
      </section>
      <section className="grid grid-cols-2 gap-4">
        <input className={fieldClass} placeholder="Search songs" aria-label="Search songs" />
        <div className="flex items-center gap-3 text-body">
          <span>Text</span>
          <span className="text-ink-dim">Secondary</span>
          <span className="text-ink-faint">Disabled</span>
          <span className="text-echo">Playing now</span>
          <span className="text-danger">Error</span>
          <Icon name="graphic_eq" filled className="text-echo" />
        </div>
      </section>
      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-panel bg-surface-1">
          <EmptyState
            iconName="library_music"
            title="No songs yet"
            description="Add a music folder and Nemora scans it."
            action={<Button label="Add folder" iconName="create_new_folder" variant="primary" clickHandler={noop} className="!mr-0" />}
          />
        </div>
        <div className="rounded-panel bg-surface-1 p-2">
          <SkeletonRows count={5} />
        </div>
      </section>
    </div>
  );
};

export default Showcase;
