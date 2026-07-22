import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, COMMAND_PRIORITY_HIGH, PASTE_COMMAND, PASTE_TAG } from 'lexical';

// Lexical 0.48's default paste handling preserves inline formatting (bold,
// italic, links, ...) correctly, but drops paragraph-level spacing entirely -
// there's no supported hook to plug spacing capture into that pipeline. So
// we run in parallel instead: capture each pasted <p>'s margin from the raw
// clipboard HTML ourselves (without preventing the default handler from also
// running), then once that paste's update lands (tagged PASTE_TAG), diff
// root children against the previous state to find the paragraphs it just
// inserted and apply the captured spacing directly to their DOM elements -
// margin-bottom isn't a concept Lexical's node model tracks at all, so this
// is DOM-only, the same way the pagination engine manages margin-top itself.
function extractParagraphSpacing(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('p')).map((p) => {
    const spacing = (p as HTMLElement).style.marginBottom || (p as HTMLElement).style.marginTop;
    return spacing && spacing !== '0px' && spacing !== '0pt' ? spacing : '';
  });
}

export function usePreservePasteSpacing(): void {
  const [editor] = useLexicalComposerContext();
  const pendingSpacing = useRef<string[]>([]);

  useEffect(() => {
    const unregisterCommand = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null;
        const html = clipboardData?.getData('text/html');
        pendingSpacing.current = html ? extractParagraphSpacing(html) : [];
        return false; // never claim the command; the default handler must still run
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterUpdate = editor.registerUpdateListener(({ tags, editorState, prevEditorState }) => {
      if (!tags.has(PASTE_TAG) || pendingSpacing.current.length === 0) return;
      const spacing = pendingSpacing.current;
      pendingSpacing.current = [];

      const prevKeys = prevEditorState.read(() => new Set($getRoot().getChildrenKeys()));
      const newKeys = editorState.read(() => $getRoot().getChildrenKeys().filter((key) => !prevKeys.has(key)));
      if (newKeys.length === 0) return;

      newKeys.forEach((key, i) => {
        const value = spacing[i];
        const element = editor.getElementByKey(key);
        if (element && value) {
          element.style.marginBottom = value;
        }
      });
    });

    return () => {
      unregisterCommand();
      unregisterUpdate();
    };
  }, [editor]);
}
