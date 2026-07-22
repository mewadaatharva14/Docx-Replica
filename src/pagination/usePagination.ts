import { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type ElementNode,
} from 'lexical';
import { MARGIN_PX, PAGE_GAP_PX, USABLE_HEIGHT_PX } from './constants';
import { mergeContinuations, PAGINATION_TAG, splitBlockAtHeight } from './lineSplit';

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

// Sub-pixel slack shared by every fit check here and by the split search in
// lineSplit.ts (EPSILON_PX there must not exceed this). Line heights are
// fractional, so if the split search tolerated more rounding error than the
// spacer pass, a head fragment crafted to exactly fill a page could fail the
// stricter check by a fraction of a pixel and get pushed to the next page
// whole - silently undoing the tight fill.
const EPSILON_PX = 1;

// getBoundingClientRect excludes margin, but a paragraph's margin-bottom
// (preserved from pasted content - see pasteSpacing.ts) is real vertical
// space it occupies on the page, so pagination math must include it.
function blockHeight(block: HTMLElement): number {
  const marginBottom = parseFloat(getComputedStyle(block).marginBottom) || 0;
  return block.getBoundingClientRect().height + marginBottom;
}

interface SplitTarget {
  block: HTMLElement;
  budget: number;
}

// Prefers a tight split over moving a block whole, the way Google Docs fills
// a page as far as it safely can before breaking - only avoiding a split
// when it would strand fewer than MIN_ORPHAN_HEIGHT_PX worth of lines on
// either side of the break. Returns null once every block already fits (via
// a prior split or a whole-block move) with nothing left to fix.
function findSplitTarget(root: HTMLElement): SplitTarget | null {
  const blocks = Array.from(root.children) as HTMLElement[];
  for (const block of blocks) block.style.marginTop = '0px';
  const heights = blocks.map(blockHeight);

  let usedHeight = 0;
  for (let i = 0; i < blocks.length; i++) {
    const height = heights[i];
    const remaining = USABLE_HEIGHT_PX - usedHeight;

    if (usedHeight > 0 && height > remaining + EPSILON_PX) {
      if (height <= USABLE_HEIGHT_PX + EPSILON_PX) {
        // Fits whole on a fresh page - but a tight split filling the
        // current page's remaining space is preferable if it's safe (i.e.
        // leaves enough lines on both sides of the break).
        const tailHeight = height - remaining;
        if (remaining >= MIN_ORPHAN_HEIGHT_PX && tailHeight >= MIN_ORPHAN_HEIGHT_PX) {
          return { block: blocks[i], budget: remaining };
        }
        usedHeight = height; // move whole to a fresh page instead
        continue;
      }
      // Doesn't fit even a fresh page - must split somewhere. Avoid
      // stranding a tiny orphan on the current page if the remaining
      // budget there is too small.
      const budget = remaining >= MIN_ORPHAN_HEIGHT_PX ? remaining : USABLE_HEIGHT_PX;
      return { block: blocks[i], budget };
    }

    if (usedHeight === 0 && height > USABLE_HEIGHT_PX + EPSILON_PX) {
      return { block: blocks[i], budget: USABLE_HEIGHT_PX };
    }

    usedHeight += height;
  }
  return null;
}

// Collapsed-selection helpers for the page-boundary key interceptors below.
function $paragraphAtCollapsedStart(): ElementNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  if (anchor.offset !== 0) return null;
  const node = anchor.getNode();
  if ($isParagraphNode(node)) return node;
  if ($isTextNode(node) && node.getPreviousSibling() === null) {
    const parent = node.getParent();
    if (parent && $isParagraphNode(parent)) return parent;
  }
  return null;
}

function $paragraphAtCollapsedEnd(): ElementNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  if ($isParagraphNode(node)) {
    return anchor.offset === node.getChildrenSize() ? node : null;
  }
  if ($isTextNode(node) && node.getNextSibling() === null && anchor.offset === node.getTextContentSize()) {
    const parent = node.getParent();
    if (parent && $isParagraphNode(parent)) return parent;
  }
  return null;
}

