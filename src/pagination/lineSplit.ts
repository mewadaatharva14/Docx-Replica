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

// HISTORY_MERGE_TAG alone isn't a safe "this is our own reflow work" marker:
// it's a shared, generic Lexical tag - the library's own internals (e.g.
// normalizing text nodes after a large paste) also use it for their own
// unrelated follow-up commits. A listener that treats every HISTORY_MERGE_TAG
// update as "already accounted for" ends up silently skipping those
// legitimate content changes too. PAGINATION_TAG is ours alone, so the
// listener in usePagination.ts can tell the two apart; we still include
// HISTORY_MERGE_TAG so our edits don't create their own undo step.
export const PAGINATION_TAG = 'pagination-reflow';

// Every pagination mutation commits synchronously (discrete) so the whole
// merge -> measure -> split cycle runs in one uninterruptible task. When
// these steps were async, a user keystroke could land between the merge and
// the re-split, see a transiently restructured document, and apply at the
// wrong position - eating characters or fusing unrelated paragraphs.
function updateSync(editor: LexicalEditor, fn: () => void): void {
  editor.update(fn, { tag: [HISTORY_MERGE_TAG, PAGINATION_TAG], discrete: true });
}

// Undoes previously injected pagination splits so the document is back to
// its real (unpaginated) structure before we re-measure from scratch.
export function mergeContinuations(editor: LexicalEditor, registry: Set<string>): void {
  if (registry.size === 0) return;
  const keys = Array.from(registry);
  registry.clear();
  updateSync(editor, () => {
    for (const key of keys) {
      const node = $getNodeByKey(key);
      if (!node || !$isParagraphNode(node)) continue;
      const prev = node.getPreviousSibling();
      if (prev && $isElementNode(prev)) {
        // Pour the tail into whatever now precedes it. Usually that's the
        // head it was split from. If the user pressed Enter at the page
        // boundary, a fresh paragraph sits between head and tail - pouring
        // the tail into it is exactly what turns that Enter into a real
        // paragraph break at the break point, matching Google Docs.
        for (const child of node.getChildren()) {
          prev.append(child);
        }
        // The continuation's element held the paragraph's real trailing
        // spacing (see splitBlockAtHeight's caller); give it back to the
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

interface DomSplitPoint {
  node: Text;
  offset: number;
}

// Finds the character boundary where blockEl's rendered content crosses
// budgetPx of height, via binary search over Range measurements. Ranges
// measure correctly for off-screen content, so unlike caretRangeFromPoint
// (which silently returns null outside the viewport and made pagination
// depend on scroll position), this is deterministic.
function findLineBoundaryOffset(blockEl: HTMLElement, budgetPx: number): DomSplitPoint | null {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }
  const total = textNodes.reduce((sum, t) => sum + t.length, 0);
  if (total === 0) return null;

  // Sub-pixel slack; must not exceed EPSILON_PX in usePagination.ts, or a
  // head crafted here to fill a page could fail the spacer pass's stricter
  // check and get pushed whole. All characters on one line share the same
  // line-box bottom, so the search lands exactly on a line boundary.
  const EPSILON_PX = 1;
  const limit = blockEl.getBoundingClientRect().top + budgetPx + EPSILON_PX;
  const range = document.createRange();
  range.setStart(textNodes[0], 0);

  const locate = (offset: number): DomSplitPoint => {
    let remaining = offset;
    for (const t of textNodes) {
      if (remaining <= t.length) return { node: t, offset: remaining };
      remaining -= t.length;
    }
    const last = textNodes[textNodes.length - 1];
    return { node: last, offset: last.length };
  };

  const fits = (offset: number): boolean => {
    const p = locate(offset);
    range.setEnd(p.node, p.offset);
    return range.getBoundingClientRect().bottom <= limit;
  };

  if (!fits(1)) return null; // not even the first line fits in the budget
  let lo = 1;
  let hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  if (lo >= total) return null; // whole block fits after all - nothing to split
  return locate(lo);
}

// Splits the paragraph at the exact line boundary where it crosses budgetPx
// of rendered height, mirroring how a real page break falls mid-paragraph.
// Returns the new continuation paragraph's key, or null if there is no
// valid split point (caller falls back to moving the whole block).
export function splitBlockAtHeight(editor: LexicalEditor, blockEl: HTMLElement, budgetPx: number): string | null {
  const point = findLineBoundaryOffset(blockEl, budgetPx);
  if (!point) return null;

  let newKey: string | null = null;

  updateSync(editor, () => {
    const lexNode = $getNearestNodeFromDOMNode(point.node);
    if (!lexNode || !$isTextNode(lexNode)) return;

    const paragraph = lexNode.getParent();
    if (!paragraph || !$isElementNode(paragraph)) return;

    const size = lexNode.getTextContentSize();
    let splitPoint: LexicalNode | null = lexNode;
    if (point.offset > 0 && point.offset < size) {
      const parts = lexNode.splitText(point.offset);
      splitPoint = parts.length > 1 ? parts[1] : null;
    } else if (point.offset >= size) {
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
