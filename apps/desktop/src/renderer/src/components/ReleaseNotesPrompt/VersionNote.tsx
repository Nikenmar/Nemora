import { useId } from 'react';
import Img from '../Img';

export interface VersionNoteProps {
  note: string;
  artworkPath?: string;
}

const VersionNote = (props: VersionNoteProps) => {
  const { note, artworkPath } = props;
  const key = useId();
  return (
    <li className="mb-1 last:mb-0" key={key}>
      {note}
      {artworkPath && (
        <>
          <br />
          <Img src={artworkPath} noFallbacks className="mx-auto my-3 w-[80%] max-w-full rounded-panel" alt="" />
        </>
      )}
    </li>
  );
};

export default VersionNote;
