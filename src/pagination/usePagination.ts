import { useCallback, useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { MARGIN_PX, PAGE_GAP_PX, USABLE_HEIGHT_PX } from './constants';

// Splits the single continuous editor flow into page-sized visual chunks.
// Overflowing blocks get pushed down (via margin-top) into alignment with
// the next page's background card, computed from real rendered heights so
// mixed font sizes reflow correctly the instant they change.
export function usePagination(): number {
  const [editor] = useLexicalComposerContext();
  const [pageCount, setPageCount] = useState(1);

  const reflow = useCallback(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const blocks = Array.from(root.children) as HTMLElement[];
    if (blocks.length === 0) {
      setPageCount(1);
      return;
    }

    // Pass 1 (write): clear injected spacing so natural heights can be read.
    for (const block of blocks) {
      block.style.marginTop = '0px';
    }

    // Pass 2 (read): batched to avoid interleaved layout thrashing.
    const heights = blocks.map((block) => block.getBoundingClientRect().height);

    // Pass 3 (write): assign pages and inject spacers at break points.
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
