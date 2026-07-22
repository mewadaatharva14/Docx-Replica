import { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { MARGIN_PX, PAGE_GAP_PX, USABLE_HEIGHT_PX } from './constants';
import { mergeContinuations, splitBlockAtPoint } from './lineSplit';

// Safety cap on how many new page breaks one reflow pass will create
// (e.g. pasting a huge amount of text). Normal typing needs at most a
// couple of iterations.
const MAX_SPLIT_ITERATIONS = 200;

// Widow/orphan guard, used on both sides of a candidate split: the minimum
// amount of content a break must leave behind on the current page and ahead
// on the next one. Below this, we prefer moving the block whole over
// stranding a line or two - matching Google Docs' page-filling behavior:
// split as tight as safely possible, only falling back to a whole-block
// move when a split would leave too little on one side of the break.
// ~2 lines at our 11pt baseline (see LINE_HEIGHT_MULTIPLIER in constants.ts).
const MIN_ORPHAN_HEIGHT_PX = 40;

// getBoundingClientRect excludes margin, but a paragraph's margin-bottom
// (preserved from pasted content - see pasteSpacing.ts) is real vertical
// space it occupies on the page, so pagination math must include it.
function blockHeight(block: HTMLElement): number {
  const marginBottom = parseFloat(getComputedStyle(block).marginBottom) || 0;
  return block.getBoundingClientRect().height + marginBottom;
}

interface SplitTarget {
  x: number;
  y: number;
}

// Prefers a tight split over moving a block whole, the way Google Docs fills
// a page as far as it safely can before breaking - only avoiding a split
// when it would strand fewer than MIN_ORPHAN_HEIGHT_PX worth of lines on
// either side of the break. Returns null once every block already fits (via
// a prior split or a whole-block move) with nothing left to fix.
function findSplitTarget(root: HTMLElement): SplitTarget | null {
  const blocks = Array.from(root.children) as HTMLElement[];
  for (const block of blocks) block.style.marginTop = '0px';
  const rects = blocks.map((block) => block.getBoundingClientRect());
  const heights = blocks.map(blockHeight);

  let usedHeight = 0;
  for (let i = 0; i < blocks.length; i++) {
    const height = heights[i];
    const remaining = USABLE_HEIGHT_PX - usedHeight;

    if (usedHeight > 0 && height > remaining) {
      if (height <= USABLE_HEIGHT_PX) {
        // Fits whole on a fresh page - but a tight split filling the
        // current page's remaining space is preferable if it's safe (i.e.
        // leaves enough lines on both sides of the break).
        const tailHeight = height - remaining;
        if (remaining >= MIN_ORPHAN_HEIGHT_PX && tailHeight >= MIN_ORPHAN_HEIGHT_PX) {
          return { x: rects[i].left + 1, y: rects[i].top + remaining };
        }
        usedHeight = height; // move whole to a fresh page instead
        continue;
      }
      // Doesn't fit even a fresh page - must split somewhere. Avoid
      // stranding a tiny orphan on the current page if the remaining
      // budget there is too small.
      const budget = remaining >= MIN_ORPHAN_HEIGHT_PX ? remaining : USABLE_HEIGHT_PX;
      return { x: rects[i].left + 1, y: rects[i].top + budget };
    }

    if (usedHeight === 0 && height > USABLE_HEIGHT_PX) {
      return { x: rects[i].left + 1, y: rects[i].top + USABLE_HEIGHT_PX };
    }

    usedHeight += height;
  }
  return null;
}

// Splits every block that doesn't fit its page; the model now has no block
// taller than one page's remaining budget.
export function usePagination(): number {
  const [editor] = useLexicalComposerContext();
  const [pageCount, setPageCount] = useState(1);
  const continuationKeys = useRef<Set<string>>(new Set());
  const reflowing = useRef(false);
  const pending = useRef(false);

  const reflow = useCallback(async () => {
    if (reflowing.current) {
      pending.current = true;
      return;
    }
    reflowing.current = true;
    try {
      await mergeContinuations(editor, continuationKeys.current);

      for (let i = 0; i < MAX_SPLIT_ITERATIONS; i++) {
        const root = editor.getRootElement();
        if (!root) break;
        const target = findSplitTarget(root);
        if (!target) break;

        const newKey = await splitBlockAtPoint(editor, target.x, target.y);
        if (!newKey) break; // no valid split point; final pass falls back to whole-block push
        continuationKeys.current.add(newKey);

        // Preserved trailing spacing (margin-bottom) belongs wherever the
        // paragraph now actually ends - the continuation - not the head
        // fragment.
        const contEl = editor.getElementByKey(newKey);
        const headEl = contEl?.previousElementSibling as HTMLElement | null;
        if (contEl && headEl?.style.marginBottom) {
          contEl.style.marginBottom = headEl.style.marginBottom;
          headEl.style.marginBottom = '';
        }
      }

      const root = editor.getRootElement();
      if (!root) return;

      const blocks = Array.from(root.children) as HTMLElement[];
      for (const block of blocks) block.style.marginTop = '0px';
      const heights = blocks.map(blockHeight);

      let usedHeight = 0;
      let pages = 1;
      blocks.forEach((block, i) => {
        const height = heights[i];
        if (usedHeight > 0 && usedHeight + height > USABLE_HEIGHT_PX) {
          const spacer = USABLE_HEIGHT_PX - usedHeight + MARGIN_PX + PAGE_GAP_PX + MARGIN_PX;
          block.style.marginTop = `${spacer}px`;
          usedHeight = height;
          pages += 1;
        } else {
          usedHeight += height;
        }
      });

      setPageCount(pages);
    } finally {
      reflowing.current = false;
      if (pending.current) {
        pending.current = false;
        reflow();
      }
    }
  }, [editor]);

  useEffect(() => {
    const unregister = editor.registerUpdateListener(() => {
      requestAnimationFrame(reflow);
    });
    requestAnimationFrame(reflow);
    window.addEventListener('resize', reflow);
    return () => {
      unregister();
      window.removeEventListener('resize', reflow);
    };
  }, [editor, reflow]);

  return pageCount;
}
