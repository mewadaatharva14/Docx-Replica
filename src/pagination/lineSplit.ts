import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';

function updateAndWait(editor: LexicalEditor, fn: () => void): Promise<void> {
  return new Promise((resolve) => {
    editor.update(fn, { tag: HISTORY_MERGE_TAG, onUpdate: resolve });
  });
}

// Undoes previously injected pagination splits so the document is back to
// its real (unpaginated) structure before we re-measure from scratch.
export async function mergeContinuations(editor: LexicalEditor, registry: Set<string>): Promise<void> {
  if (registry.size === 0) return;
  const keys = Array.from(registry);
  registry.clear();
  await updateAndWait(editor, () => {
    for (const key of keys) {
      const node = $getNodeByKey(key);
      if (!node || !$isParagraphNode(node)) continue;
      const prev = node.getPreviousSibling();
      if (prev && $isElementNode(prev)) {
        for (const child of node.getChildren()) {
          prev.append(child);
        }
        // The continuation's element held the paragraph's real trailing
        // spacing (see splitBlockAtPoint's caller); give it back to the
        // piece that ends the paragraph now. Margin isn't part of Lexical's
        // node model, so this reads/writes the DOM directly.
        const contEl = editor.getElementByKey(key);
        const headEl = editor.getElementByKey(prev.getKey());
        if (contEl && headEl && contEl.style.marginBottom) {
          headEl.style.marginBottom = contEl.style.marginBottom;
        }
      }
      node.remove();
    }
  });
}

// Splits the paragraph rendered at viewport point (x, y) into two adjacent
// paragraphs at that exact text position, mirroring how a real page break
// falls mid-paragraph. Returns the new continuation paragraph's key, or
// null if no valid split point exists there (caller falls back to moving
// the whole block).
export async function splitBlockAtPoint(editor: LexicalEditor, x: number, y: number): Promise<string | null> {
  if (typeof document.caretRangeFromPoint !== 'function') {
    return null;
  }

  let newKey: string | null = null;

  await updateAndWait(editor, () => {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return;

    const lexNode = $getNearestNodeFromDOMNode(range.startContainer);
    if (!lexNode || !$isTextNode(lexNode)) return;

    const paragraph = lexNode.getParent();
    if (!paragraph || !$isElementNode(paragraph)) return;

    const offset = range.startOffset;
    const size = lexNode.getTextContentSize();

    let splitPoint: LexicalNode | null = lexNode;
    if (offset > 0 && offset < size) {
      const parts = lexNode.splitText(offset);
      splitPoint = parts.length > 1 ? parts[1] : null;
    } else if (offset >= size) {
      splitPoint = lexNode.getNextSibling();
    }
    if (!splitPoint) return;

    const tail: LexicalNode[] = [];
    let cursor: LexicalNode | null = splitPoint;
    while (cursor) {
      tail.push(cursor);
      cursor = cursor.getNextSibling();
    }
    if (tail.length === 0) return;

    const continuation = $createParagraphNode();
    continuation.append(...tail);
    paragraph.insertAfter(continuation);
    newKey = continuation.getKey();
  });

  return newKey;
}
