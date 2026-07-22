# Docx-Replica

A Google Docs–style rich text editor built with React, TypeScript, and Lexical — focused on replicating real pagination behavior: content automatically reflows across discrete, print-accurate "pages" as you type, exactly like Google Docs.

## Goal

Most rich-text editors treat a document as one continuous scroll. This project instead renders a document as fixed-size Letter pages (8.5"×11", 1" margins) and dynamically reflows content across page boundaries — including splitting a single paragraph's lines across two pages when it doesn't fit, the way Google Docs does.

## Status

Early-stage prototype. Currently implemented:
- Page-accurate layout (Letter size, 1" margins, empirically calibrated line-height math)
- Real-time reflow: typing or resizing text past a page's capacity automatically pushes overflow to the next page
- True line-level paragraph splitting (a paragraph's fitting lines stay on the current page; only the overflow continues on the next — not just whole-paragraph movement)

Known gaps (tracked as upcoming work):
- No widow/orphan control yet (Google Docs avoids stranding 1–2 lines alone at a page boundary; this doesn't yet)
- Single line-spacing and fixed page size/margins only — not yet user-configurable
- No headers, footers, or page numbers

## Tech stack

- React + TypeScript + Vite
- [Lexical](https://lexical.dev/) as the rich-text editor framework
- A custom pagination engine built directly on Lexical's node model — no paid extensions

## Getting started

Project source lands in a follow-up commit. Once present:

```
npm install
npm run dev
```
