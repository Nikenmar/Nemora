import Img from '../Img';

const ContextMenuDataItem = (props: { data: ContextMenuAdditionalData }) => {
  const {
    data: { title, artworkPath, subTitle, subTitle2, button, artworkClassName }
  } = props;
  return (
    <div className="context-menu-data-item mb-1 flex max-w-[20rem] items-center gap-2.5 border-b border-glass-border px-2 pb-2 pt-1.5 text-ink">
      <Img
        className={`aspect-square w-9 shrink-0 rounded-cover-sm object-cover ${artworkClassName}`}
        src={artworkPath}
        loading="eager"
        alt="Context menu data item artwork"
      />
      <div className="info-container flex flex-col justify-center overflow-hidden text-ellipsis whitespace-nowrap">
        <p className="title-container truncate text-body font-medium">{title}</p>
        {(subTitle || subTitle2) && (
          <div className="sub-titles-container flex gap-1.5 text-small text-ink-dim">
            <span className="sub-title truncate">{subTitle}</span>
            {subTitle && subTitle2 && <span aria-hidden>·</span>}
            <span className="sub-title truncate">{subTitle2}</span>
          </div>
        )}
      </div>
      {button}
    </div>
  );
};

export default ContextMenuDataItem;