// Splits every block that doesn't fit its page; the model then has no block
// taller than one page's remaining budget, and the spacer pass aligns each
// page's first block with its background card.
export function usePagination(): number {
  const [editor] = useLexicalComposerContext();
  const [pageCount, setPageCount] = useState(1);
  const continuationKeys = useRef<Set<string>>(new Set());

  const reflow = useCallback(() => {
    if (!editor.getRootElement()) return;

    mergeContinuations(editor, continuationKeys.current);

    for (let i = 0; i < MAX_SPLIT_ITERATIONS; i++) {
      const root = editor.getRootElement();
      if (!root) break;
      const target = findSplitTarget(root);
      if (!target) break;

      const newKey = splitBlockAtHeight(editor, target.block, target.budget);
      if (!newKey) break; // no valid split point; final pass falls back to whole-block push
      continuationKeys.current.add(newKey);

      // Preserved trailing spacing (margin-bottom) belongs wherever the
      // paragraph now actually ends - the continuation - not the head
      // fragment. Both elements exist since the split committed discretely.
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
      if (usedHeight > 0 && usedHeight + height > USABLE_HEIGHT_PX + EPSILON_PX) {
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
    // Reflow is scheduled via a microtask, not called inline and not via
    // requestAnimationFrame. Both alternatives are broken:
    //   - Inline (calling reflow() directly from the listener) runs
    //     reentrantly inside Lexical's own update-commit call stack. Our
    //     discrete updates don't actually flush synchronously from there -
    //     Lexical enqueues them and only drains the queue when some later
    //     update triggers it - so a split could silently not take effect
    //     until an unrelated future edit happened to flush it.
    //   - requestAnimationFrame leaves a real async gap (up to one frame)
    //     where a fast next keystroke (e.g. Enter right after Backspace)
    //     could land on a document a pending reflow hadn't finished
    //     restructuring yet, fusing content into the wrong node.
    // A microtask runs outside Lexical's call stack (so discrete updates
    // flush for real) but is guaranteed to drain before the next keyboard
    // event or paint (so no keystroke can land in the gap). Coalesced with
    // a flag so several listener firings in one tick (our own merge/split
    // calls each fire it too, before their PAGINATION_TAG check short-
    // circuits) queue a single reflow rather than one each.
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        reflow();
      });
    };

    const teardowns = [
      editor.registerUpdateListener(({ tags }) => {
        // Only skip updates WE made (tagged PAGINATION_TAG) - they're already
        // accounted for within the reflow pass that made them, and scheduling
        // another reflow for them would perpetually retrigger itself.
        // HISTORY_MERGE_TAG alone is not a safe signal for this: it's a
        // shared, generic Lexical tag that the library's own internals also
        // use for their own unrelated follow-up commits (e.g. normalizing
        // text nodes after a large paste) - treating every such update as
        // "ours" silently skipped reflowing content that genuinely changed.
        if (tags.has(PAGINATION_TAG)) return;
        schedule();
      }),

      // A continuation's leading edge is a pagination artifact, not a real
      // paragraph boundary - in Google Docs terms the paragraph continues
      // straight through the page break. So Backspace at the start of a
      // continuation deletes the last character of the head fragment (and
      // Delete at the end of a head deletes the continuation's first char),
      // exactly as if the boundary didn't exist. Without this, the default
      // handler merges the fake boundary - deleting nothing - and the next
      // reflow immediately re-splits it, so the key appears dead.
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          const paragraph = $paragraphAtCollapsedStart();
          if (!paragraph) return false;
          if (!continuationKeys.current.has(paragraph.getKey())) return false;
          const prev = paragraph.getPreviousSibling();
          if (!prev || !$isElementNode(prev)) return false;

          if (event) event.preventDefault();
          prev.selectEnd().deleteCharacter(true);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        (event) => {
          const paragraph = $paragraphAtCollapsedEnd();
          if (!paragraph) return false;
          const next = paragraph.getNextSibling();
          if (!next || !$isElementNode(next)) return false;
          if (!continuationKeys.current.has(next.getKey())) return false;

          if (event) event.preventDefault();
          next.selectStart().deleteCharacter(false);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ];

    schedule();
    window.addEventListener('resize', schedule);
    return () => {
      for (const teardown of teardowns) teardown();
      window.removeEventListener('resize', schedule);
    };
  }, [editor, reflow]);

  return pageCount;
}
