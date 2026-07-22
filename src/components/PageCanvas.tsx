import type { ReactNode } from 'react';
import { MARGIN_PX, PAGE_GAP_PX, PAGE_HEIGHT_PX, PAGE_WIDTH_PX } from '../pagination/constants';

interface PageCanvasProps {
  pageCount: number;
  children: ReactNode;
}

export function PageCanvas({ pageCount, children }: PageCanvasProps) {
  const totalHeight = pageCount * PAGE_HEIGHT_PX + (pageCount - 1) * PAGE_GAP_PX;

  return (
    <div className="canvas">
      <div className="canvas-inner" style={{ width: PAGE_WIDTH_PX, height: totalHeight }}>
        {Array.from({ length: pageCount }).map((_, i) => (
          <div
            key={i}
            className="page-background"
            style={{
              width: PAGE_WIDTH_PX,
              height: PAGE_HEIGHT_PX,
              top: i * (PAGE_HEIGHT_PX + PAGE_GAP_PX),
            }}
          />
        ))}
        <div
          className="content-column"
          style={{ width: PAGE_WIDTH_PX, paddingLeft: MARGIN_PX, paddingRight: MARGIN_PX, paddingTop: MARGIN_PX }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
