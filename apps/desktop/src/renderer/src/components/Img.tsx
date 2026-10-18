/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { type MouseEvent as ReactMouseEvent, memo, useEffect, useRef } from 'react';
import log from '../utils/log';
import DefaultImage from '../assets/images/webp/song_cover_default.webp';

interface ImgProperties {
  width: number;
  height: number;
  quality: string;
}

type ImgProps = {
  src?: string;
  fallbackSrc?: string;
  alt?: string;
  noFallbacks?: boolean;
  className?: string;
  onClick?: (_e: ReactMouseEvent<HTMLImageElement, MouseEvent>) => void;
  loading?: 'eager' | 'lazy';
  onContextMenu?: (_e: ReactMouseEvent<HTMLImageElement, MouseEvent>) => void;
  showImgPropsOnTooltip?: boolean;
  tabIndex?: number;
  showAltAsTooltipLabel?: boolean;
  draggable?: boolean;
  enableImgFadeIns?: boolean;
};

/* <picture
  className={`outline-1 outline-offset-4 focus-visible:!outline ${className}`}
  tabIndex={tabIndex}
>
  <source srcSet={src} />
  {fallbackSrc && <source srcSet={fallbackSrc} />}
  <img
    onContextMenu={onContextMenu}
    onClick={onClick}
    src={DefaultImage}
    alt="Default placeholder artwork"
    loading={loading}
    className={className}
    onLoad={(e) => {
      if (showImgPropsOnTooltip) {
        const img = new Image();
        img.onload = () => {
          if (img?.width && img?.height)
            imgPropsRef.current = {
              width: img.width,
              height: img.height,
            };
        };
        img.src = e.currentTarget.src;
      }
    }}
    title={
      showImgPropsOnTooltip && imgPropsRef.current
        ? `Quality : ${
            imgPropsRef.current?.width >= 1000 ||
            imgPropsRef.current?.height >= 1000
              ? 'HIGH QUALITY'
              : imgPropsRef.current?.width >= 500 ||
                imgPropsRef.current?.height >= 500
              ? 'MEDIUM QUALITY'
              : 'LOW QUALITY'
          }\nImage width : ${imgPropsRef.current?.width}px\nImage height : ${
            imgPropsRef.current?.height
          }px`
        : showAltAsTooltipLabel
        ? alt
        : undefined
    }
  />
</picture>; */

const Img = memo((props: ImgProps) => {
  const {
    src,
    alt = '',
    className,
    fallbackSrc = DefaultImage,
    noFallbacks = false,
    onClick = () => true,
    loading = 'eager',
    onContextMenu,
    showImgPropsOnTooltip = false,
    tabIndex = -1,
    showAltAsTooltipLabel = false,
    draggable = false,
    enableImgFadeIns = true
  } = props;

  const imgRef = useRef<HTMLImageElement>(null);
  const imgPropsRef = useRef<ImgProperties>();
  const errorCountRef = useRef(0);
  const isFirstTimeRef = useRef(true);

  /**
   * Gives up on the placeholder once the real cover exists.
   *
   * `onError` below swaps the element's `src` for the fallback, and that swap
   * is permanent - a library scan produces songs before their covers, so every
   * new row asks for a file that is not written yet, takes the placeholder, and
   * keeps it until something rebuilds the view. Changing tabs was what rebuilt
   * it. Now the covers announce themselves, and an image that fell back gets
   * another go at exactly the moment its file appears.
   *
   * Matched on the src because the cover file is named after the song id, and
   * only images that actually failed retry - a picture already on screen is
   * never reloaded.
   */
  useEffect(() => {
    if (!src) return undefined;

    const retryIfCoverArrived = (event: Event): void => {
      if (!('detail' in event) || errorCountRef.current === 0 || !imgRef.current) return;
      const updates = (event as DetailAvailableEvent<DataUpdateEvent[]>).detail;
      const isMine = updates.some(
        (update) =>
          update.dataType === 'songs/artworks' &&
          update.eventData.some((id) => typeof id === 'string' && src.includes(id))
      );
      if (!isMine) return;
      errorCountRef.current = 0;
      imgRef.current.src = src;
    };

    document.addEventListener('app/dataUpdates', retryIfCoverArrived);
    return () => document.removeEventListener('app/dataUpdates', retryIfCoverArrived);
  }, [src]);

  return (
    // <div className="inline-block relative">
    <img
      src={src || fallbackSrc}
      alt={alt}
      ref={imgRef}
      className={`relative outline-1 outline-offset-4 focus-visible:!outline ${
        enableImgFadeIns && isFirstTimeRef.current
          ? 'opacity-0 transition-opacity delay-[250ms]'
          : '!opacity-100 !transition-none'
      } ${className}`}
      draggable={draggable}
      onError={(e) => {
        if (errorCountRef.current < 3) {
          errorCountRef.current += 1;
          if (!noFallbacks && e.currentTarget.src !== fallbackSrc)
            e.currentTarget.src = fallbackSrc;
          else e.currentTarget.src = DefaultImage;
        } else {
          log(
            'maximum img fetch error count reached.',
            { src, fallbackSrc, props: imgPropsRef.current },
            'WARN'
          );
          e.currentTarget.src = DefaultImage;
        }
      }}
      onClick={onClick}
      title={
        showImgPropsOnTooltip && imgPropsRef.current
          ? `Quality : ${imgPropsRef.current.quality}\nImage width : ${imgPropsRef.current?.width}px\nImage height : ${imgPropsRef.current?.height}px`
          : showAltAsTooltipLabel
            ? alt
            : undefined
      }
      loading={loading}
      onContextMenu={onContextMenu}
      onLoad={(e) => {
        if (isFirstTimeRef.current) {
          isFirstTimeRef.current = false;
        }
        e.currentTarget.classList.add('!opacity-100');
        if (showImgPropsOnTooltip) {
          const img = new Image();
          img.onload = () => {
            const width = img?.width;
            const height = img?.height;
            const imgProp: ImgProperties = {
              width,
              height,
              quality:
                width >= 1000 || height >= 1000
                  ? 'HIGH QUALITY'
                  : width >= 500 || height >= 500
                    ? 'MEDIUM QUALITY'
                    : 'LOW QUALITY'
            };
            imgPropsRef.current = imgProp;
            if (imgRef.current !== null && 'dataset' in imgRef.current) {
              const { dataset } = imgRef.current;
              dataset.width = imgProp.width.toString();
              dataset.height = imgProp.height.toString();
              dataset.quality = imgProp.quality;
            }
          };
          img.src = e.currentTarget.src;
        }
      }}
      tabIndex={tabIndex}
    />
    // </div>
  );
});

Img.displayName = 'Img';
export default Img;
