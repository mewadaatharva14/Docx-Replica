import { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { MARGIN_PX, PAGE_GAP_PX, USABLE_HEIGHT_PX } from './constants';
import { mergeContinuations, splitBlockAtPoint } from './lineSplit';

// Safety cap on how many new page breaks one reflow pass will create
// (e.g. pasting a huge amount of text). Normal typing needs at most a
// couple of iterations.
const MAX_SPLIT_ITERATIONS = 200;

// Widow/orphan guard for forced splits (a block taller than one full page).
// If the remaining space on the current page is smaller than this, splitting
// there would strand just a line or two behind - so we treat the block as
// starting a fresh page instead and give it the full page budget, matching
// Google Docs' behavior of never leaving a tiny orphan at a page boundary.
// ~2 lines at our 11pt baseline (see LINE_HEIGHT_MULTIPLIER in constants.ts).
const MIN_ORPHAN_HEIGHT_PX = 40;

interface SplitTarget {
  x: number;
  y: number;
}

// Walks blocks the same way the final spacer pass does (a block that fits on
// a fresh page just moves there whole) and returns a split point only for a
// block that STILL doesn't fit even as the sole first item on a fresh page —
// i.e. one that genuinely needs a mid-block line split. Returns null once
// every block can be handled by whole-block page moves alone.
function findSplitTarget(root: HTMLElement): SplitTarget | null {
  const blocks = Array.from(root.children) as HTMLElement[];
  for (const block of blocks) block.style.marginTop = '0px';
  const rects = blocks.map((block) => block.getBoundingClientRect());

  let usedHeight = 0;
  for (let i = 0; i < blocks.length; i++) {
    const height = rects[i].height;
    let budget = USABLE_HEIGHT_PX - usedHeight;

    if (usedHeight > 0 && height > budget) {
      if (height <= USABLE_HEIGHT_PX) {
        usedHeight = height; // fits whole on a fresh page; it becomes that page's first block
        continue;
      }
      if (budget < MIN_ORPHAN_HEIGHT_PX) {
        // Splitting with the current remaining space would strand a tiny
        // orphan; give this block a full page's budget instead, as if it
        // were starting fresh.
        budget = USABLE_HEIGHT_PX;
      }
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
      }

      const root = editor.getRootElement();
      if (!root) return;

      const blocks = Array.from(root.children) as HTMLElement[];
      for (const block of blocks) block.style.marginTop = '0px';
      const heights = blocks.map((block) => block.getBoundingClientRect().height);

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
