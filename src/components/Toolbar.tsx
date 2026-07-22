import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection } from 'lexical';
import { $patchStyleText } from '@lexical/selection';

const SIZES = [11, 12, 14, 20];

export function Toolbar() {
  const [editor] = useLexicalComposerContext();

  const applySize = (pt: number) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { 'font-size': `${pt}pt` });
      }
    });
  };

  return (
    <div className="toolbar">
      <span className="toolbar-label">Font size (highlight text, then click):</span>
      {SIZES.map((pt) => (
        <button key={pt} type="button" onClick={() => applySize(pt)}>
          {pt}pt
        </button>
      ))}
    </div>
  );
}
