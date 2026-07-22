export const PX_PER_INCH = 96;

export const PAGE_WIDTH_IN = 8.5;
export const PAGE_HEIGHT_IN = 11;
export const MARGIN_IN = 1;

export const PAGE_WIDTH_PX = PAGE_WIDTH_IN * PX_PER_INCH;
export const PAGE_HEIGHT_PX = PAGE_HEIGHT_IN * PX_PER_INCH;
export const MARGIN_PX = MARGIN_IN * PX_PER_INCH;

export const USABLE_HEIGHT_PX = PAGE_HEIGHT_PX - MARGIN_PX * 2;
export const USABLE_WIDTH_PX = PAGE_WIDTH_PX - MARGIN_PX * 2;

// Visual gap between stacked page cards.
export const PAGE_GAP_PX = 32;

// Empirically derived from Google Docs: 44 lines fit per page at 11pt,
// single spacing, Letter page, 1" margins (864px usable height).
// lineHeightPx = fontSizePt * LINE_HEIGHT_PT_MULTIPLIER
export const LINE_HEIGHT_MULTIPLIER = 1.339;
