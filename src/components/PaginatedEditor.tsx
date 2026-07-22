import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { Toolbar } from './Toolbar';
import { PageCanvas } from './PageCanvas';
import { usePagination } from '../pagination/usePagination';
import './editor.css';

const theme = {
  paragraph: 'editor-paragraph',
};

function onError(error: Error) {
  console.error(error);
}

function EditorSurface() {
  const pageCount = usePagination();
  return (
    <PageCanvas pageCount={pageCount}>
      <RichTextPlugin
        contentEditable={<ContentEditable className="editor-input" />}
        placeholder={<div className="editor-placeholder">Start typing…</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
    </PageCanvas>
  );
}

export function PaginatedEditor() {
  const initialConfig = {
    namespace: 'paginated-doc',
    theme,
    onError,
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <Toolbar />
      <EditorSurface />
      <HistoryPlugin />
    </LexicalComposer>
  );
}
